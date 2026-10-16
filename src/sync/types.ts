// Result types shared by planner, executor, runner and UI. Types only, no runtime code.
import type { CollectiveId, PageId } from '../api/types';

/** Why the sync left something alone. Each reason carries the fields the log and the UI can rely on. */
export type Skip =
	/** The parent of a remote page is missing in the listing; the page gets no local file. */
	| { reason: 'orphan'; pageId: PageId; collectiveId: CollectiveId }
	/** Two local files carry the same nc_page_id; the page is not touched. */
	| { reason: 'duplicateId'; pageId: PageId }
	/** A local file's nc_page_id is neither in the state, nor on the server, nor in the server's trash. */
	| { reason: 'unknownId'; pageId: PageId; path: string }
	/** The user postponed a question (closed the dialog); it is asked again in the next run. */
	| { reason: 'deferred'; proposalId: string }
	/** The local folder of a collective was renamed, but only admins may rename: the folder is renamed back. */
	| { reason: 'renameForbidden'; collectiveId: CollectiveId }
	/** The local folder of a collective was deleted, but only admins may delete: the folder is restored. */
	| { reason: 'deleteForbidden'; collectiveId: CollectiveId }
	/** Both sides moved or renamed the page differently; the remote location wins. */
	| { reason: 'remoteMoveWins'; pageId: PageId }
	/** A top-level folder is not turned into a collective (setting newFolderBehaviour = ignore, or the user said no). */
	| { reason: 'folderIgnored'; path: string }
	/** The collective of a local file could not be scanned in this run; its files are left alone. */
	| { reason: 'collectiveUnavailable'; collectiveId: CollectiveId };

export type SkipReason = Skip['reason'];

/** Answer to a question the planner asked (PLAN §7.4). 'defer' = ask again in the next run. */
export type Decision = 'accept' | 'reject' | 'defer';

/** More than the mass-delete limit of a collective's pages is deleted in one run (PLAN §16). */
export interface MassDelete {
	collectiveName: string;
	deleted: number;
	total: number;
}

/**
 * A destructive or surprising change the user must approve (PLAN §7.4). The planner returns proposals in its first
 * pass; the runner asks and plans again with the answers keyed by `id`.
 */
export type Proposal =
	/** Local page file deleted: move the page (with its sub-pages) to the Collectives trash? */
	| { id: string; kind: 'deletePage'; pageId: PageId; collectiveId: CollectiveId; title: string; path: string; descendants: number; mass: MassDelete | null }
	/** Local collective folder deleted: move the collective to the Collectives trash? */
	| { id: string; kind: 'deleteCollective'; collectiveId: CollectiveId; name: string; pages: number }
	/** The collective is gone on the server: move its local folder to the trash? */
	| { id: string; kind: 'removeCollectiveLocal'; collectiveId: CollectiveId; name: string; pages: number }
	/** New top-level folder: create a collective? Only asked with newFolderBehaviour = ask. */
	| { id: string; kind: 'newCollective'; folder: string; files: number };

/** Counters of one sync run. */
export interface SyncResult {
	/** Pages written to the vault as new files. */
	created: number;
	updated: number;
	pushed: number;
	metaUpdated: number;
	conflicts: number;
	unchanged: number;
	failed: number;
	/** Local files uploaded as new pages (also new collectives). */
	uploaded: number;
	/** Pages or collectives renamed or moved, in either direction. */
	moved: number;
	/** Pages or collectives moved to the Collectives trash. */
	trashed: number;
	/** Local files or folders moved to the Obsidian trash or unlinked because the server deleted them. */
	removed: number;
	/** Pages restored from the Collectives trash. */
	restored: number;
}

export function emptyResult(): SyncResult {
	return { created: 0, updated: 0, pushed: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0, uploaded: 0, moved: 0, trashed: 0, removed: 0, restored: 0 };
}

export type SyncRunOutcome =
	/** pages: pages linked to the vault after the run (state size), so an idle run can still report them. */
	| { kind: 'done'; result: SyncResult; skips: Skip[]; openConflicts: number; pages: number }
	| { kind: 'cancelled' }
	| { kind: 'serverMismatch'; stateServer: string }
	/** The state belongs to another Nextcloud account on the same server. Nothing was changed. */
	| { kind: 'accountMismatch'; stateUser: string; stateServer: string };
