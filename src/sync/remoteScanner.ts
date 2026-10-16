// Remote scan (PLAN §5): collectives, pages and tags from the Collectives OCS API.
import type { CollectivesApi } from '../api/collectivesApi';
import type { Collective, PageInfo, Tag } from '../api/types';
import { ApiChangedError, AuthError, NetworkError } from '../util/errors';

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

/** Errors that abort the whole run: the connection or the server contract is broken, so no partial snapshot is trusted. */
function abortsRun(err: unknown): boolean {
	return err instanceof AuthError || err instanceof ApiChangedError || err instanceof NetworkError;
}

/** listCollectives (only trashTimestamp === null), then per collective listPages + listTags.
 *  AuthError, ApiChangedError, NetworkError are rethrown (abort the run); other errors per collective → failed. */
export async function scanRemote(api: Pick<CollectivesApi, 'listCollectives' | 'listPages' | 'listTags'>): Promise<RemoteSnapshot> {
	const all = await api.listCollectives();
	const snapshot: RemoteSnapshot = { collectives: [], failed: [] };
	for (const collective of all) {
		if (collective.trashTimestamp !== null) continue;
		try {
			const pages = await api.listPages(collective.id);
			const tags = await api.listTags(collective.id);
			snapshot.collectives.push({ collective, pages, tags });
		} catch (err) {
			if (abortsRun(err)) throw err;
			snapshot.failed.push({ collective, error: err });
		}
	}
	return snapshot;
}
