// Conflict list and resolution (PLAN §7.6, spec §7). No 'obsidian' import: trash and file access come through ResolutionVault.
import type { CollectiveId, PageId } from '../api/types';
import { replaceNcMeta, toRemote } from '../mapping/frontmatter';
import { sha256Hex } from '../util/hash';
import type { Logger } from '../util/logger';
import { indexFiles, locatePage } from './locate';
import type { Locatable } from './locate';
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

/**
 * Entries with the current local path: for status 'conflict' the path of the only file carrying the page's
 * nc_page_id (the state keeps the path of the last sync, which is stale after a local rename); otherwise, and if
 * no or several files carry the id, localPath stays as is.
 */
export function withCurrentPaths(entries: ConflictEntry[], files: readonly Locatable[]): ConflictEntry[] {
	const index = indexFiles(files);
	const moved = entries.map((entry): ConflictEntry => {
		if (entry.status !== 'conflict') return entry;
		const match = locatePage({ pageId: entry.pageId, status: entry.status, localPath: entry.localPath }, index);
		return match === undefined ? entry : { ...entry, localPath: match.path };
	});
	return moved.sort((a, b) => compareText(a.localPath, b.localPath));
}

/** Number of pages with status 'conflict' or 'collision'. */
export function countConflicts(state: SyncState): number {
	return Object.values(state.pages).filter((page) => openStatus(page) !== null).length;
}

/**
 * Pure state transition for a resolved conflict. `localHash` = sha256Hex(toRemote(current local text)).
 * "Take remote" also forgets the base of the metadata (metaHash ''): the next run takes the server's emoji and tags like it
 * takes the server's text.
 */
export function resolveConflict(prev: PageState, choice: ConflictChoice, localHash: string): PageState {
	if (choice === 'keepLocal') {
		// The base stays: it is the hash of the remote text the conflict was recorded against (see state.ts).
		return { ...prev, status: 'synced', conflictPath: null, localMtime: UNCHECKED_LOCAL_MTIME };
	}
	return {
		...prev,
		status: 'synced',
		conflictPath: null,
		baseHash: localHash,
		remoteMtime: UNCONFIRMED_REMOTE_MTIME,
		metaHash: '',
	};
}

/** Options of applyResolution; both are optional. */
export interface ResolutionOptions {
	/** Current path of the local file (see withCurrentPaths). Defaults to the path in the state. */
	localPath?: string;
	/**
	 * Conflict copy the user saw (the dialog may show an older one). If given and different from the page's current
	 * conflictPath, the choice is refused: the server version of the current copy was never shown.
	 */
	expectedConflictPath?: string | null;
}

/**
 * Legacy fallback for states written before M4, where a conflict had baseHash ''. keepLocal takes the base from the
 * conflict copy, which must be read before it is trashed: the copy holds the remote text the conflict was recorded against.
 */
async function withLegacyBase(vault: ResolutionVault, page: PageState): Promise<PageState> {
	if (page.baseHash !== '' || page.conflictPath === null || !vault.exists(page.conflictPath)) return page;
	return { ...page, baseHash: await sha256Hex(toRemote(await vault.read(page.conflictPath))) };
}

/**
 * Applies the user's choice for one page in `state` (mutates state.pages[id]). Returns false if the page is missing,
 * has no open conflict, or the options name a conflict copy that is no longer the page's conflict (nothing changes then).
 * The caller persists the state and then starts a sync run.
 * The state itself keeps its localPath (see `options.localPath`).
 */
export async function applyResolution(
	deps: { vault: ResolutionVault; state: SyncState; log: Logger },
	pageId: PageId,
	choice: ConflictChoice,
	options: ResolutionOptions = {},
): Promise<boolean> {
	const key = String(pageId);
	const prev = deps.state.pages[key];
	if (prev === undefined || openStatus(prev) === null) return false;
	if (options.expectedConflictPath !== undefined && options.expectedConflictPath !== prev.conflictPath) return false;
	const currentPath = options.localPath ?? prev.localPath;

	let page = prev;
	if (prev.status === 'collision') {
		// The user file has no nc_page_id yet: link it with the minimal nc fields. metaHash '' makes the next run rewrite them.
		const localMtime = await deps.vault.process(currentPath, (current) => replaceNcMeta(current, {
			pageId,
			collectiveId: prev.collectiveId,
			title: null,
			emoji: null,
			tags: [],
		}));
		page = { ...prev, metaHash: '', localMtime };
	}

	const localHash = await sha256Hex(toRemote(await deps.vault.read(currentPath)));
	const trashPath = page.conflictPath;
	const withBase = choice === 'keepLocal' ? await withLegacyBase(deps.vault, page) : page;
	deps.state.pages[key] = resolveConflict(withBase, choice, localHash);

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
