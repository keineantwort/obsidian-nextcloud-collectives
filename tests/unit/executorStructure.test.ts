// M5 (PLAN §7.4): the executor's structure operations against a fake Collectives API, a fake WebDAV and an in-memory vault.
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import type { PageInfo } from '../../src/api/types';
import { readNcMeta, readPageId, stripNcMeta, toLocal, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { executeSync } from '../../src/sync/executor';
import type { ExecutorDeps } from '../../src/sync/executor';
import type { SyncOp, SyncPlan } from '../../src/sync/planner';
import { UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME, emptyState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { emptyResult } from '../../src/sync/types';
import { sha256Hex } from '../../src/util/hash';
import { NotFoundError } from '../../src/util/errors';
import { Logger } from '../../src/util/logger';
import { FakeApi } from '../fakes/fakeApi';
import { FakeDav } from '../fakes/fakeDav';
import { MemoryVault } from '../fakes/memoryVault';

const NOW = new Date(2026, 9, 16, 14, 30);
const COLL = asCollectiveId(1);
const LANDING = asPageId(100);

interface H {
	vault: MemoryVault;
	dav: FakeDav;
	api: FakeApi;
	state: SyncState;
	deps: ExecutorDeps;
	trashed: string[];
}

/** Collective 1 "Coll" with its landing page (id 100), known to the state and in the vault. */
function harness(): H {
	const vault = new MemoryVault();
	const dav = new FakeDav();
	const api = new FakeApi(dav);
	api.addCollective(1, 'Coll');
	const state = emptyState('https://cloud.example.com', 'alice-id');
	state.collectives['1'] = { collectiveId: COLL, name: 'Coll', localFolder: 'Coll' };
	state.tags['1'] = [];
	const trashed: string[] = [];
	const deps: ExecutorDeps = {
		vault: {
			exists: (p) => vault.exists(p),
			read: (p) => vault.read(p),
			create: (p, c) => vault.create(p, c),
			process: (p, f) => vault.process(p, f),
			createFolder: (p) => vault.createFolder(p),
			mtime: (p) => vault.mtime(p),
			rename: (a, b) => vault.rename(a, b),
			trash: async (p) => {
				trashed.push(p);
				await vault.trash(p);
			},
		},
		webdav: dav.webdav,
		api,
		state,
		persist: async () => undefined,
		now: () => NOW,
		conflictLabel: 'Konflikt',
		strategy: 'conflictFile',
		sleep: async () => undefined,
		log: new Logger(),
		occupied: new Set<string>(),
	};
	vault.seedFolder('Coll');
	return { vault, dav, api, state, deps, trashed };
}

function plan(ops: SyncOp[]): SyncPlan {
	return { ops, skips: [], proposals: [], followUp: false };
}

function metaOf(pageId: number, over: Partial<NcMeta> = {}): NcMeta {
	return { pageId: asPageId(pageId), collectiveId: COLL, title: null, emoji: null, tags: [], ...over };
}

/** A page the state knows as synced, with `text` as its local file and base. */
async function known(h: H, page: PageInfo, localPath: string, text: string, over: Partial<PageState> = {}): Promise<void> {
	h.vault.seed(localPath, toLocal(text, metaOf(page.id, { collectiveId: asCollectiveId(1) })));
	h.state.pages[String(page.id)] = {
		pageId: page.id,
		collectiveId: COLL,
		localPath,
		localMtime: h.vault.mtime(localPath) ?? 0,
		remoteFilePath: page.filePath,
		remoteFileName: page.fileName,
		parentId: page.parentId,
		remoteEtag: `"e-${page.id}"`,
		remoteMtime: page.timestamp,
		remoteSize: page.size,
		baseHash: await sha256Hex(toRemote(text)),
		metaHash: 'm',
		status: 'synced',
		conflictPath: null,
		attachments: [],
		lastSyncedAt: 1,
		...over,
	};
	h.dav.serve(page, text, `"e-${page.id}"`);
}

function stateOf(h: H, id: number): PageState {
	const entry = h.state.pages[String(id)];
	if (entry === undefined) throw new Error(`no state for page ${id}`);
	return entry;
}

describe('renameLocal (remote moved or renamed the page)', () => {
	it('renames the file, follows the server in the state and writes the new collective into the nc fields', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Alt', parentId: LANDING });
		await known(h, page, 'Coll/Alt.md', 'Text');
		const moved: PageInfo = { ...page, title: 'Neu', fileName: 'Neu.md' };
		h.vault.seedFolder('Zwei');
		const meta = metaOf(page.id, { collectiveId: asCollectiveId(2) });

		const result = await executeSync(plan([{ kind: 'renameLocal', from: 'Coll/Alt.md', page: moved, path: 'Zwei/Neu.md', meta, metaHash: 'm2' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), moved: 1 });
		expect(h.vault.exists('Coll/Alt.md')).toBe(false);
		expect(readNcMeta(await h.vault.read('Zwei/Neu.md'))).toMatchObject({ pageId: page.id, collectiveId: 2 });
		expect(stateOf(h, page.id)).toMatchObject({ localPath: 'Zwei/Neu.md', collectiveId: 2, remoteFileName: 'Neu.md' });
	});

	it('keeps the local mtime of the state when the user edited the file, so the edit is still pushed', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Alt', parentId: LANDING });
		await known(h, page, 'Coll/Alt.md', 'Text');
		const before = stateOf(h, page.id).localMtime;
		h.vault.userEdit('Coll/Alt.md', `${await h.vault.read('Coll/Alt.md')}mehr\n`);

		await executeSync(plan([{ kind: 'renameLocal', from: 'Coll/Alt.md', page, path: 'Coll/Neu.md', meta: metaOf(page.id), metaHash: 'm' }]), h.deps);

		expect(stateOf(h, page.id).localMtime).toBe(before);
	});

	it('fails the page, and leaves the file where it is, when the target exists', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Alt', parentId: LANDING });
		await known(h, page, 'Coll/Alt.md', 'Text');
		h.vault.seed('Coll/Neu.md', 'andere Datei');

		const result = await executeSync(plan([{ kind: 'renameLocal', from: 'Coll/Alt.md', page, path: 'Coll/Neu.md', meta: metaOf(page.id), metaHash: 'm' }]), h.deps);

		expect(result.failed).toBe(1);
		expect(h.vault.exists('Coll/Alt.md')).toBe(true);
		expect(await h.vault.read('Coll/Neu.md')).toBe('andere Datei');
	});
});

describe('createRemote (local file without nc_page_id)', () => {
	const create = (path: string, over: Partial<Extract<SyncOp, { kind: 'createRemote' }>> = {}): SyncOp => ({
		kind: 'createRemote', path, title: 'Neu', collectiveId: COLL, parent: { kind: 'page', pageId: LANDING }, fileExists: true, order: 2, ...over,
	});

	it('creates the page, writes the id into the file and uploads the text', async () => {
		const h = harness();
		h.vault.seed('Coll/Neu.md', 'Mein Text\n');

		const result = await executeSync(plan([create('Coll/Neu.md')]), h.deps);

		expect(result).toEqual({ ...emptyResult(), uploaded: 1 });
		expect(h.api.calls).toContain(`createPage 1 ${LANDING} Neu`);
		const id = readPageId(await h.vault.read('Coll/Neu.md'));
		expect(id).not.toBeNull();
		const page = [...h.api.entries.values()].find((e) => e.page.title === 'Neu')?.page;
		expect(page?.id).toBe(id);
		expect(h.dav.content(page as PageInfo)).toBe('Mein Text');
		expect(stateOf(h, id as number)).toMatchObject({ localPath: 'Coll/Neu.md', status: 'synced', baseHash: await sha256Hex('Mein Text'), remoteMtime: UNCONFIRMED_REMOTE_MTIME });
	});

	it('uploads nothing for an empty file', async () => {
		const h = harness();
		h.vault.seed('Coll/Leer.md', '');

		await executeSync(plan([create('Coll/Leer.md', { title: 'Leer' })]), h.deps);

		expect(h.dav.puts()).toEqual([]);
		expect(readPageId(await h.vault.read('Coll/Leer.md'))).not.toBeNull();
	});

	it('creates the parent from a local file first and hangs the child below it', async () => {
		const h = harness();
		h.vault.seed('Coll/Eltern.md', 'Eltern\n');
		h.vault.seed('Coll/Eltern/Kind.md', 'Kind\n');

		const result = await executeSync(plan([
			create('Coll/Eltern.md', { title: 'Eltern' }),
			create('Coll/Eltern/Kind.md', { title: 'Kind', parent: { kind: 'new', path: 'Coll/Eltern.md' }, order: 3 }),
		]), h.deps);

		expect(result.uploaded).toBe(2);
		const eltern = readPageId(await h.vault.read('Coll/Eltern.md'));
		expect(h.api.calls).toContain(`createPage 1 ${eltern} Kind`);
		// The parent was a leaf: the server turned it into a folder page, so the executor looked at it again.
		expect(h.api.calls).toContain(`getPage 1 ${eltern}`);
	});

	it('creates the note of a folder page for a folder that had none', async () => {
		const h = harness();
		h.vault.seedFolder('Coll/Ordner');

		await executeSync(plan([create('Coll/Ordner/Ordner.md', { title: 'Ordner', fileExists: false })]), h.deps);

		const id = readPageId(await h.vault.read('Coll/Ordner/Ordner.md'));
		expect(id).not.toBeNull();
		expect(stateOf(h, id as number)).toMatchObject({ localPath: 'Coll/Ordner/Ordner.md', status: 'synced' });
	});

	it('fails the page, and creates nothing, when the parent was not created', async () => {
		const h = harness();
		h.vault.seed('Coll/Eltern/Kind.md', 'Kind\n');

		const result = await executeSync(plan([create('Coll/Eltern/Kind.md', { title: 'Kind', parent: { kind: 'new', path: 'Coll/Eltern/Eltern.md' } })]), h.deps);

		expect(result.failed).toBe(1);
		expect(h.api.calls.filter((c) => c.startsWith('createPage'))).toEqual([]);
		expect(readPageId(await h.vault.read('Coll/Eltern/Kind.md'))).toBeNull();
	});

	it('keeps the page in the state when the upload fails, so the next run pushes instead of creating it again', async () => {
		const h = harness();
		h.vault.seed('Coll/Neu.md', 'Mein Text\n');
		h.dav.beforePut = () => {
			throw new NotFoundError('gone');
		};

		const result = await executeSync(plan([create('Coll/Neu.md')]), h.deps);

		expect(result.failed).toBe(1);
		const id = readPageId(await h.vault.read('Coll/Neu.md'));
		expect(id).not.toBeNull();
		expect(stateOf(h, id as number)).toMatchObject({ localMtime: UNCHECKED_LOCAL_MTIME, status: 'synced' });
	});

	it('has the page in the state, with the id in the file, even when reading the new page fails', async () => {
		const h = harness();
		h.vault.seed('Coll/Neu.md', 'Mein Text\n');
		const realGet = h.dav.webdav.get;
		h.dav.webdav.get = async () => {
			throw new NotFoundError('network');
		};

		const result = await executeSync(plan([create('Coll/Neu.md')]), h.deps);
		h.dav.webdav.get = realGet;

		expect(result.failed).toBe(1);
		const id = readPageId(await h.vault.read('Coll/Neu.md'));
		expect(id).not.toBeNull();
		expect(stateOf(h, id as number)).toMatchObject({ localPath: 'Coll/Neu.md', localMtime: UNCHECKED_LOCAL_MTIME, remoteMtime: UNCONFIRMED_REMOTE_MTIME });
	});

	it('leaves the file alone when the page could not be created', async () => {
		const h = harness();
		h.vault.seed('Coll/Neu.md', 'Mein Text\n');
		h.api.failures.set('createPage', new Error('boom'));

		const result = await executeSync(plan([create('Coll/Neu.md')]), h.deps);

		expect(result.failed).toBe(1);
		expect(await h.vault.read('Coll/Neu.md')).toBe('Mein Text\n');
		expect(Object.keys(h.state.pages)).toEqual([]);
	});
});

describe('moveRemote (local file renamed or moved)', () => {
	const move = (pageId: number, over: Partial<Extract<SyncOp, { kind: 'moveRemote' }>> = {}): SyncOp => ({
		kind: 'moveRemote', pageId: asPageId(pageId), fromCollectiveId: COLL, collectiveId: COLL, path: 'Coll/Neu.md', title: null, parent: null, tidyTo: null, order: 1, ...over,
	});

	it('renames the page on the server and follows in the state and the nc fields', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Alt', parentId: LANDING });
		await known(h, page, 'Coll/Neu.md', 'Text');
		h.state.pages[String(page.id)] = { ...stateOf(h, page.id), localPath: 'Coll/Alt.md' };

		const result = await executeSync(plan([move(page.id, { title: 'Neu' })]), h.deps);

		expect(result).toEqual({ ...emptyResult(), moved: 1 });
		expect(h.api.calls).toContain(`updatePage 1 ${page.id} {"title":"Neu"}`);
		expect(stateOf(h, page.id)).toMatchObject({ localPath: 'Coll/Neu.md', remoteFileName: 'Neu.md', remoteMtime: UNCONFIRMED_REMOTE_MTIME });
	});

	it('moves the page below another parent', async () => {
		const h = harness();
		const parent = h.api.addPage(1, { title: 'Ordner', parentId: LANDING, fileName: 'Readme.md', filePath: 'Ordner' });
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Ordner/Seite.md', 'Text');

		await executeSync(plan([move(page.id, { path: 'Coll/Ordner/Seite.md', parent: { kind: 'page', pageId: parent.id } })]), h.deps);

		expect(h.api.calls).toContain(`updatePage 1 ${page.id} {"parentId":${parent.id}}`);
		expect(stateOf(h, page.id).parentId).toBe(parent.id);
	});

	it('moves the page into another collective and takes the new parent along', async () => {
		const h = harness();
		h.api.addCollective(2, 'Zwei');
		h.state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Zwei', localFolder: 'Zwei' };
		h.vault.seedFolder('Zwei');
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Zwei/Seite.md', 'Text');

		await executeSync(plan([move(page.id, { path: 'Zwei/Seite.md', collectiveId: asCollectiveId(2), parent: { kind: 'page', pageId: asPageId(200) } })]), h.deps);

		expect(h.api.calls).toContain(`movePageToCollective 1 ${page.id} 2 {"parentId":200}`);
		expect(stateOf(h, page.id)).toMatchObject({ collectiveId: 2, parentId: 200, localPath: 'Zwei/Seite.md' });
		expect(readNcMeta(await h.vault.read('Zwei/Seite.md'))?.collectiveId).toBe(2);
	});

	it('does not move again what the server already moved (a sub-page follows its parent)', async () => {
		const h = harness();
		h.api.addCollective(2, 'Zwei');
		h.state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Zwei', localFolder: 'Zwei' };
		h.vault.seedFolder('Zwei');
		const parent = h.api.addPage(1, { title: 'Eltern', parentId: LANDING, fileName: 'Readme.md', filePath: 'Eltern' });
		const child = h.api.addPage(1, { title: 'Kind', parentId: parent.id, filePath: 'Eltern' });
		await known(h, parent, 'Zwei/Eltern/Eltern.md', 'Eltern');
		await known(h, child, 'Zwei/Eltern/Kind.md', 'Kind');

		await executeSync(plan([
			move(parent.id, { path: 'Zwei/Eltern/Eltern.md', collectiveId: asCollectiveId(2), parent: { kind: 'page', pageId: asPageId(200) } }),
			move(child.id, { path: 'Zwei/Eltern/Kind.md', collectiveId: asCollectiveId(2), parent: { kind: 'page', pageId: parent.id } }),
		]), h.deps);

		expect(h.api.calls.filter((c) => c.startsWith('movePageToCollective'))).toHaveLength(1);
		expect(stateOf(h, child.id)).toMatchObject({ collectiveId: 2, localPath: 'Zwei/Eltern/Kind.md' });
	});

	it('makes no request that changes the server when the new place means the same, and only updates the path', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');
		h.state.pages[String(page.id)] = { ...stateOf(h, page.id), localPath: 'Coll/Alt/Seite.md' };

		await executeSync(plan([move(page.id, { path: 'Coll/Seite.md' })]), h.deps);

		expect(h.api.calls.filter((c) => c.startsWith('updatePage') || c.startsWith('movePage'))).toEqual([]);
		expect(stateOf(h, page.id).localPath).toBe('Coll/Seite.md');
	});

	it('renames the note of a folder page to the new folder name once the server accepted the title', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Ordner', parentId: LANDING, fileName: 'Readme.md', filePath: 'Ordner' });
		await known(h, page, 'Coll/Sammlung/Ordner.md', 'Text');

		await executeSync(plan([move(page.id, { path: 'Coll/Sammlung/Ordner.md', title: 'Sammlung', tidyTo: 'Coll/Sammlung/Sammlung.md' })]), h.deps);

		expect(h.vault.exists('Coll/Sammlung/Ordner.md')).toBe(false);
		expect(readPageId(await h.vault.read('Coll/Sammlung/Sammlung.md'))).toBe(page.id);
		expect(stateOf(h, page.id).localPath).toBe('Coll/Sammlung/Sammlung.md');
	});

	it('fails the page when the server does not know it any more', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Neu.md', 'Text');
		await h.api.trashPage(COLL, page.id);

		const result = await executeSync(plan([move(page.id, { title: 'Neu' })]), h.deps);

		expect(result.failed).toBe(1);
		expect(stateOf(h, page.id).localPath).toBe('Coll/Neu.md');
	});
});

describe('trashRemote (confirmed local deletion)', () => {
	it('moves the page to the trash and forgets it and the sub-pages that have no file', async () => {
		const h = harness();
		const parent = h.api.addPage(1, { title: 'Eltern', parentId: LANDING });
		const gone = h.api.addPage(1, { title: 'Weg', parentId: parent.id });
		const kept = h.api.addPage(1, { title: 'Da', parentId: parent.id });
		await known(h, parent, 'Coll/Eltern.md', 'x');
		await known(h, gone, 'Coll/Weg.md', 'x');
		await known(h, kept, 'Coll/Da.md', 'x');

		const result = await executeSync(plan([{ kind: 'trashRemote', pageId: parent.id, collectiveId: COLL, descendants: [{ pageId: gone.id, hasFile: false }, { pageId: kept.id, hasFile: true }] }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), trashed: 1 });
		expect(h.api.calls).toContain(`trashPage 1 ${parent.id}`);
		expect(h.state.pages[String(parent.id)]).toBeUndefined();
		expect(h.state.pages[String(gone.id)]).toBeUndefined();
		expect(h.state.pages[String(kept.id)]).toBeDefined();
	});

	it('counts a page the server does not know any more as done', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');
		await h.api.trashPage(COLL, page.id);

		const result = await executeSync(plan([{ kind: 'trashRemote', pageId: page.id, collectiveId: COLL, descendants: [] }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), trashed: 1 });
		expect(h.state.pages[String(page.id)]).toBeUndefined();
	});
});

describe('removeLocal (page deleted on the server)', () => {
	const remove = (pageId: number, path: string, mode: 'obsidianTrash' | 'keepUnlinked' = 'obsidianTrash'): SyncOp => ({
		kind: 'removeLocal', pageId: asPageId(pageId), collectiveId: COLL, path, mode,
	});

	it('moves an unchanged file to the trash', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');

		const result = await executeSync(plan([remove(page.id, 'Coll/Seite.md')]), h.deps);

		expect(result).toEqual({ ...emptyResult(), removed: 1 });
		expect(h.trashed).toEqual(['Coll/Seite.md']);
		expect(h.state.pages[String(page.id)]).toBeUndefined();
	});

	it('removes only the nc fields when the setting says keepUnlinked', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');

		await executeSync(plan([remove(page.id, 'Coll/Seite.md', 'keepUnlinked')]), h.deps);

		expect(h.trashed).toEqual([]);
		expect(await h.vault.read('Coll/Seite.md')).toBe(stripNcMeta(toLocal('Text', metaOf(page.id))));
		expect(readPageId(await h.vault.read('Coll/Seite.md'))).toBeNull();
		expect(h.state.pages[String(page.id)]).toBeUndefined();
	});

	it('restores the page and pushes the change when the file was changed meanwhile', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');
		h.vault.userEdit('Coll/Seite.md', `${await h.vault.read('Coll/Seite.md')} mehr`);
		await h.api.trashPage(COLL, page.id);

		const result = await executeSync(plan([remove(page.id, 'Coll/Seite.md')]), h.deps);

		expect(result).toMatchObject({ restored: 1, failed: 0 });
		expect(h.api.calls).toContain(`restorePage 1 ${page.id}`);
		expect(h.trashed).toEqual([]);
		expect(h.dav.content(page)).toBe('Text mehr');
		expect(stateOf(h, page.id).status).toBe('synced');
	});

	it('unlinks the changed file when the page cannot be restored, so it becomes a new page', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');
		h.vault.userEdit('Coll/Seite.md', `${await h.vault.read('Coll/Seite.md')} mehr`);
		h.api.entries.delete(page.id);

		const result = await executeSync(plan([remove(page.id, 'Coll/Seite.md')]), h.deps);

		expect(result).toMatchObject({ removed: 1, failed: 0 });
		expect(readPageId(await h.vault.read('Coll/Seite.md'))).toBeNull();
		expect(toRemote(await h.vault.read('Coll/Seite.md'))).toBe('Text mehr');
		expect(h.state.pages[String(page.id)]).toBeUndefined();
	});

	it('only forgets the page when its file is gone as well', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');
		await h.vault.trash('Coll/Seite.md');

		await executeSync(plan([remove(page.id, 'Coll/Seite.md')]), h.deps);

		expect(h.state.pages[String(page.id)]).toBeUndefined();
	});
});

describe('restoreRemote and dropState', () => {
	it('restores a page from the trash and links the file, which holds the same text', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		h.dav.serve(page, 'Text', '"e1"');
		await h.api.trashPage(COLL, page.id);
		h.vault.seed('Coll/Seite.md', toLocal('Text', metaOf(page.id)));

		const result = await executeSync(plan([{ kind: 'restoreRemote', pageId: page.id, collectiveId: COLL, path: 'Coll/Seite.md' }]), h.deps);

		expect(result).toMatchObject({ restored: 1, failed: 0 });
		expect(stateOf(h, page.id)).toMatchObject({ status: 'synced', localPath: 'Coll/Seite.md' });
	});

	it('does not count a page that is not in the trash', async () => {
		const h = harness();
		const result = await executeSync(plan([{ kind: 'restoreRemote', pageId: asPageId(555), collectiveId: COLL, path: 'Coll/Seite.md' }]), h.deps);

		expect(result).toEqual(emptyResult());
	});

	it('strips the nc fields of the files it is told to unlink, and forgets their pages', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'Text');

		await executeSync(plan([{ kind: 'dropState', pageIds: [page.id], collectiveIds: [], unlinkPaths: ['Coll/Seite.md'] }]), h.deps);

		expect(readPageId(await h.vault.read('Coll/Seite.md'))).toBeNull();
		expect(toRemote(await h.vault.read('Coll/Seite.md'))).toBe('Text');
		expect(h.state.pages).toEqual({});
	});

	it('forgets pages and collectives', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');

		await executeSync(plan([{ kind: 'dropState', pageIds: [page.id], collectiveIds: [COLL] }]), h.deps);

		expect(h.state.pages).toEqual({});
		expect(h.state.collectives).toEqual({});
	});
});

describe('collectives', () => {
	it('creates a collective for a folder and links the note named like the folder to its landing page', async () => {
		const h = harness();
		h.vault.seed('Neu/Neu.md', 'Startseite\n');

		const result = await executeSync(plan([{ kind: 'createCollective', folder: 'Neu', landingFile: 'Neu/Neu.md' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), uploaded: 1 });
		const collective = [...h.api.collectives.values()].find((c) => c.name === 'Neu');
		expect(h.state.collectives[String(collective?.id)]).toMatchObject({ name: 'Neu', localFolder: 'Neu' });
		const id = readPageId(await h.vault.read('Neu/Neu.md'));
		expect(id).toBe(Number(collective?.id) * 100);
		expect(h.dav.content(h.api.entries.get(asPageId(Number(id)))?.page as PageInfo)).toBe('Startseite');
	});

	it('creates a collective without a landing file', async () => {
		const h = harness();

		const result = await executeSync(plan([{ kind: 'createCollective', folder: 'Neu', landingFile: null }]), h.deps);

		expect(result.uploaded).toBe(1);
		expect(Object.values(h.state.collectives).map((c) => c.name)).toContain('Neu');
		expect(Object.keys(h.state.pages)).toEqual([]);
	});

	it('renames the collective through the Circles API, rebases the paths and renames the landing note', async () => {
		const h = harness();
		const landing = h.api.entries.get(LANDING)?.page as PageInfo;
		await known(h, landing, 'Coll/Coll.md', 'Start');
		h.vault.seed('Coll/Seite.md', 'x');
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');
		await h.vault.rename('Coll', 'Neu');

		const result = await executeSync(plan([{ kind: 'renameCollective', collectiveId: COLL, circleId: 'circle-1', name: 'Neu', folder: 'Neu' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), moved: 1 });
		expect(h.api.calls).toContain('renameCollective circle-1 Neu');
		expect(h.state.collectives['1']).toMatchObject({ name: 'Neu', localFolder: 'Neu' });
		expect(stateOf(h, page.id).localPath).toBe('Neu/Seite.md');
		expect(stateOf(h, LANDING).localPath).toBe('Neu/Neu.md');
		expect(h.vault.exists('Neu/Neu.md')).toBe(true);
	});

	it('renames the local folder to the server’s name and rebases the paths', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');

		const result = await executeSync(plan([{ kind: 'renameCollectiveFolder', collectiveId: COLL, from: 'Coll', to: 'Server', name: 'Server' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), moved: 1 });
		expect(h.vault.exists('Server/Seite.md')).toBe(true);
		expect(h.state.collectives['1']).toMatchObject({ name: 'Server', localFolder: 'Server' });
		expect(stateOf(h, page.id).localPath).toBe('Server/Seite.md');
	});

	it('renames a folder the user renamed back to the old name, without touching the state paths', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');
		await h.vault.rename('Coll', 'Anders');

		await executeSync(plan([{ kind: 'renameCollectiveFolder', collectiveId: COLL, from: 'Anders', to: 'Coll', name: 'Coll' }]), h.deps);

		expect(h.vault.exists('Coll/Seite.md')).toBe(true);
		expect(stateOf(h, page.id).localPath).toBe('Coll/Seite.md');
		expect(h.state.collectives['1']).toMatchObject({ name: 'Coll', localFolder: 'Coll' });
	});

	it('renames the folder of a folder page after its note, with the paths of everything in it', async () => {
		const h = harness();
		const folder = h.api.addPage(1, { title: 'Sammlung', parentId: LANDING, fileName: 'Readme.md', filePath: 'Ordner' });
		const child = h.api.addPage(1, { title: 'Kind', parentId: folder.id, filePath: 'Ordner' });
		await known(h, folder, 'Coll/Ordner/Sammlung.md', 'x');
		await known(h, child, 'Coll/Ordner/Kind.md', 'y');

		const result = await executeSync(plan([{ kind: 'renameFolderLocal', collectiveId: COLL, from: 'Coll/Ordner', to: 'Coll/Sammlung' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), moved: 1 });
		expect(h.vault.exists('Coll/Sammlung/Sammlung.md')).toBe(true);
		expect(h.vault.exists('Coll/Sammlung/Kind.md')).toBe(true);
		expect(stateOf(h, folder.id).localPath).toBe('Coll/Sammlung/Sammlung.md');
		expect(stateOf(h, child.id).localPath).toBe('Coll/Sammlung/Kind.md');
	});

	it('moves the collective to the trash and forgets it', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');

		const result = await executeSync(plan([{ kind: 'trashCollective', collectiveId: COLL, folder: 'Coll' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), trashed: 1 });
		expect(h.api.calls).toContain('trashCollective 1');
		expect(h.state.collectives).toEqual({});
		expect(h.state.pages).toEqual({});
	});

	it('moves the folder of a collective that is gone on the server to the trash and forgets it', async () => {
		const h = harness();
		const page = h.api.addPage(1, { title: 'Seite', parentId: LANDING });
		await known(h, page, 'Coll/Seite.md', 'x');

		const result = await executeSync(plan([{ kind: 'removeCollectiveLocal', collectiveId: COLL, folder: 'Coll' }]), h.deps);

		expect(result).toEqual({ ...emptyResult(), removed: 1 });
		expect(h.trashed).toEqual(['Coll']);
		expect(h.state.collectives).toEqual({});
		expect(h.state.pages).toEqual({});
	});
});

describe('state saving', () => {
	it('saves the state after every structure operation that changed it', async () => {
		const h = harness();
		let saves = 0;
		h.deps.persist = async () => {
			saves++;
		};
		h.vault.seed('Coll/Neu.md', 'x\n');

		await executeSync(plan([{ kind: 'createRemote', path: 'Coll/Neu.md', title: 'Neu', collectiveId: COLL, parent: { kind: 'page', pageId: LANDING }, fileExists: true, order: 2 }]), h.deps);

		expect(saves).toBeGreaterThanOrEqual(2);
	});
});

