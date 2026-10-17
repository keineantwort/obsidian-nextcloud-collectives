// Finding the local file of a linked page (PLAN §6.3). Pure: no Obsidian, no network imports.
import type { PageId } from '../api/types';
import { pathKey } from '../mapping/paths';
import type { PageState } from './state';
import { isCollision } from './state';

/** The part of a scanned file that locating needs. */
export interface Locatable {
	path: string;
	/** nc_page_id from the frontmatter, or null. */
	pageId: PageId | null;
}

/** Files grouped for lookups: by nc_page_id, and the files without one by path. */
export interface FileIndex<F extends Locatable> {
	/** Pages with exactly one file. */
	byId: Map<PageId, F>;
	/** Pages whose id is carried by several files; they are never located. */
	duplicates: Set<PageId>;
	/** Files without nc_page_id, by pathKey. */
	unlinkedByPath: Map<string, F>;
}

export function indexFiles<F extends Locatable>(files: readonly F[]): FileIndex<F> {
	const groups = new Map<PageId, F[]>();
	const unlinkedByPath = new Map<string, F>();
	for (const file of files) {
		if (file.pageId === null) {
			unlinkedByPath.set(pathKey(file.path), file);
			continue;
		}
		groups.set(file.pageId, [...(groups.get(file.pageId) ?? []), file]);
	}
	const byId = new Map<PageId, F>();
	const duplicates = new Set<PageId>();
	for (const [pageId, group] of groups) {
		const [first] = group;
		if (group.length > 1 || first === undefined) duplicates.add(pageId);
		else byId.set(pageId, first);
	}
	return { byId, duplicates, unlinkedByPath };
}

/**
 * The local file of a known page. A collision page has no nc_page_id in its file, so it is found by its path (any case)
 * among the files without nc_page_id. Every other page is found by its nc_page_id only, wherever the user moved the file.
 */
export function locatePage<F extends Locatable>(known: Pick<PageState, 'pageId' | 'status' | 'localPath'>, index: FileIndex<F>): F | undefined {
	if (isCollision(known)) return index.unlinkedByPath.get(pathKey(known.localPath));
	return index.byId.get(known.pageId);
}
