// Sync planner (architecture §6, §7). Pure: no Obsidian, no network. Decides which operations the executor runs.
import type { CollectiveId, PageInfo } from '../api/types';
import type { NcMeta } from '../mapping/frontmatter';
import { canonicalPath, pathKey } from '../mapping/paths';
import { locatePage } from './locate';
import { Placer } from './placement';
import { planCollectives } from './planFolders';
import { movedLocally, planFolderNoteTidy, planLocalDeletions, planLocalFiles, planLocalMove, planRemoteDeletions } from './planLocal';
import { comparePaths, createContext, depth, inBlockedDir, withoutEntries } from './plannerContext';
import type { Context } from './plannerContext';
import type { PageOp, PlannerInput, SyncOp, SyncPlan } from './plannerTypes';
import type { PageState } from './state';
import { depthOf } from './treeIndex';
import type { Skip, SkipReason } from './types';

export type { Skip, SkipReason };
export type { PlannerBehaviour, PlannerInput, SyncOp, SyncPlan } from './plannerTypes';
export { DEFAULT_BEHAVIOUR, MASS_DELETE_MIN, MASS_DELETE_SHARE } from './plannerTypes';

type TagEntry = PlannerInput['state']['tags'][string][number];

/** Order of the operation groups (architecture §7.2): folders, collectives, tags, local renames, structure on the server, content, deletions. */
const RANK: Record<SyncOp['kind'], number> = {
	ensureFolder: 0,
	saveCollective: 1,
	createCollective: 1,
	renameCollective: 1,
	renameCollectiveFolder: 1,
	renameFolderLocal: 1,
	saveTags: 2,
	renameLocal: 3,
	createRemote: 4,
	moveRemote: 4,
	restoreRemote: 4,
	create: 5,
	createConflict: 5,
	adopt: 5,
	update: 5,
	push: 5,
	updateMeta: 5,
	attachments: 5,
	trashRemote: 6,
	removeLocal: 6,
	trashCollective: 6,
	removeCollectiveLocal: 6,
	dropState: 6,
};

/**
 * Plans one sync run. Operations are ordered by RANK; within a group page operations go by target depth and path, structure
 * operations by their depth in the page tree. An unchanged world yields no operations, skips or proposals. A plan with
 * proposals is incomplete: the runner asks the user and plans again with the decisions.
 */
export function planSync(input: PlannerInput): SyncPlan {
	const ctx = createContext(input);
	planCollectives(ctx);
	if (ctx.restore.size > 0) ctx.state = withoutEntries(ctx.state, ctx.restore, new Set());
	planFolderNoteTidy(ctx);
	planLocalDeletions(ctx);
	const placer = new Placer(ctx);

	const folderPaths = new Set<string>();
	const collectiveSaves: SyncOp[] = [];
	const tagSaves: SyncOp[] = [];
	for (const rc of input.remote.collectives) {
		if (ctx.blocked.has(rc.collective.id)) continue;
		planRemoteCollective(rc.collective.id, rc.collective.name, rc.tags, ctx, folderPaths, collectiveSaves, tagSaves);
	}
	// Known pages first: their renames vacate paths that new pages may take.
	for (const known of [true, false]) {
		for (const rc of input.remote.collectives) {
			if (ctx.blocked.has(rc.collective.id)) continue;
			for (const page of rc.pages) {
				if ((ctx.state.pages[String(page.id)] !== undefined) === known) planRemotePage(page, rc.collective.id, ctx, placer);
			}
		}
	}
	planRemoteDeletions(ctx);
	planLocalFiles(ctx, placer);
	for (const pageId of ctx.files.duplicates) ctx.skips.push({ reason: 'duplicateId', pageId });

	assignOrders(ctx);
	const pageOps = [...ctx.pageOps].sort((a, b) => depth(a.path) - depth(b.path) || comparePaths(a.path, b.path));
	const ops: SyncOp[] = [
		...ensureFolderOps(folderPaths, pageOps, input.local.occupied),
		...collectiveSaves,
		...ctx.collectiveOps,
		...tagSaves,
		...pageOps.filter((op) => RANK[op.kind] === 3),
		...[...ctx.structureOps].sort(byOrder),
		...pageOps.filter((op) => RANK[op.kind] === 5),
		...ctx.finalOps,
	];
	ops.sort((a, b) => RANK[a.kind] - RANK[b.kind]); // stable: keeps the order inside each group
	return { ops, skips: ctx.skips, proposals: ctx.proposals, followUp: ctx.followUp };
}

function byOrder(a: SyncOp, b: SyncOp): number {
	const orderA = a.kind === 'createRemote' || a.kind === 'moveRemote' ? a.order : 0;
	const orderB = b.kind === 'createRemote' || b.kind === 'moveRemote' ? b.order : 0;
	return orderA - orderB || RANK[a.kind] - RANK[b.kind];
}

/** Gives each createRemote and moveRemote its depth in the page tree, so that parents are created before their children. */
function assignOrders(ctx: Context): void {
	const created = new Map<string, Extract<SyncOp, { kind: 'createRemote' }>>();
	for (const op of ctx.structureOps) if (op.kind === 'createRemote') created.set(pathKey(op.path), op);
	const memo = new Map<string, number>();
	const orderOf = (op: Extract<SyncOp, { kind: 'createRemote' | 'moveRemote' }>, visiting: Set<string>): number => {
		const parent = op.parent;
		if (parent === null) return 1;
		if (parent.kind === 'page') return depthOf(ctx.tree, parent.pageId) + 2;
		const key = pathKey(parent.path);
		const known = memo.get(key);
		if (known !== undefined) return known;
		const parentOp = created.get(key);
		if (parentOp === undefined || visiting.has(key)) return 1;
		visiting.add(key);
		const value = orderOf(parentOp, visiting) + 1;
		memo.set(key, value);
		return value;
	};
	for (const op of ctx.structureOps) {
		if (op.kind === 'createRemote' || op.kind === 'moveRemote') op.order = orderOf(op, new Set<string>());
	}
}

/** A collective new to the vault gets its folder and a state entry; changed tags are cached. */
function planRemoteCollective(
	collectiveId: CollectiveId,
	name: string,
	tags: readonly (TagEntry & { collectiveId?: unknown })[],
	ctx: Context,
	folderPaths: Set<string>,
	collectiveSaves: SyncOp[],
	tagSaves: SyncOp[],
): void {
	const { local, paths } = ctx.input;
	const planned = paths.collectiveFolders.get(collectiveId);
	if (planned === undefined) throw new Error(`planSync: no local folder planned for collective ${collectiveId}`);
	const folder = canonicalPath(planned, local.paths);
	if (ctx.state.collectives[String(collectiveId)] === undefined) {
		folderPaths.add(folder);
		collectiveSaves.push({ kind: 'saveCollective', collective: { collectiveId, name, localFolder: folder } });
	}
	const remoteTags = tagEntries(tags);
	const cachedTags = tagEntries(ctx.state.tags[String(collectiveId)] ?? []);
	if (JSON.stringify(remoteTags) !== JSON.stringify(cachedTags)) {
		tagSaves.push({ kind: 'saveTags', collectiveId, tags: remoteTags });
	}
}

function planRemotePage(page: PageInfo, collectiveId: CollectiveId, ctx: Context, placer: Placer): void {
	if (ctx.files.duplicates.has(page.id)) return;
	if (ctx.orphans.has(page.id)) {
		ctx.skips.push({ reason: 'orphan', pageId: page.id, collectiveId });
		return;
	}
	const remoteMeta = ctx.input.remoteMeta.get(page.id);
	if (remoteMeta === undefined) throw new Error(`planSync: no metadata planned for page ${page.id}`);
	const known = ctx.state.pages[String(page.id)];
	if (known === undefined) {
		planNewPage(page, remoteMeta, ctx);
	} else {
		planKnownPage(page, collectiveId, known, remoteMeta, ctx, placer);
	}
}

/**
 * Page unknown to the state: adopt a local file with its nc_page_id, else create at the target path. A user file without
 * nc_page_id on the target gets a conflict copy next to it. Any other occupied target (a file of another page, a folder,
 * a file claimed earlier in this plan) gets the next free suffixed name in the same folder.
 */
function planNewPage(page: PageInfo, remoteMeta: { meta: NcMeta; hash: string }, ctx: Context): void {
	const base = { page, meta: remoteMeta.meta, metaHash: remoteMeta.hash };
	const adoptable = ctx.files.byId.get(page.id);
	if (adoptable !== undefined) {
		ctx.pageOps.push({ kind: 'adopt', ...base, path: adoptable.path });
		return;
	}
	const target = ctx.input.paths.targets.get(page.id);
	if (target === undefined) throw new Error(`planSync: no target path planned for page ${page.id}`);
	const { local } = ctx.input;
	const path = canonicalPath(target.path, local.paths);
	if (inBlockedDir(ctx, path)) return;
	const key = pathKey(path);
	const userFile = local.files.find((file) => file.pageId === null && pathKey(file.path) === key);
	if (userFile !== undefined) {
		ctx.claimedUserFiles.add(key);
		ctx.pageOps.push({ kind: 'createConflict', ...base, path: userFile.path });
		return;
	}
	const free = freePath(path, (candidate) => isTaken(candidate, ctx));
	ctx.claimed.add(pathKey(free));
	ctx.pageOps.push({ kind: 'create', ...base, path: free });
}

/** A path another file holds in the vault (and keeps in this plan) or that an operation of this plan writes to. */
function isTaken(key: string, ctx: Context): boolean {
	return (ctx.input.local.occupied.has(key) && !ctx.vacated.has(key)) || ctx.claimed.has(key);
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

/**
 * Page known to the state. Its file was located by nc_page_id (a missing file was handled as a local deletion). A page moved
 * on the server moves its file, whatever the user did; a file the user moved alone moves the page. A changed remote leads to
 * an update (fetch and compare); otherwise a changed local file leads to a push; otherwise changed metadata to updateMeta.
 */
function planKnownPage(
	page: PageInfo,
	collectiveId: CollectiveId,
	known: PageState,
	remoteMeta: { meta: NcMeta; hash: string },
	ctx: Context,
	placer: Placer,
): void {
	const file = locatePage(known, ctx.files);
	if (file === undefined || inBlockedDir(ctx, file.path)) return;
	const meta = { page, meta: remoteMeta.meta, metaHash: remoteMeta.hash };
	let path = file.path;
	const remoteMoved =
		page.filePath !== known.remoteFilePath ||
		page.fileName !== known.remoteFileName ||
		page.parentId !== known.parentId ||
		collectiveId !== known.collectiveId;
	if (remoteMoved) {
		path = renameTarget(page, file.path, ctx);
		if (movedLocally(file, known) && pathKey(path) !== pathKey(file.path)) ctx.skips.push({ reason: 'remoteMoveWins', pageId: page.id });
		ctx.pageOps.push({ kind: 'renameLocal', from: file.path, path, ...meta });
	} else if (movedLocally(file, known)) {
		path = planLocalMove(page, known, file, ctx, placer);
	}

	const base = { ...meta, path };
	const metaChanged = remoteMeta.hash !== known.metaHash;
	const remoteCandidate = page.timestamp !== known.remoteMtime || page.size !== known.remoteSize;
	// A collision page is never pushed: its file is the user's own until the conflict is resolved.
	const localCandidate =
		known.status === 'synced' && (file.mtime !== known.localMtime || ctx.input.dirty.has(pathKey(file.path)));
	if (remoteCandidate) {
		ctx.pageOps.push({ kind: 'update', ...base, metaChanged });
	} else if (localCandidate) {
		ctx.pageOps.push({ kind: 'push', ...base, metaChanged });
	} else {
		if (metaChanged) ctx.pageOps.push({ kind: 'updateMeta', ...base });
		// Files of the page can change on the server without the page changing: compared every run (ETags, no transfer if equal).
		if (known.attachments.length > 0 && known.status !== 'collision') ctx.pageOps.push({ kind: 'attachments', ...base });
	}
}

/** Where the file of a page moved on the server goes: the planned target, or the next free suffixed name; the file itself if it is there already. */
function renameTarget(page: PageInfo, current: string, ctx: Context): string {
	const target = ctx.input.paths.targets.get(page.id);
	if (target === undefined) throw new Error(`planSync: no target path planned for page ${page.id}`);
	const { local } = ctx.input;
	const ideal = canonicalPath(target.path, local.paths);
	if (pathKey(ideal) === pathKey(current)) return current;
	const free = freePath(ideal, (candidate) => isTaken(candidate, ctx));
	ctx.claimed.add(pathKey(free));
	ctx.vacated.add(pathKey(current));
	return free;
}

/** Folder operations: new collective folders and the parent folders of created and renamed files, minus those already in the vault. */
function ensureFolderOps(folderPaths: Set<string>, pageOps: PageOp[], occupied: Set<string>): SyncOp[] {
	const folders = new Set(folderPaths);
	for (const op of pageOps) {
		if (op.kind !== 'create' && op.kind !== 'renameLocal') continue;
		const segments = op.path.split('/');
		for (let i = 1; i < segments.length; i++) {
			folders.add(segments.slice(0, i).join('/'));
		}
	}
	return [...folders]
		.filter((path) => !occupied.has(pathKey(path)))
		.sort((a, b) => depth(a) - depth(b) || comparePaths(a, b))
		.map((path): SyncOp => ({ kind: 'ensureFolder', path }));
}

/** Tag list in the canonical form compared against the state cache: sorted by id, only id, name and color. */
function tagEntries(tags: readonly TagEntry[]): TagEntry[] {
	return [...tags]
		.sort((a, b) => Number(a.id) - Number(b.id))
		.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
}
