import { describe, expect, it } from 'vitest';
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import { StateStore } from '../../src/sync/stateStore';
import type { StateFile } from '../../src/sync/stateStore';
import { emptyState, serializeSyncState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';

const SERVER = 'https://cloud.example.com';

/** In-memory StateFile that counts writes. `text` is what is currently stored (null = no file). */
class FakeStateFile implements StateFile {
	text: string | null = null;
	writes = 0;

	async read(): Promise<string | null> {
		return this.text;
	}

	async write(text: string): Promise<void> {
		this.text = text;
		this.writes++;
	}
}

function pageState(id: number): PageState {
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
		attachments: [{ id: asAttachmentId(7), name: 'bild.png', etag: 'a', localPath: 'Handbuch/.attachments.10/bild.png', hash: 'h' }],
		lastSyncedAt: 1792138999000,
	};
}

function stateWithPage(): SyncState {
	const state = emptyState(SERVER, 'alice');
	state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Handbuch', localFolder: 'Handbuch' };
	state.pages['10'] = pageState(10);
	state.tags['1'] = [{ id: asTagId(3), name: 'Projekt', color: '0082c9' }];
	return state;
}

describe('StateStore.load', () => {
	it('returns null when the state file does not exist', async () => {
		const store = new StateStore(new FakeStateFile());

		expect(await store.load()).toBeNull();
	});

	it('returns null when the stored text is not valid JSON', async () => {
		const file = new FakeStateFile();
		file.text = '{"schemaVersion": 1, "serverUrl": ';
		const store = new StateStore(file);

		expect(await store.load()).toBeNull();
	});

	it('returns null when the stored state has another schemaVersion', async () => {
		const file = new FakeStateFile();
		file.text = JSON.stringify({ ...stateWithPage(), schemaVersion: 2 });
		const store = new StateStore(file);

		expect(await store.load()).toBeNull();
	});

	it('returns the state that was saved, when read by a new store on the same file', async () => {
		const file = new FakeStateFile();
		const state = stateWithPage();
		await new StateStore(file).save(state);

		const loaded = await new StateStore(file).load();

		expect(loaded).toEqual(state);
	});
});

describe('StateStore.save', () => {
	it('writes the state on the first save and reports true', async () => {
		const file = new FakeStateFile();
		const state = stateWithPage();

		const written = await new StateStore(file).save(state);

		expect(written).toBe(true);
		expect(file.writes).toBe(1);
		expect(file.text).toBe(serializeSyncState(state));
	});

	it('does not write again when the same state is saved twice', async () => {
		const file = new FakeStateFile();
		const store = new StateStore(file);
		const state = stateWithPage();
		await store.save(state);

		const written = await store.save(state);

		expect(written).toBe(false);
		expect(file.writes).toBe(1);
	});

	it('writes again when the state changed', async () => {
		const file = new FakeStateFile();
		const store = new StateStore(file);
		const state = stateWithPage();
		await store.save(state);
		const changed = { ...state, pages: { ...state.pages, '10': { ...pageState(10), status: 'conflict' as const, conflictPath: 'Handbuch/Seite 10 (Konflikt 2026-10-16 1430).md' } } };

		const written = await store.save(changed);

		expect(written).toBe(true);
		expect(file.writes).toBe(2);
		expect(file.text).toBe(serializeSyncState(changed));
	});

	it('does not write an identical state after load, even if the stored text is formatted differently', async () => {
		const state = stateWithPage();
		const file = new FakeStateFile();
		file.text = JSON.stringify(state);
		const store = new StateStore(file);
		const loaded = await store.load();
		expect(loaded).not.toBeNull();

		const written = await store.save(loaded ?? state);

		expect(written).toBe(false);
		expect(file.writes).toBe(0);
		expect(file.text).toBe(JSON.stringify(state));
	});
});
