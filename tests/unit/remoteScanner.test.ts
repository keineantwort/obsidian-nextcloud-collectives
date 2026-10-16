import { describe, expect, it } from 'vitest';
import type { CollectivesApi } from '../../src/api/collectivesApi';
import { asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { Collective, CollectiveId, PageInfo, Tag } from '../../src/api/types';
import { scanRemote } from '../../src/sync/remoteScanner';
import { ApiChangedError, AuthError, ForbiddenError, NetworkError, ServerError } from '../../src/util/errors';

type Api = Pick<CollectivesApi, 'listCollectives' | 'listPages' | 'listTags'>;

function collective(id: number, name: string, trashTimestamp: number | null = null): Collective {
	return {
		id: asCollectiveId(id),
		circleId: `circle-${id}`,
		name,
		slug: name.toLowerCase(),
		emoji: null,
		level: 9,
		canEdit: true,
		trashTimestamp,
	};
}

function page(id: number, collectiveId: number): PageInfo {
	return {
		id: asPageId(id),
		slug: `seite-${id}`,
		title: `Seite ${id}`,
		emoji: null,
		tags: [],
		timestamp: 1792138978,
		size: 10,
		fileName: `Seite ${id}.md`,
		filePath: '',
		collectivePath: `.Collectives/C${collectiveId}`,
		parentId: asPageId(0),
		subpageOrder: [],
		lastUserId: null,
		linkedPageIds: [],
		trashTimestamp: null,
	};
}

function tag(id: number, collectiveId: number): Tag {
	return { id: asTagId(id), collectiveId: asCollectiveId(collectiveId), name: `Tag ${id}`, color: '0082c9' };
}

/** Fake API: answers per collective id from the given tables; a value that is an Error is thrown instead. */
function fakeApi(options: {
	collectives: Collective[];
	pages?: Record<number, PageInfo[] | Error>;
	tags?: Record<number, Tag[] | Error>;
}): { api: Api; pageCalls: number[] } {
	const pageCalls: number[] = [];
	const api: Api = {
		listCollectives: async () => options.collectives,
		listPages: async (id: CollectiveId) => {
			pageCalls.push(Number(id));
			const answer = options.pages?.[Number(id)] ?? [];
			if (answer instanceof Error) throw answer;
			return answer;
		},
		listTags: async (id: CollectiveId) => {
			const answer = options.tags?.[Number(id)] ?? [];
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
	return { api, pageCalls };
}

describe('scanRemote', () => {
	it('returns no collectives for an account without collectives', async () => {
		const { api } = fakeApi({ collectives: [] });

		const snapshot = await scanRemote(api);

		expect(snapshot).toEqual({ collectives: [], failed: [] });
	});

	it('leaves out collectives in the trash and does not list their pages', async () => {
		const { api, pageCalls } = fakeApi({
			collectives: [collective(1, 'Aktiv'), collective(2, 'Papierkorb', 1792000000)],
			pages: { 1: [page(10, 1)] },
		});

		const snapshot = await scanRemote(api);

		expect(snapshot.collectives.map((rc) => Number(rc.collective.id))).toEqual([1]);
		expect(pageCalls).toEqual([1]);
	});

	it('attaches the pages and tags of each collective to that collective', async () => {
		const { api } = fakeApi({
			collectives: [collective(1, 'Eins'), collective(2, 'Zwei')],
			pages: { 1: [page(10, 1), page(11, 1)], 2: [page(20, 2)] },
			tags: { 1: [tag(5, 1)], 2: [] },
		});

		const snapshot = await scanRemote(api);

		const [first, second] = snapshot.collectives;
		expect(first?.pages.map((p) => Number(p.id))).toEqual([10, 11]);
		expect(first?.tags.map((t) => Number(t.id))).toEqual([5]);
		expect(second?.pages.map((p) => Number(p.id))).toEqual([20]);
		expect(second?.tags).toEqual([]);
		expect(snapshot.failed).toEqual([]);
	});

	it('moves a collective whose page list fails with ServerError(500) to failed and still scans the others', async () => {
		const broken = new ServerError(500);
		const { api } = fakeApi({
			collectives: [collective(1, 'Kaputt'), collective(2, 'Intakt')],
			pages: { 1: broken, 2: [page(20, 2)] },
		});

		const snapshot = await scanRemote(api);

		expect(snapshot.collectives.map((rc) => Number(rc.collective.id))).toEqual([2]);
		expect(snapshot.collectives[0]?.pages.map((p) => Number(p.id))).toEqual([20]);
		expect(snapshot.failed).toHaveLength(1);
		expect(Number(snapshot.failed[0]?.collective.id)).toBe(1);
		expect(snapshot.failed[0]?.error).toBe(broken);
	});

	it('moves a collective whose tag list is forbidden to failed, so its pages are not listed as scanned', async () => {
		const denied = new ForbiddenError();
		const { api } = fakeApi({
			collectives: [collective(1, 'Gesperrt'), collective(2, 'Offen')],
			pages: { 1: [page(10, 1)], 2: [page(20, 2)] },
			tags: { 1: denied },
		});

		const snapshot = await scanRemote(api);

		expect(snapshot.collectives.map((rc) => Number(rc.collective.id))).toEqual([2]);
		expect(snapshot.failed.map((f) => Number(f.collective.id))).toEqual([1]);
		expect(snapshot.failed[0]?.error).toBe(denied);
	});

	it.each([
		['AuthError', new AuthError(401)],
		['ApiChangedError', new ApiChangedError('unexpected shape')],
		['NetworkError', new NetworkError('offline')],
	])('rethrows %s and does not return a snapshot', async (_name, error) => {
		const { api } = fakeApi({
			collectives: [collective(1, 'Eins'), collective(2, 'Zwei')],
			pages: { 1: error, 2: [page(20, 2)] },
		});

		await expect(scanRemote(api)).rejects.toBe(error);
	});
});
