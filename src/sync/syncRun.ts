// Sync runner (spec M4 §10): config checks, scans, planning and execution in one run. Obsidian-free; all I/O is injected.
import { createApiClients } from '../api/clients';
import { normalizeServerUrl } from '../api/connection';
import type { CollectivesApi } from '../api/collectivesApi';
import type { RequestFn } from '../api/http';
import type { CollectiveId, PageId, PageInfo, Tag, TagId } from '../api/types';
import { canonicalRemote } from '../mapping/frontmatter';
import type { LinkIndex } from '../mapping/links';
import type { NcMeta } from '../mapping/frontmatter';
import { planLocalPaths, remotePagePath } from '../mapping/paths';
import type { CollectiveTree, PathPlan } from '../mapping/paths';
import type { Translator } from '../i18n';
import type { WebdavClient } from '../api/webdavClient';
import { ConfigError, isRunFatal } from '../util/errors';
import { metaHash, sha256Hex } from '../util/hash';
import type { Logger } from '../util/logger';
import { countConflicts } from './conflicts';
import type { ConflictStrategy } from './decide';
import { executeSync } from './executor';
import type { VaultWriter } from './executor';
import { scanLocal } from './localScanner';
import type { LocalSnapshot, VaultReader } from './localScanner';
import { buildLinkIndex } from './linkIndex';
import { indexFiles, locatePage } from './locate';
import { planSync } from './planner';
import type { PlannerBehaviour, PlannerInput, SyncPlan } from './planner';
import { scanRemote } from './remoteScanner';
import type { RemoteCollective, RemoteSnapshot } from './remoteScanner';
import { UNCONFIRMED_REMOTE_MTIME, emptyState, isCollision } from './state';
import type { SyncState } from './state';
import type { StateStore } from './stateStore';
import { emptyResult } from './types';
import type { Decision, Proposal, Skip, SyncResult, SyncRunOutcome } from './types';

export type { SyncRunOutcome } from './types';

export interface SyncRunDeps {
	settings: {
		serverUrl: string;
		username: string;
		conflictStrategy: ConflictStrategy;
		newFolderBehaviour: PlannerBehaviour['newFolder'];
		localDeleteBehaviour: PlannerBehaviour['localDelete'];
		remoteDeleteBehaviour: PlannerBehaviour['remoteDelete'];
	};
	readPassword: () => Promise<string | null>;
	request: RequestFn;
	vault: VaultReader & VaultWriter;
	stateStore: StateStore;
	/** Called only when the state has no pages yet and local.nonEmpty; resolves true = merge, false = cancel. */
	confirmInitialSync: () => Promise<boolean>;
	/** pathKeys of the files changed since the last run; called once per pass, after the scans (DirtyQueue.drain()). */
	dirty: () => ReadonlySet<string>;
	/**
	 * Asks the user the planner's questions (PLAN §7.4). Resolves with an answer per proposal id; a missing answer counts as
	 * 'defer' (ask again in the next run).
	 */
	confirm: (proposals: Proposal[]) => Promise<ReadonlyMap<string, Decision>>;
	/** Called with the page index of each pass, so the conflict dialog can hash and show texts like the sync does. */
	onLinks?: (links: LinkIndex) => void;
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

	const total = emptyResult();
	const skips: Skip[] = [];
	const decisions = new Map<string, Decision>();
	let first = true;
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const remote = await scanRemote(clients.collectives);
		const local = await scanLocal(deps.vault);
		if (first && !hasPages && local.nonEmpty) {
			if (!(await deps.confirmInitialSync())) return { kind: 'cancelled' };
		}
		if (first && local.rootFiles.length > 0) deps.log.info('Notes directly in the vault root are not synced', { count: local.rootFiles.length });
		first = false;

		const knownFolders = new Map<CollectiveId, string>(Object.values(state.collectives).map((c) => [c.collectiveId, c.localFolder]));
		const paths = planLocalPaths(remote.collectives.map(toTree), knownFolders);
		const links = buildLinkIndex(remote, local, paths, serverUrl);
		deps.onLinks?.(links);
		const remoteMeta = await buildRemoteMeta(remote.collectives, paths, deps.log);
		const input: PlannerInput = {
			state,
			remote,
			local,
			remoteMeta,
			paths,
			dirty: deps.dirty(),
			remoteChanged: await findRemoteChanged(state, remote, local, clients.webdav, deps.log, links),
			remoteTrash: await findRemoteTrash(state, remote, local, clients.collectives),
			decisions,
			behaviour: {
				remoteDelete: deps.settings.remoteDeleteBehaviour,
				localDelete: deps.settings.localDeleteBehaviour,
				newFolder: deps.settings.newFolderBehaviour,
			},
		};
		const plan = await planWithAnswers(input, decisions, deps);
		for (const skip of plan.skips) {
			logSkip(skip, deps.log);
			if (!skips.some((known) => JSON.stringify(known) === JSON.stringify(skip))) skips.push(skip);
		}

		const result = await executeSync(plan, {
			vault: deps.vault,
			webdav: clients.webdav,
			api: clients.collectives,
			state,
			links,
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
		addResult(total, result);
		// Another pass finds what depended on this one (a new collective's pages, a folder page's moved note). A failure ends the loop.
		if (!plan.followUp || result.failed > 0) break;
	}
	return { kind: 'done', result: total, skips, openConflicts: countConflicts(state), pages: Object.keys(state.pages).length };
}

/** Passes of one run: collectives and moved folder pages need a second look at the vault and the server (PLAN §7.2). */
const MAX_PASSES = 3;
/** Rounds of questions per pass; answers can reveal further questions (e.g. sub-pages). */
const MAX_ROUNDS = 3;

/** Plans; if the plan asks questions, asks them and plans again with the answers. Questions left open count as 'defer'. */
async function planWithAnswers(input: PlannerInput, decisions: Map<string, Decision>, deps: SyncRunDeps): Promise<SyncPlan> {
	let plan = planSync(input);
	for (let round = 0; round < MAX_ROUNDS && plan.proposals.length > 0; round++) {
		const answers = await deps.confirm(plan.proposals);
		for (const proposal of plan.proposals) decisions.set(proposal.id, answers.get(proposal.id) ?? 'defer');
		plan = planSync(input);
	}
	return plan;
}

function addResult(total: SyncResult, add: SyncResult): void {
	for (const key of Object.keys(total) as (keyof SyncResult)[]) total[key] += add[key];
}

/**
 * Pages whose file is gone and whose text on the server differs from the last synced text. The user's deletion does not
 * reach them (the change wins). A page that cannot be read counts as changed: it is never deleted blind.
 */
async function findRemoteChanged(
	state: SyncState,
	remote: RemoteSnapshot,
	local: LocalSnapshot,
	webdav: Pick<WebdavClient, 'get'>,
	log: Logger,
	links: LinkIndex,
): Promise<Set<PageId>> {
	const changed = new Set<PageId>();
	const index = indexFiles(local.files);
	const listed = new Map<PageId, PageInfo>();
	for (const rc of remote.collectives) for (const page of rc.pages) listed.set(page.id, page);
	for (const known of Object.values(state.pages)) {
		const page = listed.get(known.pageId);
		if (page === undefined || isCollision(known) || locatePage(known, index) !== undefined || index.duplicates.has(known.pageId)) continue;
		if (known.remoteMtime !== UNCONFIRMED_REMOTE_MTIME && page.timestamp === known.remoteMtime && page.size === known.remoteSize) continue;
		try {
			const file = await webdav.get(remotePagePath(page));
			if ((await sha256Hex(canonicalRemote(file.content, { index: links, sourceId: known.pageId }))) !== known.baseHash) changed.add(known.pageId);
		} catch (err) {
			if (isRunFatal(err)) throw err;
			log.warn('Deleted page could not be compared with the server', { pageId: known.pageId, error: err instanceof Error ? err.name : 'unknown' });
			changed.add(known.pageId);
		}
	}
	return changed;
}

/** Pages in the Collectives trash whose id a local file carries although neither the state nor the server list them. */
async function findRemoteTrash(
	state: SyncState,
	remote: RemoteSnapshot,
	local: LocalSnapshot,
	api: Pick<CollectivesApi, 'listTrashedPages'>,
): Promise<Map<PageId, CollectiveId>> {
	const listed = new Set<PageId>();
	for (const rc of remote.collectives) for (const page of rc.pages) listed.add(page.id);
	const unknown = new Set<PageId>();
	for (const file of local.files) {
		if (file.pageId !== null && state.pages[String(file.pageId)] === undefined && !listed.has(file.pageId)) unknown.add(file.pageId);
	}
	const found = new Map<PageId, CollectiveId>();
	if (unknown.size === 0) return found;
	for (const rc of remote.collectives) {
		for (const page of await api.listTrashedPages(rc.collective.id)) {
			if (unknown.has(page.id)) found.set(page.id, rc.collective.id);
		}
	}
	return found;
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
			out.set(page.id, { meta, hash: await metaHash(meta.emoji, meta.tags) });
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
	log.info('Sync item skipped', { ...skip });
}
