// Pull planner (PLAN §6, M3). Pure: no Obsidian, no network. Decides which operations the executor runs.
import type { CollectiveId, PageId, PageInfo } from '../api/types';
import type { NcMeta } from '../mapping/frontmatter';
import { canonicalPath, pathKey } from '../mapping/paths';
import type { PathPlan } from '../mapping/paths';
import type { LocalFile, LocalSnapshot } from './localScanner';
import type { RemoteSnapshot } from './remoteScanner';
import { isCollision } from './state';
import type { CollectiveState, PageState, SyncState } from './state';
import type { Skip, SkipReason } from './types';

export type { Skip, SkipReason };

export interface PlannerInput {
	state: SyncState;
	remote: RemoteSnapshot;
	local: LocalSnapshot;
	/** Precomputed by the runner: metaHash for each remote page (remote title, emoji, tag names). */
	remoteMeta: Map<PageId, { meta: NcMeta; hash: string }>;
	paths: PathPlan;
}

type TagEntry = SyncState['tags'][string][number];

/** A page operation: the page, its local path and the metadata to write. */
interface PageOpBase {
	page: PageInfo;
	path: string;
	meta: NcMeta;
	metaHash: string;
}

export type PullOp =
	| { kind: 'ensureFolder'; path: string }
	| { kind: 'saveCollective'; collective: CollectiveState }
	| { kind: 'saveTags'; collectiveId: CollectiveId; tags: SyncState['tags'][string] }
	/** New page: create file at target.path (path free). */
	| ({ kind: 'create' } & PageOpBase)
	/** New page, target path held by a user file without nc_page_id: write remote as conflict copy next to it,
	 *  record state with status 'collision', localPath = the file's actual path, baseHash ''. */
	| ({ kind: 'createConflict' } & PageOpBase)
	/** Page not in state, but a local file carries its nc_page_id (state lost/reset): adopt. */
	| ({ kind: 'adopt' } & PageOpBase)
	/** Known page, remote mtime or size changed: fetch and compare. metaChanged = metaHash differs from the state. */
	| ({ kind: 'update'; metaChanged: boolean } & PageOpBase)
	/** Known page, only metadata changed remotely. */
	| ({ kind: 'updateMeta' } & PageOpBase);

export interface PullPlan {
	ops: PullOp[];
	skips: Skip[];
}

type PageOp = Extract<PullOp, { page: PageInfo }>;

/** Shared state while planning one run. */
interface Context {
	input: PlannerInput;
	skips: Skip[];
	/** Local files by nc_page_id; only pages with exactly one file are in here, duplicates are in `duplicates`. */
	filesById: Map<PageId, LocalFile>;
	duplicates: Set<PageId>;
	orphans: Set<PageId>;
	pageOps: PageOp[];
	/** pathKeys of the files that create operations of this plan write to. */
	claimed: Set<string>;
}

/**
 * Plans one pull run (PLAN §6.3). Operations are ordered: folders (parents first), collective saves, tag saves,
 * then page operations by target depth and path. An unchanged remote yields no operations and no skips.
 */
export function planPull(input: PlannerInput): PullPlan {
	const { state, remote, local, paths } = input;
	const skips: Skip[] = [];
	const scanned = new Set<CollectiveId>(remote.collectives.map((rc) => rc.collective.id));
	const failed = new Set<CollectiveId>(remote.failed.map((f) => f.collective.id));
	const remotePageIds = new Set<PageId>();
	for (const rc of remote.collectives) for (const p of rc.pages) remotePageIds.add(p.id);

	const grouped = groupByPageId(local.files);
	const duplicates = new Set<PageId>();
	const filesById = new Map<PageId, LocalFile>();
	for (const [pageId, files] of grouped) {
		if (files.length > 1) {
			duplicates.add(pageId);
			skips.push({ reason: 'duplicateId', pageId });
			continue;
		}
		const [file] = files;
		if (file !== undefined) filesById.set(pageId, file);
	}

	const ctx: Context = {
		input,
		skips,
		filesById,
		duplicates,
		orphans: new Set(paths.orphans),
		pageOps: [],
		claimed: new Set<string>(),
	};

	const folderPaths = new Set<string>();
	const collectiveSaves: PullOp[] = [];
	const tagSaves: PullOp[] = [];
	for (const rc of remote.collectives) {
		const planned = paths.collectiveFolders.get(rc.collective.id);
		if (planned === undefined) throw new Error(`planPull: no local folder planned for collective ${rc.collective.id}`);
		const folder = canonicalPath(planned, local.paths);
		const known = state.collectives[String(rc.collective.id)];
		if (known === undefined) {
			folderPaths.add(folder);
			collectiveSaves.push({
				kind: 'saveCollective',
				collective: { collectiveId: rc.collective.id, name: rc.collective.name, localFolder: folder },
			});
		} else if (known.name !== rc.collective.name) {
			skips.push({ reason: 'collectiveRenamed', collectiveId: rc.collective.id });
		}
		const remoteTags = tagEntries(rc.tags);
		const cachedTags = tagEntries(state.tags[String(rc.collective.id)] ?? []);
		if (JSON.stringify(remoteTags) !== JSON.stringify(cachedTags)) {
			tagSaves.push({ kind: 'saveTags', collectiveId: rc.collective.id, tags: remoteTags });
		}
	}

	for (const rc of remote.collectives) {
		for (const page of rc.pages) planRemotePage(page, rc.collective.id, ctx);
	}

	for (const collective of Object.values(state.collectives)) {
		if (!scanned.has(collective.collectiveId) && !failed.has(collective.collectiveId)) {
			skips.push({ reason: 'collectiveRemoved', collectiveId: collective.collectiveId });
		}
	}
	for (const known of Object.values(state.pages)) {
		if (duplicates.has(known.pageId) || remotePageIds.has(known.pageId)) continue;
		if (scanned.has(known.collectiveId)) {
			skips.push({ reason: 'remoteDeleted', pageId: known.pageId, collectiveId: known.collectiveId });
		}
	}

	const pageOps = [...ctx.pageOps].sort((a, b) => depth(a.path) - depth(b.path) || comparePaths(a.path, b.path));
	const ops: PullOp[] = [
		...ensureFolderOps(folderPaths, pageOps, local.occupied),
		...collectiveSaves,
		...tagSaves,
		...pageOps,
	];
	return { ops, skips };
}

function planRemotePage(page: PageInfo, collectiveId: CollectiveId, ctx: Context): void {
	if (ctx.duplicates.has(page.id)) return;
	if (ctx.orphans.has(page.id)) {
		ctx.skips.push({ reason: 'orphan', pageId: page.id, collectiveId });
		return;
	}
	const remoteMeta = ctx.input.remoteMeta.get(page.id);
	if (remoteMeta === undefined) throw new Error(`planPull: no metadata planned for page ${page.id}`);
	const known = ctx.input.state.pages[String(page.id)];
	if (known === undefined) {
		planNewPage(page, remoteMeta, ctx);
	} else {
		planKnownPage(page, known, remoteMeta, ctx);
	}
}

/**
 * Page unknown to the state: adopt a local file with its nc_page_id, else create at the target path. A user file without
 * nc_page_id on the target gets a conflict copy next to it. Any other occupied target (a file of another page, a folder,
 * a file claimed earlier in this plan) gets the next free suffixed name in the same folder.
 */
function planNewPage(page: PageInfo, remoteMeta: { meta: NcMeta; hash: string }, ctx: Context): void {
	const base = { page, meta: remoteMeta.meta, metaHash: remoteMeta.hash };
	const adoptable = ctx.filesById.get(page.id);
	if (adoptable !== undefined) {
		ctx.pageOps.push({ kind: 'adopt', ...base, path: adoptable.path });
		return;
	}
	const target = ctx.input.paths.targets.get(page.id);
	if (target === undefined) throw new Error(`planPull: no target path planned for page ${page.id}`);
	const { local } = ctx.input;
	const path = canonicalPath(target.path, local.paths);
	const key = pathKey(path);
	const userFile = local.files.find((file) => file.pageId === null && pathKey(file.path) === key);
	if (userFile !== undefined) {
		ctx.pageOps.push({ kind: 'createConflict', ...base, path: userFile.path });
		return;
	}
	const free = freePath(path, (candidate) => local.occupied.has(candidate) || ctx.claimed.has(candidate));
	ctx.claimed.add(pathKey(free));
	ctx.pageOps.push({ kind: 'create', ...base, path: free });
}

/** `path` if `taken` does not hold its key, else the first `dir/Name (n).md` (n >= 2) that is free. */
function freePath(path: string, taken: (key: string) => boolean): string {
	if (!taken(pathKey(path))) return path;
	const slash = path.lastIndexOf('/');
	const dir = path.slice(0, slash + 1);
	const stem = path.slice(slash + 1, -'.md'.length);
	for (let n = 2; ; n++) {
		const candidate = `${dir}${stem} (${n}).md`;
		if (!taken(pathKey(candidate))) return candidate;
	}
}

/** Page known to the state: skip if its local file is gone or moved; otherwise update or updateMeta. */
function planKnownPage(page: PageInfo, known: PageState, remoteMeta: { meta: NcMeta; hash: string }, ctx: Context): void {
	const file = findKnownFile(known, ctx);
	if (file === undefined) {
		ctx.skips.push({ reason: 'localDeleted', pageId: page.id, collectiveId: known.collectiveId, path: known.localPath });
		return;
	}
	if (page.filePath !== known.remoteFilePath || page.fileName !== known.remoteFileName || page.parentId !== known.parentId) {
		ctx.skips.push({ reason: 'remoteMoved', pageId: page.id, collectiveId: known.collectiveId, path: file.path });
	}
	const base = { page, path: file.path, meta: remoteMeta.meta, metaHash: remoteMeta.hash };
	if (page.timestamp !== known.remoteMtime || page.size !== known.remoteSize) {
		ctx.pageOps.push({ kind: 'update', ...base, metaChanged: remoteMeta.hash !== known.metaHash });
	} else if (remoteMeta.hash !== known.metaHash) {
		ctx.pageOps.push({ kind: 'updateMeta', ...base });
	}
}

/**
 * The local file of a known page. A collision page has no nc_page_id in its file, so it is found by its path (any case)
 * among the files without nc_page_id. Every other page is found by its nc_page_id only.
 */
function findKnownFile(known: PageState, ctx: Context): LocalFile | undefined {
	if (isCollision(known)) {
		const key = pathKey(known.localPath);
		return ctx.input.local.files.find((file) => file.pageId === null && pathKey(file.path) === key);
	}
	return ctx.filesById.get(known.pageId);
}

/** Folder operations: new collective folders and the parent folders of created files, minus those already in the vault. */
function ensureFolderOps(folderPaths: Set<string>, pageOps: PageOp[], occupied: Set<string>): PullOp[] {
	const folders = new Set(folderPaths);
	for (const op of pageOps) {
		if (op.kind !== 'create') continue;
		const segments = op.path.split('/');
		for (let i = 1; i < segments.length; i++) {
			folders.add(segments.slice(0, i).join('/'));
		}
	}
	return [...folders]
		.filter((path) => !occupied.has(pathKey(path)))
		.sort((a, b) => depth(a) - depth(b) || comparePaths(a, b))
		.map((path): PullOp => ({ kind: 'ensureFolder', path }));
}

function groupByPageId(files: LocalFile[]): Map<PageId, LocalFile[]> {
	const groups = new Map<PageId, LocalFile[]>();
	for (const file of files) {
		if (file.pageId === null) continue;
		groups.set(file.pageId, [...(groups.get(file.pageId) ?? []), file]);
	}
	return groups;
}

/** Tag list in the canonical form compared against the state cache: sorted by id, only id, name and color. */
function tagEntries(tags: readonly TagEntry[]): TagEntry[] {
	return [...tags]
		.sort((a, b) => Number(a.id) - Number(b.id))
		.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
}

function depth(path: string): number {
	return path.split('/').length;
}

function comparePaths(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
