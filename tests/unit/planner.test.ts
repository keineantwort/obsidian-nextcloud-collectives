import { describe, expect, it } from 'vitest';
import {
	UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME, asCollectiveId, asPageId, asTagId, baseFiles, baseState, collective,
	findSkip, localFile, opsOf, page, pageState, planFor, remote, remoteCollective, seitePage, skipReasons,
	startPage, syncState, tag,
} from '../fakes/plannerFixtures';
import { pathKey } from '../../src/mapping/paths';
import type { RemoteSnapshot } from '../../src/sync/remoteScanner';

// ---------------------------------------------------------------------------

describe('planSync: new and known pages', () => {
	it('creates a new remote page at its free target path', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
		});
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Neu.md', metaHash: 'm11' })]);
	});

	it('writes a new remote page as a conflict copy when the target path is occupied by another file', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([expect.objectContaining({ path: 'Coll/Neu.md' })]);
	});

	it('does not create a page whose target path is occupied', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('adopts a local file with the matching nc_page_id when the state does not know the page', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Umzug.md', 11)],
		});
		expect(opsOf(plan, 'adopt')).toEqual([expect.objectContaining({ path: 'Coll/Umzug.md', metaHash: 'm11' })]);
	});

	it('updates a known page when its remote timestamp changed, with no localChanged field in the op', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md', metaChanged: false })]);
		expect(opsOf(plan, 'update')[0]).not.toHaveProperty('localChanged');
	});

	it('pushes a known page whose local mtime differs from the state while its remote is unchanged, with no localChanged field in the op', () => {
		const plan = planFor({
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)],
		});
		expect(opsOf(plan, 'push')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md', metaChanged: false })]);
		expect(opsOf(plan, 'update')).toEqual([]);
		expect(plan.ops[0]).not.toHaveProperty('localChanged');
	});

	it('emits exactly one push op and no skips when only the local mtime of a synced page moved', () => {
		const plan = planFor({ files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)] });
		expect(plan.ops).toHaveLength(1);
		expect(plan.ops[0]).toMatchObject({ kind: 'push', path: 'Coll/Seite.md', metaChanged: false });
		expect(plan.skips).toEqual([]);
	});

	it('pushes a page whose path is in the dirty set, even though its local mtime is unchanged', () => {
		const plan = planFor({ dirty: new Set([pathKey('COLL/seite.md')]) });
		expect(plan.ops).toHaveLength(1);
		expect(plan.ops[0]).toMatchObject({ kind: 'push', path: 'Coll/Seite.md', metaChanged: false });
	});

	it('updates instead of pushing when the local mtime and the remote timestamp both changed', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)],
		});
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'update', path: 'Coll/Seite.md', metaChanged: false })]);
	});

	it('pushes with metaChanged true and emits no separate updateMeta op when local mtime and remote metadata both changed', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, metaHash: 'alt' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)] });
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'push', path: 'Coll/Seite.md', metaChanged: true })]);
	});

	it('plans no operation for a page in status conflict whose local mtime changed', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'conflict', conflictPath: 'Coll/Seite (Konflikt 2026-10-16 1430).md' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)] });
		expect(plan.ops).toEqual([]);
	});

	it('plans no operation for a collision page whose user file changed its mtime', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', null, 600)] });
		expect(plan.ops).toEqual([]);
	});

	it('updates a known page whose stored remote mtime is UNCONFIRMED_REMOTE_MTIME, even when nothing else changed', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, remoteMtime: UNCONFIRMED_REMOTE_MTIME };
		const plan = planFor({ state });
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'update', path: 'Coll/Seite.md' })]);
	});

	it('pushes a known page whose stored local mtime is UNCHECKED_LOCAL_MTIME', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, localMtime: UNCHECKED_LOCAL_MTIME };
		const plan = planFor({ state });
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'push', path: 'Coll/Seite.md', metaChanged: false })]);
	});

	it('updates a known page when only the remote size changed', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ size: 5 })])]),
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('emits only updateMeta when only the metadata hash differs from the state', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, metaHash: 'alt' };
		const plan = planFor({ state });
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'updateMeta', path: 'Coll/Seite.md' })]);
	});

	it('emits no operations and no skips when nothing changed, so a second run writes nothing', () => {
		const plan = planFor();
		expect(plan.ops).toEqual([]);
		expect(plan.skips).toEqual([]);
	});
});

describe('planSync: skips for moved, deleted and inconsistent pages', () => {
	it('renames the local file when the page was renamed on the server, and updates it at the new path', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ fileName: 'Anders.md', title: 'Anders', timestamp: 2 })])]),
		});
		expect(opsOf(plan, 'renameLocal')).toEqual([expect.objectContaining({ from: 'Coll/Seite.md', path: 'Coll/Anders.md' })]);
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Anders.md' })]);
	});

	it('lets the server win when both sides moved the page, and says so', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ fileName: 'Anders.md', title: 'Anders' })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Umzug/Seite.md', 10)],
		});
		expect(findSkip(plan, 'remoteMoveWins')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'renameLocal')).toEqual([expect.objectContaining({ from: 'Coll/Umzug/Seite.md', path: 'Coll/Anders.md' })]);
		expect(opsOf(plan, 'moveRemote')).toEqual([]);
	});

	it('asks before it deletes a page whose local file is gone, and creates nothing', () => {
		const plan = planFor({ files: [localFile('Coll/Coll.md', 1)] });
		expect(plan.proposals).toEqual([expect.objectContaining({ kind: 'deletePage', pageId: 10 })]);
		expect(opsOf(plan, 'create')).toEqual([]);
		expect(opsOf(plan, 'trashRemote')).toEqual([]);
	});

	it('follows a page deleted on the server with its local file', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])]),
		});
		expect(opsOf(plan, 'removeLocal')).toEqual([
			expect.objectContaining({ pageId: 10, path: 'Coll/Seite.md', mode: 'obsidianTrash' }),
		]);
	});

	it('does not touch any page of a collective that failed to scan', () => {
		const plan = planFor({
			remote: remote([], [{ collective: collective(1, 'Coll'), error: new Error('timeout') }]),
		});
		expect(plan.ops).toEqual([]);
		expect(plan.skips).toEqual([]);
	});

	it('skips an orphan page and creates nothing for it', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(30, { title: 'Waise', parentId: asPageId(999) })])]),
		});
		expect(findSkip(plan, 'orphan')).toMatchObject({ pageId: 30 });
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('skips a page whose nc_page_id occurs in two local files and does not update it', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10), localFile('Coll/Kopie.md', 10)],
		});
		expect(findSkip(plan, 'duplicateId')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'update')).toEqual([]);
	});

	it('handles a state page with status collision via its localPath, even without nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', null)],
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('pulls a collision page again instead of deleting it when the user removed the file', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1)] });
		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'trashRemote')).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('does not take a file with another nc_page_id at the collision path for the collision file', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 99)] });
		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'trashRemote')).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite (2).md' })]);
	});
});

describe('planSync: collisions, case and foreign files', () => {
	it('finds a collision page by its localPath case-insensitively when the file carries no nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('coll/seite.md', null)],
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'coll/seite.md' })]);
		expect(skipReasons(plan)).not.toContain('localDeleted');
	});

	it('adopts a file that carries the id of a collision page, since the id links it', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('coll/seite.md', 10)],
		});
		expect(opsOf(plan, 'adopt')).toEqual([expect.objectContaining({ path: 'coll/seite.md' })]);
		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'trashRemote')).toEqual([]);
	});

	it('finds a conflict page after its file was renamed by the user, via its nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'conflict', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Umbenannt.md', 10)],
		});
		expect(plan.skips).toEqual([]);
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Umbenannt.md' })]);
	});

	it('creates a new page at a free suffix in the same folder when the target holds a file with another nc_page_id', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', 99)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Neu (2).md', metaHash: 'm11' })]);
	});

	it('plans no two creates for the same path and no conflict copy when a suffixed name is claimed in the plan', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [
					startPage(),
					seitePage(),
					page(11, { title: 'Neu', fileName: 'Neu.md', parentId: asPageId(1) }),
					page(12, { title: 'Neu', fileName: 'Neu (2).md', parentId: asPageId(1) }),
				]),
			]),
			files: [...baseFiles(), localFile('Coll/Neu.md', 99)],
		});
		const creates = opsOf(plan, 'create').map((op) => op.path);
		expect(opsOf(plan, 'createConflict')).toEqual([]);
		expect(new Set(creates).size).toBe(creates.length);
	});

	it('writes a new page as conflict copy at the path of a user file that differs from the target only in case', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('coll/neu.md', null)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([expect.objectContaining({ path: 'coll/neu.md' })]);
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('uses the spelling on disk for the folder of a new collective and for the paths below it', () => {
		const plan = planFor({
			state: syncState({}),
			remote: remote([
				remoteCollective(2, 'Coll', [startPage({ id: asPageId(20) }), page(21, { title: 'Neu', parentId: asPageId(20) })]),
			]),
			files: [localFile('coll/Altes.md', null)],
		});
		expect(opsOf(plan, 'saveCollective')).toEqual([
			expect.objectContaining({ collective: { collectiveId: 2, name: 'Coll', localFolder: 'coll' } }),
		]);
		expect(opsOf(plan, 'ensureFolder').map((op) => op.path)).not.toContain('Coll');
		expect(opsOf(plan, 'create').map((op) => op.path).sort()).toEqual(['coll/Coll.md', 'coll/Neu.md']);
	});
});

describe('planSync: collectives', () => {
	it('emits ensureFolder and saveCollective before any page operation for a new collective', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), seitePage()]),
				remoteCollective(2, 'Neu', [startPage({ id: asPageId(20), title: 'Neu' })]),
			]),
		});
		const saveIndex = plan.ops.findIndex((op) => op.kind === 'saveCollective');
		const folderIndex = plan.ops.findIndex((op) => op.kind === 'ensureFolder' && op.path === 'Neu');
		const createIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Neu/Neu.md');
		expect(folderIndex).toBeGreaterThanOrEqual(0);
		expect(saveIndex).toBeGreaterThan(folderIndex);
		expect(createIndex).toBeGreaterThan(saveIndex);
	});

	it('saves the new collective with its folder and name in the state', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), seitePage()]),
				remoteCollective(2, 'Neu', [startPage({ id: asPageId(20), title: 'Neu' })]),
			]),
		});
		expect(opsOf(plan, 'saveCollective')).toEqual([
			expect.objectContaining({ collective: { collectiveId: 2, name: 'Neu', localFolder: 'Neu' } }),
		]);
	});

	it('renames the local folder when the collective was renamed on the server', () => {
		const state = baseState();
		state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Alt', localFolder: 'Coll' };
		const plan = planFor({ state });
		expect(opsOf(plan, 'renameCollectiveFolder')).toEqual([
			{ kind: 'renameCollectiveFolder', collectiveId: 1, from: 'Coll', to: 'Coll', name: 'Coll' },
		]);
		expect(opsOf(plan, 'saveCollective')).toEqual([]);
	});

	it('asks before it removes the folder of a collective that is gone on the server', () => {
		const state = baseState();
		const alt = page(50, { title: 'Alt', parentId: asPageId(0), fileName: 'Readme.md' });
		state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Alt', localFolder: 'Alt' };
		state.pages['50'] = pageState(alt, 2, 'Alt/Alt.md');
		const plan = planFor({ state, files: [...baseFiles(), localFile('Alt/Alt.md', 50)] });
		expect(plan.proposals).toEqual([{ id: 'removeCollectiveLocal:2', kind: 'removeCollectiveLocal', collectiveId: 2, name: 'Alt', notes: 1 }]);
		expect(opsOf(plan, 'removeLocal')).toEqual([]);
	});

	it('saves tags when the remote tag list differs from the cache', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage()], [tag(3, 'Projekt', 1, '#ff0000')])]),
		});
		expect(opsOf(plan, 'saveTags')).toEqual([
			expect.objectContaining({ collectiveId: 1, tags: [{ id: asTagId(3), name: 'Projekt', color: '#ff0000' }] }),
		]);
	});

	it('does not save tags when the cache already matches the remote tag list', () => {
		const state = baseState();
		state.tags = { '1': [{ id: asTagId(3), name: 'Projekt', color: '#ff0000' }] };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage()], [tag(3, 'Projekt', 1, '#ff0000')])]),
		});
		expect(opsOf(plan, 'saveTags')).toEqual([]);
	});
});

describe('planSync: order of operations', () => {
	/** New collective-1 folder page "A" (id 3) with leaf "C" (id 4) below it, plus flat leaf "Flach" (id 5). */
	function nestedRemote(): RemoteSnapshot {
		const folder = page(3, { title: 'A', fileName: 'Readme.md', parentId: asPageId(1) });
		const deep = page(4, { title: 'C', fileName: 'C.md', parentId: asPageId(3), filePath: 'A' });
		const flat = page(5, { title: 'Flach', fileName: 'Flach.md', parentId: asPageId(1) });
		return remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), folder, deep, flat])]);
	}

	it('emits ensureFolder for a missing parent folder before the create of a file inside it', () => {
		const plan = planFor({ remote: nestedRemote() });
		const folderIndex = plan.ops.findIndex((op) => op.kind === 'ensureFolder' && op.path === 'Coll/A');
		const createIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/A/A.md');
		expect(folderIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(folderIndex);
	});

	it('orders page operations by target depth, so the flat file comes before the nested one', () => {
		const plan = planFor({ remote: nestedRemote() });
		const flatIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/Flach.md');
		const deepIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/A/C.md');
		expect(flatIndex).toBeGreaterThanOrEqual(0);
		expect(deepIndex).toBeGreaterThan(flatIndex);
	});
});
