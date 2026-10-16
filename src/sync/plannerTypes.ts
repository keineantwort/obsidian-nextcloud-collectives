// Types of the sync planner (PLAN §7.2, §7.4). Types only, no runtime code.
import type { CollectiveId, PageId, PageInfo } from '../api/types';
import type { NcMeta } from '../mapping/frontmatter';
import type { PathPlan } from '../mapping/paths';
import type { LocalSnapshot } from './localScanner';
import type { RemoteSnapshot } from './remoteScanner';
import type { CollectiveState, SyncState } from './state';
import type { Decision, Proposal, Skip } from './types';

/** Settings that change what the planner proposes (PLAN §10.2). */
export interface PlannerBehaviour {
	/** What happens to the local file of a page deleted on the server. */
	remoteDelete: 'obsidianTrash' | 'keepUnlinked';
	/** ask: confirm before a local deletion reaches the server. trashRemote: no question (except for mass deletions). */
	localDelete: 'ask' | 'trashRemote';
	/** What a new top-level folder becomes. */
	newFolder: 'createCollective' | 'ask' | 'ignore';
}

export const DEFAULT_BEHAVIOUR: PlannerBehaviour = { remoteDelete: 'obsidianTrash', localDelete: 'ask', newFolder: 'createCollective' };

/** A run deleting more than this share of a collective's pages is stopped and asked (PLAN §16). */
export const MASS_DELETE_SHARE = 0.2;
/** ...but only from this many pages on: deleting one page of a tiny collective is no incident. */
export const MASS_DELETE_MIN = 3;

export interface PlannerInput {
	state: SyncState;
	remote: RemoteSnapshot;
	local: LocalSnapshot;
	/** Precomputed by the runner: metaHash for each remote page (remote title, emoji, tag names). */
	remoteMeta: Map<PageId, { meta: NcMeta; hash: string }>;
	paths: PathPlan;
	/** pathKeys of the vault files changed since the last run (DirtyQueue.drain()). */
	dirty: ReadonlySet<string>;
	/** Pages in the server's trash whose id a local file carries (a restored file), found by the runner. */
	remoteTrash?: ReadonlyMap<PageId, CollectiveId>;
	/** Pages whose local file is missing and whose remote text differs from the base (the runner fetched them). */
	remoteChanged?: ReadonlySet<PageId>;
	/** Answers to the proposals of an earlier pass, by proposal id. */
	decisions?: ReadonlyMap<string, Decision>;
	behaviour?: Partial<PlannerBehaviour>;
}

type TagEntry = SyncState['tags'][string][number];

/** A page operation: the page, its local path and the metadata to write. */
export interface PageOpBase {
	page: PageInfo;
	path: string;
	meta: NcMeta;
	metaHash: string;
}

/** Where a page created or moved by the plugin hangs in the tree. */
export type ParentRef =
	/** A page the server knows. */
	| { kind: 'page'; pageId: PageId }
	/** A page this plan creates from the local file at `path` (created earlier in the same run). */
	| { kind: 'new'; path: string };

export type SyncOp =
	| { kind: 'ensureFolder'; path: string }
	| { kind: 'saveCollective'; collective: CollectiveState }
	| { kind: 'saveTags'; collectiveId: CollectiveId; tags: TagEntry[] }
	/** New page: create file at target.path (path free). */
	| ({ kind: 'create' } & PageOpBase)
	/** New page, target path held by a user file without nc_page_id: write remote as conflict copy next to it,
	 *  record state with status 'collision', localPath = the file's actual path, baseHash ''. */
	| ({ kind: 'createConflict' } & PageOpBase)
	/** Page not in state, but a local file carries its nc_page_id (state lost/reset): adopt. */
	| ({ kind: 'adopt' } & PageOpBase)
	/** Known page, remote mtime or size changed: fetch and compare. metaChanged = metaHash differs from the state. */
	| ({ kind: 'update'; metaChanged: boolean } & PageOpBase)
	/** Known page, remote unchanged since the state, local file changed: upload without fetching. */
	| ({ kind: 'push'; metaChanged: boolean } & PageOpBase)
	/** Known page, only metadata changed remotely. */
	| ({ kind: 'updateMeta' } & PageOpBase)
	/** Known page moved or renamed on the server (or into another collective): the local file follows. `path` is the target. */
	| ({ kind: 'renameLocal'; from: string } & PageOpBase)
	/** Local file without nc_page_id: a new page on the server. `fileExists` is false for a missing folder note. */
	| { kind: 'createRemote'; path: string; title: string; collectiveId: CollectiveId; parent: ParentRef; fileExists: boolean; order: number }
	/** Local file of a known page was renamed or moved. title/parent are null where they do not change. */
	| {
		kind: 'moveRemote';
		pageId: PageId;
		/** Collective the page is in now (state). */
		fromCollectiveId: CollectiveId;
		/** Collective the file is in now. */
		collectiveId: CollectiveId;
		path: string;
		title: string | null;
		parent: ParentRef | null;
		/** Folder-note file to rename once the server accepted the new title (the folder was renamed in the vault). */
		tidyTo: string | null;
		order: number;
	}
	/** Local deletion confirmed: the page with its sub-pages goes to the Collectives trash. */
	| { kind: 'trashRemote'; pageId: PageId; collectiveId: CollectiveId; descendants: { pageId: PageId; hasFile: boolean }[] }
	/** Page deleted on the server: the local file follows (or is revived if the user changed it). */
	| { kind: 'removeLocal'; pageId: PageId; collectiveId: CollectiveId; path: string; mode: PlannerBehaviour['remoteDelete'] }
	/** State entries of pages that are gone on both sides. */
	| { kind: 'dropState'; pageIds: PageId[]; collectiveIds: CollectiveId[]; unlinkPaths?: string[] }
	/** Local file with an nc_page_id reappeared, its page is in the Collectives trash: restore the page. */
	| { kind: 'restoreRemote'; pageId: PageId; collectiveId: CollectiveId; path: string }
	/** New top-level folder: a collective on the server. `landingFile` is the file named like the folder, or null. */
	| { kind: 'createCollective'; folder: string; landingFile: string | null }
	/** Local folder renamed (admin): rename the collective through the Circles API. */
	| { kind: 'renameCollective'; collectiveId: CollectiveId; circleId: string; name: string; folder: string }
	/** The local folder takes another name: the server's new name, or the old name again (no right to rename). */
	| { kind: 'renameCollectiveFolder'; collectiveId: CollectiveId; from: string; to: string; name: string }
	/** Local folder deletion confirmed: the collective goes to the Collectives trash. */
	| { kind: 'trashCollective'; collectiveId: CollectiveId; folder: string }
	/** Collective gone on the server, removal confirmed: the local folder goes to the trash. */
	| { kind: 'removeCollectiveLocal'; collectiveId: CollectiveId; folder: string };

export interface SyncPlan {
	ops: SyncOp[];
	skips: Skip[];
	/** Questions for the user. The runner asks them and plans again with the decisions. */
	proposals: Proposal[];
	/** True if the plan changes the structure so that another scan and plan can find more to do (PLAN §7.2, passes). */
	followUp: boolean;
}

export type PageOp = Extract<SyncOp, { page: PageInfo }>;

