// Lookups over the remote page trees (architecture §4.4). Pure: no Obsidian, no network imports.
import type { CollectiveId, PageId, PageInfo } from '../api/types';
import type { RemoteSnapshot } from './remoteScanner';

export interface RemotePage {
	page: PageInfo;
	collectiveId: CollectiveId;
}

export interface TreeIndex {
	pages: Map<PageId, RemotePage>;
	children: Map<PageId, PageInfo[]>;
	/** The landing page (lowest id without parent) of each collective. */
	landing: Map<CollectiveId, PageId>;
	/** Number of pages per collective. */
	counts: Map<CollectiveId, number>;
}

export function buildTreeIndex(remote: RemoteSnapshot): TreeIndex {
	const pages = new Map<PageId, RemotePage>();
	const children = new Map<PageId, PageInfo[]>();
	const landing = new Map<CollectiveId, PageId>();
	const counts = new Map<CollectiveId, number>();
	for (const rc of remote.collectives) {
		counts.set(rc.collective.id, rc.pages.length);
		for (const page of rc.pages) {
			pages.set(page.id, { page, collectiveId: rc.collective.id });
			if (page.parentId === 0) {
				const current = landing.get(rc.collective.id);
				if (current === undefined || page.id < current) landing.set(rc.collective.id, page.id);
			} else {
				children.set(page.parentId, [...(children.get(page.parentId) ?? []), page]);
			}
		}
	}
	return { pages, children, landing, counts };
}

/** All pages below `pageId`, parents before children. */
export function descendantsOf(index: TreeIndex, pageId: PageId): PageInfo[] {
	const out: PageInfo[] = [];
	const queue: PageId[] = [pageId];
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		for (const child of index.children.get(next) ?? []) {
			out.push(child);
			queue.push(child.id);
		}
	}
	return out;
}

/** Number of ancestors of a page (the landing page has none). */
export function depthOf(index: TreeIndex, pageId: PageId): number {
	let depth = 0;
	let current = index.pages.get(pageId)?.page;
	while (current !== undefined && current.parentId !== 0 && depth < 1000) {
		depth++;
		current = index.pages.get(current.parentId)?.page;
	}
	return depth;
}
