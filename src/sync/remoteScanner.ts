// Types of the remote scan (PLAN §5). The scan function itself follows in a later step.
import type { Collective, PageInfo, Tag } from '../api/types';

export interface RemoteCollective {
	collective: Collective;
	pages: PageInfo[];
	tags: Tag[];
}

export interface RemoteSnapshot {
	collectives: RemoteCollective[];
	/** Collectives whose pages/tags could not be listed (error per collective, non-fatal). Their pages count as unknown, never as deleted. */
	failed: { collective: Collective; error: unknown }[];
}
