// Shared state of one planning run (PLAN §7.2). Pure: no Obsidian, no network imports.
import type { CollectiveId, PageId } from '../api/types';
import { pathKey } from '../mapping/paths';
import type { LocalFile } from './localScanner';
import { indexFiles } from './locate';
import type { FileIndex } from './locate';
import type { PageOp, PlannerBehaviour, PlannerInput, SyncOp } from './plannerTypes';
import { DEFAULT_BEHAVIOUR } from './plannerTypes';
import type { RemoteCollective } from './remoteScanner';
import type { SyncState } from './state';
import { buildTreeIndex } from './treeIndex';
import type { TreeIndex } from './treeIndex';
import type { Decision, Proposal, Skip } from './types';

export interface Context {
	input: PlannerInput;
	behaviour: PlannerBehaviour;
	/** The state the plan works on: the stored state minus what the user's answers or the rights made the plugin forget. */
	state: SyncState;
	decisions: ReadonlyMap<string, Decision>;
	tree: TreeIndex;
	files: FileIndex<LocalFile>;
	remoteCollectives: Map<CollectiveId, RemoteCollective>;
	/** Remote pages whose parent is missing in the listing. */
	orphans: Set<PageId>;
	scanned: Set<CollectiveId>;
	failed: Set<CollectiveId>;
	/** Collectives whose folder or existence changes in this plan: their pages wait for the next pass. */
	blocked: Set<CollectiveId>;
	/** pathKeys of folders renamed in this plan: what lies in them waits for the next pass. */
	blockedDirs: Set<string>;
	/** Collectives the plugin forgets so that they are pulled again (folder deleted without the right, or deletion refused). */
	restore: Set<CollectiveId>;
	skips: Skip[];
	proposals: Proposal[];
	/** Operations by group; the planner sorts and joins them (see planner.ts). */
	collectiveOps: SyncOp[];
	pageOps: PageOp[];
	structureOps: SyncOp[];
	finalOps: SyncOp[];
	/** pathKeys of the files that create and rename operations of this plan write to. */
	claimed: Set<string>;
	/** pathKeys of the paths files leave in this plan (renames); a new page may take them. */
	vacated: Set<string>;
	/** pathKeys of user files that got a conflict copy as new pages' target; they are not uploaded. */
	claimedUserFiles: Set<string>;
	followUp: boolean;
}

export function createContext(input: PlannerInput): Context {
	const failed = new Set<CollectiveId>(input.remote.failed.map((f) => f.collective.id));
	const remoteCollectives = new Map<CollectiveId, RemoteCollective>(input.remote.collectives.map((rc) => [rc.collective.id, rc]));
	return {
		input,
		behaviour: { ...DEFAULT_BEHAVIOUR, ...input.behaviour },
		state: input.state,
		decisions: input.decisions ?? new Map<string, Decision>(),
		tree: buildTreeIndex(input.remote),
		files: indexFiles(input.local.files),
		remoteCollectives,
		orphans: new Set<PageId>(input.paths.orphans),
		scanned: new Set<CollectiveId>(remoteCollectives.keys()),
		failed,
		blocked: new Set<CollectiveId>(),
		blockedDirs: new Set<string>(),
		restore: new Set<CollectiveId>(),
		skips: [],
		proposals: [],
		collectiveOps: [],
		pageOps: [],
		structureOps: [],
		finalOps: [],
		claimed: new Set<string>(),
		vacated: new Set<string>(),
		claimedUserFiles: new Set<string>(),
		followUp: false,
	};
}

/** The state without the given collectives and pages. The stored state is never changed. */
export function withoutEntries(state: SyncState, collectives: ReadonlySet<CollectiveId>, pages: ReadonlySet<PageId>): SyncState {
	const next: SyncState = { ...state, collectives: { ...state.collectives }, pages: { ...state.pages } };
	for (const id of collectives) delete next.collectives[String(id)];
	for (const page of Object.values(state.pages)) {
		if (collectives.has(page.collectiveId) || pages.has(page.pageId)) delete next.pages[String(page.pageId)];
	}
	return next;
}

/** Local folder of a collective: the state's folder, else the one planned for a collective that is new to the vault. */
export function folderOf(ctx: Context, collectiveId: CollectiveId): string | undefined {
	return ctx.state.collectives[String(collectiveId)]?.localFolder ?? ctx.input.paths.collectiveFolders.get(collectiveId);
}

/** pathKey of a collective's folder → collective, for the collectives the server lists (scanned and failed). */
export function collectivesByFolder(ctx: Context): Map<string, CollectiveId> {
	const out = new Map<string, CollectiveId>();
	for (const c of Object.values(ctx.state.collectives)) out.set(pathKey(c.localFolder), c.collectiveId);
	for (const [id, folder] of ctx.input.paths.collectiveFolders) {
		const key = pathKey(folder);
		if (!out.has(key)) out.set(key, id);
	}
	return out;
}

/** True if `path` lies in a folder that this plan renames. */
export function inBlockedDir(ctx: Context, path: string): boolean {
	const key = pathKey(path);
	for (const dir of ctx.blockedDirs) if (key.startsWith(dir + '/')) return true;
	return false;
}

export function dirnameOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

/** File name without '.md'. */
export function stemOf(path: string): string {
	const file = path.slice(path.lastIndexOf('/') + 1);
	return file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
}

export function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

export function depth(path: string): number {
	return path.split('/').length;
}

export function comparePaths(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
