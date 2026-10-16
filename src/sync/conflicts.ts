// Conflict list and resolution (PLAN §7.6, spec §7). No 'obsidian' import: trash and file access come through ResolutionVault.
import type { CollectiveId, PageId } from '../api/types';
import { replaceNcMeta, toRemote } from '../mapping/frontmatter';
import { sha256Hex } from '../util/hash';
import type { Logger } from '../util/logger';
import { UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME } from './state';
import type { PageState, SyncState } from './state';

export type ConflictChoice = 'keepLocal' | 'takeRemote';

export interface ConflictEntry {
	pageId: PageId;
	collectiveId: CollectiveId;
	status: 'conflict' | 'collision';
	localPath: string;
	conflictPath: string | null;
}

/** Vault operations used to resolve a conflict; implemented over app.vault and app.fileManager in main.ts. */
export interface ResolutionVault {
	read(path: string): Promise<string>;
	/** Atomic read-modify-write; returns the mtime after the write. */
	process(path: string, fn: (current: string) => string): Promise<number>;
	exists(path: string): boolean;
	/** Moves a file to the trash per the user's Obsidian setting (app.fileManager.trashFile). */
	trash(path: string): Promise<void>;
}

/** Status of a page that needs the user, or null. */
function openStatus(page: PageState): ConflictEntry['status'] | null {
	return page.status === 'conflict' || page.status === 'collision' ? page.status : null;
}

/** Code-unit order, so that the list does not depend on the locale. */
function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/** Pages with status 'conflict' or 'collision', sorted by localPath. */
export function listConflicts(state: SyncState): ConflictEntry[] {
	const entries: ConflictEntry[] = [];
	for (const page of Object.values(state.pages)) {
		const status = openStatus(page);
		if (status === null) continue;
		entries.push({
			pageId: page.pageId,
			collectiveId: page.collectiveId,
			status,
			localPath: page.localPath,
			conflictPath: page.conflictPath,
		});
	}
	return entries.sort((a, b) => compareText(a.localPath, b.localPath));
}

/** Number of pages with status 'conflict' or 'collision'. */
export function countConflicts(state: SyncState): number {
	return Object.values(state.pages).filter((page) => openStatus(page) !== null).length;
}

/** Pure state transition for a resolved conflict. `localHash` = sha256Hex(toRemote(current local text)). */
export function resolveConflict(prev: PageState, choice: ConflictChoice, localHash: string): PageState {
	if (choice === 'keepLocal') {
		return { ...prev, status: 'synced', conflictPath: null, baseHash: '', localMtime: UNCHECKED_LOCAL_MTIME };
	}
	return { ...prev, status: 'synced', conflictPath: null, baseHash: localHash, remoteMtime: UNCONFIRMED_REMOTE_MTIME };
}

/**
 * Applies the user's choice for one page in `state` (mutates state.pages[id]). Returns false if the page is missing
 * or has no open conflict. The caller persists the state and then starts a sync run.
 */
export async function applyResolution(
	deps: { vault: ResolutionVault; state: SyncState; log: Logger },
	pageId: PageId,
	choice: ConflictChoice,
): Promise<boolean> {
	const key = String(pageId);
	const prev = deps.state.pages[key];
	if (prev === undefined || openStatus(prev) === null) return false;

	let page = prev;
	if (prev.status === 'collision') {
		// The user file has no nc_page_id yet: link it with the minimal nc fields. metaHash '' makes the next run rewrite them.
		const localMtime = await deps.vault.process(prev.localPath, (current) => replaceNcMeta(current, {
			pageId,
			collectiveId: prev.collectiveId,
			title: null,
			emoji: null,
			tags: [],
		}));
		page = { ...prev, metaHash: '', localMtime };
	}

	const localHash = await sha256Hex(toRemote(await deps.vault.read(page.localPath)));
	const trashPath = page.conflictPath;
	deps.state.pages[key] = resolveConflict(page, choice, localHash);

	if (trashPath !== null && deps.vault.exists(trashPath)) {
		try {
			await deps.vault.trash(trashPath);
		} catch (err) {
			// Only the error class is logged: messages may contain URLs or credentials.
			deps.log.warn('Conflict copy could not be moved to trash', { pageId, error: err instanceof Error ? err.name : 'unknown' });
		}
	}
	return true;
}
