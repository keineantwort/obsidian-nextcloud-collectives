// Result types shared by planner, executor, runner and UI. Types only, no runtime code.
import type { CollectiveId, PageId } from '../api/types';

/** Why the sync left a page or collective alone. Structural cases are handled from M5 on. */
export type SkipReason =
	| 'remoteMoved'        // filePath/fileName/parentId differ from state; content/meta still handled at the state's local path
	| 'remoteDeleted'      // in state, collective scanned OK, page missing
	| 'localDeleted'       // in state, no local file with that nc_page_id; never recreated
	| 'collectiveRenamed'  // remote name differs from the state name
	| 'collectiveRemoved'  // in state, neither in the remote list nor failed
	| 'orphan'             // parent missing remotely
	| 'duplicateId';       // two local files carry the same nc_page_id; the page is not touched

export interface Skip { reason: SkipReason; pageId?: PageId; collectiveId?: CollectiveId; path?: string; }

/** Counters of one sync run. */
export interface SyncResult { created: number; updated: number; pushed: number; metaUpdated: number; conflicts: number; unchanged: number; failed: number; }

export type SyncRunOutcome =
	| { kind: 'done'; result: SyncResult; skips: Skip[]; openConflicts: number }
	| { kind: 'cancelled' }
	| { kind: 'serverMismatch'; stateServer: string }
	/** The state belongs to another Nextcloud account on the same server. Nothing was changed. */
	| { kind: 'accountMismatch'; stateUser: string; stateServer: string };
