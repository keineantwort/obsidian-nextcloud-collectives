// Sync runner (spec M4 §10): config checks, scans, planning and execution in one run. Obsidian-free; all I/O is injected.
import { createApiClients } from '../api/clients';
import { normalizeServerUrl } from '../api/connection';
import type { RequestFn } from '../api/http';
import type { CollectiveId, PageId, PageInfo, Tag, TagId } from '../api/types';
import type { NcMeta } from '../mapping/frontmatter';
import { planLocalPaths } from '../mapping/paths';
import type { CollectiveTree, PathPlan } from '../mapping/paths';
import type { Translator } from '../i18n';
import { ConfigError } from '../util/errors';
import { metaHash } from '../util/hash';
import type { Logger } from '../util/logger';
import { countConflicts } from './conflicts';
import type { ConflictStrategy } from './decide';
import { executeSync } from './executor';
import type { VaultWriter } from './executor';
import { scanLocal } from './localScanner';
import type { VaultReader } from './localScanner';
import { planSync } from './planner';
import type { PlannerInput } from './planner';
import { scanRemote } from './remoteScanner';
import type { RemoteCollective } from './remoteScanner';
import { emptyState } from './state';
import type { SyncState } from './state';
import type { StateStore } from './stateStore';
import type { SyncRunOutcome, Skip } from './types';

export type { SyncRunOutcome } from './types';

export interface SyncRunDeps {
	settings: { serverUrl: string; username: string; conflictStrategy: ConflictStrategy };
	readPassword: () => Promise<string | null>;
	request: RequestFn;
	vault: VaultReader & VaultWriter;
	stateStore: StateStore;
	/** Called only when the state has no pages yet and local.nonEmpty; resolves true = merge, false = cancel. */
	confirmInitialSync: () => Promise<boolean>;
	/** pathKeys of the files changed since the last run; called once per run, after the scans (DirtyQueue.drain()). */
	dirty: () => ReadonlySet<string>;
	t: Translator;
	log: Logger;
	now?: () => Date;
	/** Waits before a second GET of an unconfirmed page. Default: window.setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Runs one sync. Nothing is written before the config checks and the initial-sync confirmation have passed. */
export async function runSync(deps: SyncRunDeps): Promise<SyncRunOutcome> {
	const serverUrl = normalizeServerUrl(deps.settings.serverUrl);
	const username = deps.settings.username.trim();
	if (username === '') throw new ConfigError('username', 'missing');
	const appPassword = await deps.readPassword();
	if (appPassword === null || appPassword === '') throw new ConfigError('appPassword', 'missing');

	// The Nextcloud user ID is needed for WebDAV paths; the first client only fetches it.
	const options = { baseUrl: serverUrl, username, appPassword, request: deps.request, retry: true };
	const userId = await createApiClients(options).collectives.getCurrentUserId();
	const clients = createApiClients(options, userId);

	const stored = await deps.stateStore.load();
	const state: SyncState = stored ?? emptyState(serverUrl, userId);
	const hasPages = Object.keys(state.pages).length > 0;
	if (hasPages && state.serverUrl !== serverUrl) return { kind: 'serverMismatch', stateServer: state.serverUrl };
	// Same server, other account: the page IDs in the state would belong to someone else's collectives.
	if (hasPages && state.user !== userId) return { kind: 'accountMismatch', stateUser: state.user, stateServer: state.serverUrl };
	if (!hasPages) {
		state.serverUrl = serverUrl;
		state.user = userId;
	}

	const remote = await scanRemote(clients.collectives);
	const local = await scanLocal(deps.vault);
	const dirty = deps.dirty();

	if (!hasPages && local.nonEmpty) {
		if (!(await deps.confirmInitialSync())) return { kind: 'cancelled' };
	}

	const knownFolders = new Map<CollectiveId, string>(Object.values(state.collectives).map((c) => [c.collectiveId, c.localFolder]));
	const paths = planLocalPaths(remote.collectives.map(toTree), knownFolders);
	const remoteMeta = await buildRemoteMeta(remote.collectives, paths, deps.log);

	const input: PlannerInput = { state, remote, local, remoteMeta, paths, dirty };
	const plan = planSync(input);
	for (const skip of plan.skips) logSkip(skip, deps.log);

	const result = await executeSync(plan, {
		vault: deps.vault,
		webdav: clients.webdav,
		state,
		persist: async (current) => {
			await deps.stateStore.save(current);
		},
		now: deps.now ?? (() => new Date()),
		conflictLabel: deps.t('sync.conflictFileLabel'),
		strategy: deps.settings.conflictStrategy,
		sleep: deps.sleep ?? defaultSleep,
		log: deps.log,
		occupied: local.occupied,
	});
	return { kind: 'done', result, skips: plan.skips, openConflicts: countConflicts(state), pages: Object.keys(state.pages).length };
}

function toTree(rc: RemoteCollective): CollectiveTree {
	return { collectiveId: rc.collective.id, name: rc.collective.name, pages: rc.pages };
}

/**
 * Metadata hash input for every page that has a planned local target. The title is the remote title; the executor
 * derives the nc_title it actually writes from the file name. Orphans get none; the planner skips them first.
 */
async function buildRemoteMeta(
	collectives: RemoteCollective[],
	paths: PathPlan,
	log: Logger,
): Promise<Map<PageId, { meta: NcMeta; hash: string }>> {
	const out = new Map<PageId, { meta: NcMeta; hash: string }>();
	for (const rc of collectives) {
		const tagNames = new Map<TagId, string>(rc.tags.map((tag: Tag) => [tag.id, tag.name]));
		for (const page of rc.pages) {
			const target = paths.targets.get(page.id);
			if (target === undefined) continue;
			const meta: NcMeta = {
				pageId: page.id,
				collectiveId: rc.collective.id,
				title: page.title,
				emoji: page.emoji,
				tags: tagNamesOf(page, tagNames, log),
			};
			out.set(page.id, { meta, hash: await metaHash(meta.title, meta.emoji, meta.tags) });
		}
	}
	return out;
}

/** Tag names in the page's own order; a tag ID the collective does not list is left out and logged. */
function tagNamesOf(page: PageInfo, tagNames: ReadonlyMap<TagId, string>, log: Logger): string[] {
	const names: string[] = [];
	for (const tagId of page.tags) {
		const name = tagNames.get(tagId);
		if (name === undefined) {
			log.warn('Unknown tag ID ignored', { pageId: page.id, tagId });
			continue;
		}
		names.push(name);
	}
	return names;
}

function logSkip(skip: Skip, log: Logger): void {
	const data: Record<string, string | number> = { reason: skip.reason };
	if (skip.pageId !== undefined) data['pageId'] = skip.pageId;
	if (skip.collectiveId !== undefined) data['collectiveId'] = skip.collectiveId;
	if (skip.path !== undefined) data['path'] = skip.path;
	log.info('Sync item skipped', data);
}
