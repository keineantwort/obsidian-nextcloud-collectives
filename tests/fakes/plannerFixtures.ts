// Builders for the planner tests: remote snapshots, state, local files and the planner input the way the runner builds it.
import { asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { Collective, CollectiveId, PageId, PageInfo, Tag } from '../../src/api/types';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { pathKey, planLocalPaths } from '../../src/mapping/paths';
import type { CollectiveTree, PathPlan } from '../../src/mapping/paths';
import type { LocalFile, LocalSnapshot } from '../../src/sync/localScanner';
import { planSync } from '../../src/sync/planner';
import type { PlannerBehaviour, PlannerInput, SyncOp, SyncPlan } from '../../src/sync/planner';
import type { RemoteCollective, RemoteSnapshot } from '../../src/sync/remoteScanner';
import type { CollectiveState, PageState, SyncState } from '../../src/sync/state';
import type { Decision } from '../../src/sync/types';
import { UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME } from '../../src/sync/state';

export { asCollectiveId, asPageId, asTagId, UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME };

export const SERVER = 'https://cloud.example.com';

// ---------------------------------------------------------------------------
// Builders. Remote hashes are 'm<id>'; state metaHash defaults to the same, so
// an unchanged page produces no operation.
// ---------------------------------------------------------------------------

export function collective(id: number, name: string): Collective {
	return {
		id: asCollectiveId(id),
		circleId: `circle-${id}`,
		name,
		slug: name.toLowerCase(),
		emoji: null,
		level: 8,
		canEdit: true,
		trashTimestamp: null,
	};
}

/** Remote page with all required fields; defaults match pageState() so unchanged pages stay unchanged. */
export function page(id: number, over: Partial<PageInfo> = {}): PageInfo {
	return {
		id: asPageId(id),
		slug: `seite-${id}`,
		title: `Seite ${id}`,
		emoji: null,
		tags: [],
		timestamp: 1,
		size: 0,
		fileName: `Seite ${id}.md`,
		filePath: '',
		collectivePath: '.Collectives/Coll',
		parentId: asPageId(0),
		subpageOrder: [],
		lastUserId: null,
		linkedPageIds: [],
		trashTimestamp: null,
		...over,
	};
}

/** Start page of collective 1 ("Coll"). */
export function startPage(over: Partial<PageInfo> = {}): PageInfo {
	return page(1, { title: 'Coll', fileName: 'Readme.md', ...over });
}

/** Leaf page 10 "Seite" below the start page. */
export function seitePage(over: Partial<PageInfo> = {}): PageInfo {
	return page(10, { title: 'Seite', fileName: 'Seite.md', parentId: asPageId(1), ...over });
}

export function remoteCollective(id: number, name: string, pages: PageInfo[], tags: Tag[] = []): RemoteCollective {
	return { collective: collective(id, name), pages, tags };
}

export function remote(collectives: RemoteCollective[], failed: RemoteSnapshot['failed'] = []): RemoteSnapshot {
	return { collectives, failed };
}

export function tag(id: number, name: string, collectiveId: number, color = '#000000'): Tag {
	return { id: asTagId(id), collectiveId: asCollectiveId(collectiveId), name, color };
}

export function pageState(p: PageInfo, collectiveId: number, localPath: string, over: Partial<PageState> = {}): PageState {
	return {
		pageId: p.id,
		collectiveId: asCollectiveId(collectiveId),
		localPath,
		localMtime: 500,
		remoteFilePath: p.filePath,
		remoteFileName: p.fileName,
		parentId: p.parentId,
		remoteEtag: `etag-${p.id}`,
		remoteMtime: p.timestamp,
		remoteSize: p.size,
		baseHash: `base-${p.id}`,
		metaHash: `m${p.id}`,
		status: 'synced',
		conflictPath: null,
		attachments: [],
		lastSyncedAt: 1,
		...over,
	};
}

export function localFile(path: string, pageId: number | null, mtime = 500): LocalFile {
	return { path, mtime, pageId: pageId === null ? null : asPageId(pageId) };
}

/** Occupied set and path spellings as the scanner builds them: keys of all files and all ancestor folders. */
export function localSnapshot(files: LocalFile[], extraFolders: string[] = []): LocalSnapshot {
	const occupied = new Set<string>();
	const paths = new Map<string, string>();
	for (const folder of extraFolders) {
		occupied.add(pathKey(folder));
		paths.set(pathKey(folder), folder);
	}
	for (const file of files) {
		const parts = file.path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const path = parts.slice(0, i).join('/');
			occupied.add(pathKey(path));
			paths.set(pathKey(path), path);
		}
	}
	const folders = [...paths.entries()].filter(([key]) => !files.some((file) => pathKey(file.path) === key)).map(([, path]) => path);
	return { files, occupied, paths, nonEmpty: files.length > 0, folders, rootFiles: [], attachmentFiles: [] };
}

export function syncState(parts: { collectives?: CollectiveState[]; pages?: PageState[]; tags?: SyncState['tags'] }): SyncState {
	const collectives: Record<string, CollectiveState> = {};
	for (const c of parts.collectives ?? []) collectives[String(c.collectiveId)] = c;
	const pages: Record<string, PageState> = {};
	for (const p of parts.pages ?? []) pages[String(p.pageId)] = p;
	return { schemaVersion: 1, serverUrl: SERVER, user: 'alice', collectives, pages, tags: parts.tags ?? {} };
}

/** Remote: collective 1 "Coll" with start page 1 and leaf 10. */
export function baseRemote(): RemoteSnapshot {
	return remote([remoteCollective(1, 'Coll', [startPage(), seitePage()])]);
}

/** State: everything from baseRemote() is synced at Coll/Coll.md and Coll/Seite.md. */
export function baseState(): SyncState {
	return syncState({
		collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
		pages: [pageState(startPage(), 1, 'Coll/Coll.md'), pageState(seitePage(), 1, 'Coll/Seite.md')],
		tags: { '1': [] },
	});
}

/** Local files matching baseState(). */
export function baseFiles(): LocalFile[] {
	return [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10)];
}

export interface Parts {
	remote?: RemoteSnapshot;
	state?: SyncState;
	files?: LocalFile[];
	/** pathKeys of the paths the vault reported as changed since the last run. */
	dirty?: ReadonlySet<string>;
	/** Folders without notes. */
	extraFolders?: string[];
	remoteTrash?: ReadonlyMap<PageId, CollectiveId>;
	remoteChanged?: ReadonlySet<PageId>;
	decisions?: ReadonlyMap<string, Decision>;
	behaviour?: Partial<PlannerBehaviour>;
}

/** Builds the planner input the way the runner does: planLocalPaths over the remote trees, state folders as known folders. */
export function inputFor(parts: Parts = {}): PlannerInput {
	const remoteSnap = parts.remote ?? baseRemote();
	const state = parts.state ?? baseState();
	const files = parts.files ?? baseFiles();
	const trees: CollectiveTree[] = remoteSnap.collectives.map((rc) => ({
		collectiveId: rc.collective.id,
		name: rc.collective.name,
		pages: rc.pages,
	}));
	const knownFolders = new Map<CollectiveId, string>();
	for (const c of Object.values(state.collectives)) knownFolders.set(c.collectiveId, c.localFolder);
	const paths: PathPlan = planLocalPaths(trees, knownFolders);
	const remoteMeta = new Map<PageId, { meta: NcMeta; hash: string }>();
	for (const rc of remoteSnap.collectives) {
		for (const p of rc.pages) {
			const meta: NcMeta = {
				pageId: p.id,
				collectiveId: rc.collective.id,
				// Remote title as the runner passes it; the executor derives nc_title from the file name it writes to.
				title: p.title,
				emoji: p.emoji,
				tags: [],
			};
			remoteMeta.set(p.id, { meta, hash: `m${p.id}` });
		}
	}
	return {
		state,
		remote: remoteSnap,
		local: localSnapshot(files, parts.extraFolders),
		remoteMeta,
		paths,
		dirty: parts.dirty ?? new Set<string>(),
		...(parts.remoteTrash === undefined ? {} : { remoteTrash: parts.remoteTrash }),
		...(parts.remoteChanged === undefined ? {} : { remoteChanged: parts.remoteChanged }),
		...(parts.decisions === undefined ? {} : { decisions: parts.decisions }),
		...(parts.behaviour === undefined ? {} : { behaviour: parts.behaviour }),
	};
}

export function planFor(parts: Parts = {}): SyncPlan {
	return planSync(inputFor(parts));
}

export function opsOf<K extends SyncOp['kind']>(plan: SyncPlan, kind: K): Extract<SyncOp, { kind: K }>[] {
	return plan.ops.filter((op): op is Extract<SyncOp, { kind: K }> => op.kind === kind);
}

export function skipReasons(plan: SyncPlan): string[] {
	return plan.skips.map((s) => s.reason);
}

export function findSkip(plan: SyncPlan, reason: string): SyncPlan['skips'][number] | undefined {
	return plan.skips.find((s) => s.reason === reason);
}

