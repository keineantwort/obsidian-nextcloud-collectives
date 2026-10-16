import { describe, expect, it } from 'vitest';
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import { emptyState, parseSyncState, serializeSyncState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';

const SERVER = 'https://cloud.example.com';

function pageState(id: number, over: Partial<PageState> = {}): PageState {
	return {
		pageId: asPageId(id),
		collectiveId: asCollectiveId(1),
		localPath: `Handbuch/Seite ${id}.md`,
		localMtime: 1700,
		remoteFilePath: '',
		remoteFileName: `Seite ${id}.md`,
		parentId: asPageId(92),
		remoteEtag: `etag-${id}`,
		remoteMtime: 1792138978,
		remoteSize: 324,
		baseHash: `base-${id}`,
		metaHash: `meta-${id}`,
		status: 'synced',
		conflictPath: null,
		attachments: [{ id: asAttachmentId(7), name: 'bild.png', etag: 'a-etag', localPath: 'Handbuch/.attachments.10/bild.png' }],
		lastSyncedAt: 1792138999000,
		...over,
	};
}

/** A complete, valid state with two pages, one collective and one tag cache entry. */
function validState(): SyncState {
	return {
		schemaVersion: 1,
		serverUrl: SERVER,
		user: 'alice',
		collectives: { '1': { collectiveId: asCollectiveId(1), name: 'Handbuch', localFolder: 'Handbuch' } },
		pages: { '10': pageState(10), '92': pageState(92, { status: 'conflict', baseHash: '', conflictPath: 'Handbuch/Handbuch (Konflikt 2026-10-16 1430).md' }) },
		tags: { '1': [{ id: asTagId(3), name: 'Projekt', color: '#00ff00' }] },
	};
}

/** Deep copy of a valid state, mutated by `mutate`, typed as unknown like parsed JSON. */
function mutated(mutate: (raw: Record<string, unknown>) => void): unknown {
	const raw = JSON.parse(JSON.stringify(validState())) as Record<string, unknown>;
	mutate(raw);
	return raw;
}

describe('emptyState', () => {
	it('creates a version-1 state with the given server and user and no collectives, pages or tags', () => {
		expect(emptyState(SERVER, 'alice')).toEqual({
			schemaVersion: 1,
			serverUrl: SERVER,
			user: 'alice',
			collectives: {},
			pages: {},
			tags: {},
		});
	});
});

describe('parseSyncState', () => {
	it('accepts a valid state from its JSON form and returns an equal object', () => {
		const state = validState();
		expect(parseSyncState(JSON.parse(JSON.stringify(state)))).toEqual(state);
	});

	it('accepts the empty state', () => {
		const empty = emptyState(SERVER, 'alice');
		expect(parseSyncState(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
	});

	it('returns null for another schemaVersion', () => {
		expect(parseSyncState(mutated((raw) => { raw.schemaVersion = 2; }))).toBeNull();
	});

	it('returns null when a required page field is missing', () => {
		expect(parseSyncState(mutated((raw) => { delete (raw.pages as Record<string, Record<string, unknown>>)['10']?.remoteEtag; }))).toBeNull();
	});

	it('returns null for an unknown page status', () => {
		expect(parseSyncState(mutated((raw) => { (raw.pages as Record<string, Record<string, unknown>>)['10']!.status = 'bogus'; }))).toBeNull();
	});

	it.each([null, 'text', 42, []])('returns null for a non-object value (%j)', (raw) => {
		expect(parseSyncState(raw)).toBeNull();
	});
});

describe('serializeSyncState', () => {
	it('gives the same string for equal states whose pages were inserted in another order', () => {
		const state = validState();
		const reordered: SyncState = { ...state, pages: { '92': state.pages['92']!, '10': state.pages['10']! } };
		expect(serializeSyncState(reordered)).toBe(serializeSyncState(state));
	});

	it('gives the same string when the fields of a page object are in another order', () => {
		const state = validState();
		const fieldsReversed = Object.fromEntries(Object.entries(state.pages['10']!).reverse()) as unknown as PageState;
		expect(serializeSyncState({ ...state, pages: { ...state.pages, '10': fieldsReversed } })).toBe(serializeSyncState(state));
	});

	it('round-trips through parseSyncState', () => {
		const state = validState();
		expect(parseSyncState(JSON.parse(serializeSyncState(state)))).toEqual(state);
	});
});
