// Result types shared by planner, executor, runner and UI. Types only, no runtime code.
import type { CollectiveId, PageId } from '../api/types';

/** Why the pull left a page or collective alone. Structural cases are handled from M5 on. */
export type SkipReason =
	| 'remoteMoved'        // filePath/fileName/parentId differ from state; content/meta still handled at the state's local path
	| 'remoteDeleted'      // in state, collective scanned OK, page missing
	| 'localDeleted'       // in state, no local file with that nc_page_id; never recreated
	| 'collectiveRenamed'  // remote name differs from the state name
	| 'collectiveRemoved'  // in state, neither in the remote list nor failed
	| 'orphan'             // parent missing remotely
	| 'duplicateId';       // two local files carry the same nc_page_id; the page is not touched

export interface Skip { reason: SkipReason; pageId?: PageId; collectiveId?: CollectiveId; path?: string; }

/** Counters of one pull run. */
export interface PullResult { created: number; updated: number; metaUpdated: number; conflicts: number; unchanged: number; failed: number; }

export type PullRunOutcome =
	| { kind: 'done'; result: PullResult; skips: Skip[] }
	| { kind: 'cancelled' }
	| { kind: 'serverMismatch'; stateServer: string };
