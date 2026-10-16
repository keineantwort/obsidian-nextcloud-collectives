// Facts the executor learns while it runs (PLAN §7.2): pages whose location changed, pages created from local files.
import type { PageId, PageInfo } from '../api/types';
import { pathKey } from '../mapping/paths';
import type { ExecutorDeps } from './executorDeps';

export interface RunScratch {
	/** Pages as the server has them after one of our structure changes; later operations use these instead of the listing. */
	refreshed: Map<PageId, PageInfo>;
	/** pathKey of a local file → the page created from it in this run. */
	created: Map<string, PageId>;
}

const scratches = new WeakMap<ExecutorDeps, RunScratch>();

/** The scratch of one executeSync call, created on first use. */
export function scratchOf(deps: ExecutorDeps): RunScratch {
	let scratch = scratches.get(deps);
	if (scratch === undefined) {
		scratch = { refreshed: new Map<PageId, PageInfo>(), created: new Map<string, PageId>() };
		scratches.set(deps, scratch);
	}
	return scratch;
}

/** The page as the server has it now: refreshed by a structure change of this run, else as listed at planning time. */
export function livePage(deps: ExecutorDeps, page: PageInfo): PageInfo {
	return scratchOf(deps).refreshed.get(page.id) ?? page;
}

export function noteCreated(deps: ExecutorDeps, path: string, pageId: PageId): void {
	scratchOf(deps).created.set(pathKey(path), pageId);
}
