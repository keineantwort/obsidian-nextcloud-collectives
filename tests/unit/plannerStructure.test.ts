// M5 (PLAN §7.4): the planner's decisions for structure and lifecycle cases. One group per row of the table.
import { describe, expect, it } from 'vitest';
import {
	asCollectiveId, asPageId, baseFiles, baseState, collective, localFile, opsOf, page, pageState, planFor, remote, remoteCollective,
	seitePage, startPage, syncState,
} from '../fakes/plannerFixtures';
import type { SyncState } from '../../src/sync/state';
import type { Decision } from '../../src/sync/types';

/** Folder page "Ordner" (id 20) below the landing page, with a child "Kind" (id 21). */
function ordnerPage(over: Parameters<typeof page>[1] = {}): ReturnType<typeof page> {
	return page(20, { title: 'Ordner', fileName: 'Readme.md', filePath: 'Ordner', parentId: asPageId(1), ...over });
}

function kindPage(over: Parameters<typeof page>[1] = {}): ReturnType<typeof page> {
	return page(21, { title: 'Kind', fileName: 'Kind.md', filePath: 'Ordner', parentId: asPageId(20), ...over });
}

function treeRemote(): ReturnType<typeof remote> {
	return remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), ordnerPage(), kindPage()])]);
}

function treeState(): SyncState {
	return syncState({
		collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
		pages: [
			pageState(startPage(), 1, 'Coll/Coll.md'),
			pageState(seitePage(), 1, 'Coll/Seite.md'),
			pageState(ordnerPage(), 1, 'Coll/Ordner/Ordner.md'),
			pageState(kindPage(), 1, 'Coll/Ordner/Kind.md'),
		],
		tags: { '1': [] },
	});
}

function treeFiles(): ReturnType<typeof baseFiles> {
	return [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10), localFile('Coll/Ordner/Ordner.md', 20), localFile('Coll/Ordner/Kind.md', 21)];
}

function tree(over: Partial<Parameters<typeof planFor>[0]> = {}): ReturnType<typeof planFor> {
	return planFor({ remote: treeRemote(), state: treeState(), files: treeFiles(), ...over });
}

function decided(entries: [string, Decision][]): Map<string, Decision> {
	return new Map(entries);
}

describe('planSync: neue lokale Datei', () => {
	it('uploads a note without nc_page_id as a page below the landing page', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Neu.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([
			{ kind: 'createRemote', path: 'Coll/Neu.md', title: 'Neu', collectiveId: 1, parent: { kind: 'page', pageId: 1 }, fileExists: true, order: 2 },
		]);
		expect(plan.followUp).toBe(false);
	});

	it('puts a note into the folder page that owns its folder', () => {
		const plan = tree({ files: [...treeFiles(), localFile('Coll/Ordner/Neu.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([expect.objectContaining({ path: 'Coll/Ordner/Neu.md', parent: { kind: 'page', pageId: 20 } })]);
	});

	it('creates a folder page first for a folder without a note, then the note below it', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Prozesse/Urlaub.md', null)] });

		const creates = opsOf(plan, 'createRemote');
		expect(creates).toEqual([
			expect.objectContaining({ path: 'Coll/Prozesse/Prozesse.md', title: 'Prozesse', parent: { kind: 'page', pageId: 1 }, fileExists: false, order: 2 }),
			expect.objectContaining({ path: 'Coll/Prozesse/Urlaub.md', title: 'Urlaub', parent: { kind: 'new', path: 'Coll/Prozesse/Prozesse.md' }, fileExists: true, order: 3 }),
		]);
		expect(plan.followUp).toBe(false);
	});

	it('creates a folder page for every missing level of a deep folder, outermost first', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/A/B/Tief.md', null)] });

		expect(opsOf(plan, 'createRemote').map((op) => op.path)).toEqual(['Coll/A/A.md', 'Coll/A/B/B.md', 'Coll/A/B/Tief.md']);
	});

	it('makes the leaf with the name of a new folder the parent of the folder’s notes, and asks for a second pass to move the leaf in', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Seite/Detail.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([expect.objectContaining({ path: 'Coll/Seite/Detail.md', parent: { kind: 'page', pageId: 10 } })]);
		expect(plan.followUp).toBe(true);
	});

	it('takes a new note named like its folder for the folder’s note, and its neighbours for its children', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Neu/Neu.md', null), localFile('Coll/Neu/Kind.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([
			expect.objectContaining({ path: 'Coll/Neu/Neu.md', parent: { kind: 'page', pageId: 1 } }),
			expect.objectContaining({ path: 'Coll/Neu/Kind.md', parent: { kind: 'new', path: 'Coll/Neu/Neu.md' } }),
		]);
		// The note lies in its folder already: nothing has to move afterwards.
		expect(plan.followUp).toBe(false);
	});

	it('asks for a second pass when a new leaf note gets a new child, so that the leaf moves into the folder', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Eltern.md', null), localFile('Coll/Eltern/Kind.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([
			expect.objectContaining({ path: 'Coll/Eltern.md', parent: { kind: 'page', pageId: 1 } }),
			expect.objectContaining({ path: 'Coll/Eltern/Kind.md', parent: { kind: 'new', path: 'Coll/Eltern.md' } }),
		]);
		expect(plan.followUp).toBe(true);
	});

	it('does not upload a collision file, which belongs to a page that is already on the server', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', null)] });

		expect(opsOf(plan, 'createRemote')).toEqual([]);
	});

	it('does not upload a file at the target path of a new remote page; the page gets a conflict copy instead', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(30, { title: 'Neu', fileName: 'Neu.md', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});

		expect(opsOf(plan, 'createRemote')).toEqual([]);
		expect(opsOf(plan, 'createConflict')).toEqual([expect.objectContaining({ path: 'Coll/Neu.md' })]);
	});

	it('leaves the notes of a collective that could not be scanned alone', () => {
		const plan = planFor({
			remote: remote([], [{ collective: collective(1, 'Coll'), error: new Error('timeout') }]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});

		expect(opsOf(plan, 'createRemote')).toEqual([]);
		expect(plan.skips).toEqual([{ reason: 'collectiveUnavailable', collectiveId: 1 }]);
	});
});

describe('planSync: lokal umbenannt oder verschoben', () => {
	it('renames the page when only the file name changed', () => {
		const plan = tree({ files: treeFiles().map((f) => (f.path === 'Coll/Seite.md' ? { ...f, path: 'Coll/Anders.md' } : f)) });

		expect(opsOf(plan, 'moveRemote')).toEqual([
			{ kind: 'moveRemote', pageId: 10, fromCollectiveId: 1, collectiveId: 1, path: 'Coll/Anders.md', title: 'Anders', parent: null, tidyTo: null, order: 1 },
		]);
		expect(opsOf(plan, 'renameLocal')).toEqual([]);
	});

	it('moves the page below another page when the file moved into that page’s folder', () => {
		const plan = tree({ files: treeFiles().map((f) => (f.path === 'Coll/Seite.md' ? { ...f, path: 'Coll/Ordner/Seite.md' } : f)) });

		expect(opsOf(plan, 'moveRemote')).toEqual([expect.objectContaining({ pageId: 10, title: null, parent: { kind: 'page', pageId: 20 } })]);
	});

	it('moves the page to the top level when the file left its folder', () => {
		const plan = tree({ files: treeFiles().map((f) => (f.path === 'Coll/Ordner/Kind.md' ? { ...f, path: 'Coll/Kind.md' } : f)) });

		expect(opsOf(plan, 'moveRemote')).toEqual([expect.objectContaining({ pageId: 21, title: null, parent: { kind: 'page', pageId: 1 } })]);
	});

	it('does not take a note that left its folder for the renamed folder: the page keeps its title', () => {
		const files = treeFiles().map((f) => (f.path === 'Coll/Ordner/Ordner.md' ? { ...f, path: 'Coll/Anders/Ordner.md' } : f));
		const plan = tree({ files });

		expect(opsOf(plan, 'moveRemote').find((op) => op.pageId === 20)).toMatchObject({ title: null, tidyTo: null });
	});

	it('moves the page into another collective when the file moved into that collective’s folder', () => {
		const state = treeState();
		state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Zwei', localFolder: 'Zwei' };
		const zweiStart = page(50, { title: 'Zwei', fileName: 'Readme.md' });
		state.pages['50'] = pageState(zweiStart, 2, 'Zwei/Zwei.md');
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), seitePage(), ordnerPage(), kindPage()]),
				remoteCollective(2, 'Zwei', [zweiStart]),
			]),
			state,
			files: [...treeFiles().filter((f) => f.path !== 'Coll/Seite.md'), localFile('Zwei/Zwei.md', 50), localFile('Zwei/Seite.md', 10)],
		});

		expect(opsOf(plan, 'moveRemote')).toEqual([
			expect.objectContaining({ pageId: 10, fromCollectiveId: 1, collectiveId: 2, title: null, parent: { kind: 'page', pageId: 50 } }),
		]);
	});

	it('names the folder page after the folder when the user renamed the folder, and moves the note with it', () => {
		const files = treeFiles().map((f) => (f.path.startsWith('Coll/Ordner/') ? { ...f, path: f.path.replace('Coll/Ordner/', 'Coll/Sammlung/') } : f));
		const plan = tree({ files });

		const moves = opsOf(plan, 'moveRemote');
		expect(moves).toContainEqual(expect.objectContaining({ pageId: 20, title: 'Sammlung', tidyTo: 'Coll/Sammlung/Sammlung.md', path: 'Coll/Sammlung/Ordner.md' }));
		// The child moved with its folder; nothing changes for it on the server.
		expect(moves).toContainEqual(expect.objectContaining({ pageId: 21, title: null, parent: null }));
	});

	it('plans a move without a change on the server when the new place means the same (state path only)', () => {
		const files = treeFiles().map((f) => (f.path === 'Coll/Seite.md' ? { ...f, path: 'Coll/Seite.md' } : f));
		const state = treeState();
		state.pages['10'] = { ...state.pages['10']!, localPath: 'Coll/Alt/Seite.md' };
		const plan = tree({ files, state });

		expect(opsOf(plan, 'moveRemote')).toEqual([expect.objectContaining({ pageId: 10, title: null, parent: null })]);
	});

	it('does not move the landing page', () => {
		const plan = tree({ files: treeFiles().map((f) => (f.path === 'Coll/Coll.md' ? { ...f, path: 'Coll/Start.md' } : f)) });

		expect(opsOf(plan, 'moveRemote')).toEqual([]);
	});

	it('waits for the next pass when the file moved into a folder that is no collective yet', () => {
		const plan = tree({ files: treeFiles().map((f) => (f.path === 'Coll/Seite.md' ? { ...f, path: 'Neu/Seite.md' } : f)) });

		expect(opsOf(plan, 'moveRemote')).toEqual([]);
		expect(opsOf(plan, 'createCollective')).toEqual([expect.objectContaining({ folder: 'Neu' })]);
	});

	it('asks for a second pass when the page moves below a leaf page, which turns into a folder page', () => {
		const files = treeFiles().map((f) => (f.path === 'Coll/Ordner/Kind.md' ? { ...f, path: 'Coll/Seite/Kind.md' } : f));
		const plan = tree({ files });

		expect(opsOf(plan, 'moveRemote')).toEqual([expect.objectContaining({ pageId: 21, parent: { kind: 'page', pageId: 10 } })]);
		expect(plan.followUp).toBe(true);
	});
});

describe('planSync: remote verschoben (Collective-übergreifend, Blatt zu Elternseite)', () => {
	it('moves the file into the folder of the other collective when the page moved there on the server', () => {
		const state = treeState();
		state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Zwei', localFolder: 'Zwei' };
		const zweiStart = page(50, { title: 'Zwei', fileName: 'Readme.md', collectivePath: '.Collectives/Zwei' });
		state.pages['50'] = pageState(zweiStart, 2, 'Zwei/Zwei.md');
		const moved = seitePage({ parentId: asPageId(50), collectivePath: '.Collectives/Zwei', timestamp: 1 });
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), ordnerPage(), kindPage()]),
				remoteCollective(2, 'Zwei', [zweiStart, moved]),
			]),
			state,
			files: [...treeFiles(), localFile('Zwei/Zwei.md', 50)],
		});

		const [rename] = opsOf(plan, 'renameLocal');
		expect(opsOf(plan, 'renameLocal')).toHaveLength(1);
		expect(rename).toMatchObject({ from: 'Coll/Seite.md', path: 'Zwei/Seite.md' });
		expect(rename?.meta.collectiveId).toBe(2);
		expect(opsOf(plan, 'removeLocal')).toEqual([]);
		expect(plan.proposals).toEqual([]);
	});

	it('moves the note into a new folder when a leaf page became a folder page on the server', () => {
		const converted = seitePage({ fileName: 'Readme.md', filePath: 'Seite' });
		const child = page(11, { title: 'Neu', fileName: 'Neu.md', filePath: 'Seite', parentId: asPageId(10) });
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', [startPage(), converted, child])]) });

		expect(opsOf(plan, 'renameLocal')).toEqual([expect.objectContaining({ from: 'Coll/Seite.md', path: 'Coll/Seite/Seite.md' })]);
		expect(opsOf(plan, 'ensureFolder')).toEqual([{ kind: 'ensureFolder', path: 'Coll/Seite' }]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite/Neu.md' })]);
	});

	it('gives a new page the name another page leaves in the same plan', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [
				startPage(),
				seitePage({ title: 'Anders', fileName: 'Anders.md' }),
				page(11, { title: 'Seite', fileName: 'Seite.md', parentId: asPageId(1) }),
			])]),
		});

		expect(opsOf(plan, 'renameLocal')).toEqual([expect.objectContaining({ from: 'Coll/Seite.md', path: 'Coll/Anders.md' })]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('keeps a free suffixed name when the target of a rename is taken by another file', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ title: 'Frei', fileName: 'Frei.md' })])]),
			files: [...baseFiles(), localFile('Coll/Frei.md', null)],
		});

		expect(opsOf(plan, 'renameLocal')).toEqual([expect.objectContaining({ path: 'Coll/Frei (2).md' })]);
	});
});

describe('planSync: Remote gelöscht', () => {
	it('moves an unchanged file to the trash by default', () => {
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', [startPage()])]) });

		expect(opsOf(plan, 'removeLocal')).toEqual([{ kind: 'removeLocal', pageId: 10, collectiveId: 1, path: 'Coll/Seite.md', mode: 'obsidianTrash' }]);
		expect(plan.proposals).toEqual([]);
	});

	it('plans unlinking when the setting says keepUnlinked, and asks for a second pass to upload the file as a new page', () => {
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', [startPage()])]), behaviour: { remoteDelete: 'keepUnlinked' } });

		expect(opsOf(plan, 'removeLocal')).toEqual([expect.objectContaining({ mode: 'keepUnlinked' })]);
		expect(plan.followUp).toBe(true);
	});

	it('only forgets the state of a page that is gone on both sides', () => {
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', [startPage()])]), files: [localFile('Coll/Coll.md', 1)] });

		expect(opsOf(plan, 'dropState')).toEqual([{ kind: 'dropState', pageIds: [10], collectiveIds: [] }]);
		expect(opsOf(plan, 'removeLocal')).toEqual([]);
	});

	it('plans no deletion at all while a collective could not be scanned: the page may have moved there', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])], [{ collective: collective(2, 'Zwei'), error: new Error('timeout') }]),
		});

		expect(opsOf(plan, 'removeLocal')).toEqual([]);
		expect(opsOf(plan, 'dropState')).toEqual([]);
	});

	it('leaves the pages of a collective that could not be scanned alone', () => {
		const plan = planFor({ remote: remote([], [{ collective: collective(1, 'Coll'), error: new Error('timeout') }]) });

		expect(plan.ops).toEqual([]);
		expect(plan.proposals).toEqual([]);
	});
});

describe('planSync: Lokal gelöscht', () => {
	const withoutSeite = (): ReturnType<typeof baseFiles> => baseFiles().filter((f) => f.path !== 'Coll/Seite.md');

	it('asks before it deletes the page', () => {
		const plan = planFor({ files: withoutSeite() });

		expect(plan.proposals).toEqual([
			{ id: 'deletePage:10', kind: 'deletePage', pageId: 10, collectiveId: 1, title: 'Seite', path: 'Coll/Seite.md', descendants: 0, mass: null },
		]);
		expect(opsOf(plan, 'trashRemote')).toEqual([]);
	});

	it('moves the page to the trash after the user agreed', () => {
		const plan = planFor({ files: withoutSeite(), decisions: decided([['deletePage:10', 'accept']]) });

		expect(opsOf(plan, 'trashRemote')).toEqual([{ kind: 'trashRemote', pageId: 10, collectiveId: 1, descendants: [] }]);
		expect(plan.proposals).toEqual([]);
	});

	it('pulls the page again after the user refused', () => {
		const plan = planFor({ files: withoutSeite(), decisions: decided([['deletePage:10', 'reject']]) });

		expect(opsOf(plan, 'trashRemote')).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('leaves the page alone and says so after the user postponed', () => {
		const plan = planFor({ files: withoutSeite(), decisions: decided([['deletePage:10', 'defer']]) });

		expect(plan.ops).toEqual([]);
		expect(plan.skips).toEqual([{ reason: 'deferred', proposalId: 'deletePage:10' }]);
	});

	it('moves a small deletion to the trash without a question when the setting says so', () => {
		const plan = tree({ files: treeFiles().filter((f) => f.path !== 'Coll/Seite.md'), behaviour: { localDelete: 'trashRemote' } });

		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'trashRemote')).toEqual([expect.objectContaining({ pageId: 10 })]);
	});

	it('asks even with trashRemote when at least three pages and more than 20 % of the collective’s pages are deleted', () => {
		const pages = [startPage(), ...[10, 11, 12, 13, 14, 15].map((id) => page(id, { title: `P${id}`, fileName: `P${id}.md`, parentId: asPageId(1) }))];
		const state = syncState({
			collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
			pages: pages.map((p) => pageState(p, 1, p.id === 1 ? 'Coll/Coll.md' : `Coll/${p.title}.md`)),
			tags: { '1': [] },
		});
		const files = [localFile('Coll/Coll.md', 1), localFile('Coll/P13.md', 13), localFile('Coll/P14.md', 14), localFile('Coll/P15.md', 15)];
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', pages)]), state, files, behaviour: { localDelete: 'trashRemote' } });

		expect(opsOf(plan, 'trashRemote')).toEqual([]);
		expect(plan.proposals.map((p) => p.kind === 'deletePage' ? p.mass : null)).toEqual(
			[10, 11, 12].map(() => ({ collectiveName: 'Coll', deleted: 3, total: 7 })),
		);
	});

	it.each([
		{ deleted: 3, expectMass: false }, // 3 of 16 pages = 18.75 %
		{ deleted: 4, expectMass: true }, // 4 of 16 pages = 25 %
	])('treats $deleted deleted pages of 16 as mass deletion: $expectMass', ({ deleted, expectMass }) => {
		const pages = [startPage(), ...Array.from({ length: 15 }, (_v, i) => page(10 + i, { title: `P${10 + i}`, fileName: `P${10 + i}.md`, parentId: asPageId(1) }))];
		const state = syncState({
			collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
			pages: pages.map((p) => pageState(p, 1, p.id === 1 ? 'Coll/Coll.md' : `Coll/${p.title}.md`)),
			tags: { '1': [] },
		});
		const files = pages.filter((p) => p.id === 1 || p.id >= 10 + deleted).map((p) => localFile(p.id === 1 ? 'Coll/Coll.md' : `Coll/${p.title}.md`, p.id));
		const plan = planFor({ remote: remote([remoteCollective(1, 'Coll', pages)]), state, files, behaviour: { localDelete: 'trashRemote' } });

		expect(plan.proposals.length > 0).toBe(expectMass);
		expect(opsOf(plan, 'trashRemote').length).toBe(expectMass ? 0 : deleted);
	});

	it('does not call two deleted pages of a four-page collective a mass deletion, so trashRemote does not ask', () => {
		const plan = tree({ files: treeFiles().filter((f) => f.path !== 'Coll/Seite.md' && f.path !== 'Coll/Ordner/Kind.md'), behaviour: { localDelete: 'trashRemote' } });

		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'trashRemote').map((op) => op.pageId)).toEqual([10, 21]);
	});

	it('asks once for a deleted folder page with its sub-pages, and shows how many there are', () => {
		const plan = tree({ files: treeFiles().filter((f) => !f.path.startsWith('Coll/Ordner/')) });

		expect(plan.proposals).toEqual([expect.objectContaining({ id: 'deletePage:20', pageId: 20, descendants: 1 })]);
	});

	it('keeps the state of sub-pages that still have a file when the parent is trashed', () => {
		const plan = tree({
			files: treeFiles().filter((f) => f.path !== 'Coll/Ordner/Ordner.md'),
			decisions: decided([['deletePage:20', 'accept']]),
		});

		expect(opsOf(plan, 'trashRemote')).toEqual([{ kind: 'trashRemote', pageId: 20, collectiveId: 1, descendants: [{ pageId: 21, hasFile: true }] }]);
	});

	it('does not delete a page the server changed since: its change wins and the page is pulled again', () => {
		const plan = planFor({ files: withoutSeite(), remoteChanged: new Set([asPageId(10)]) });

		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('never deletes the landing page: it is pulled again', () => {
		const plan = planFor({ files: baseFiles().filter((f) => f.path !== 'Coll/Coll.md') });

		expect(plan.proposals).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Coll.md' })]);
	});
});

describe('planSync: Lokal wiederhergestellt', () => {
	it('restores the page from the Collectives trash when a file with its id reappears', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])]),
			state: syncState({
				collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
				pages: [pageState(startPage(), 1, 'Coll/Coll.md')],
				tags: { '1': [] },
			}),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10)],
			remoteTrash: new Map([[asPageId(10), asCollectiveId(1)]]),
		});

		expect(opsOf(plan, 'restoreRemote')).toEqual([{ kind: 'restoreRemote', pageId: 10, collectiveId: 1, path: 'Coll/Seite.md' }]);
		expect(opsOf(plan, 'createRemote')).toEqual([]);
	});

	it('leaves a file alone whose id is on the server nowhere, and says so', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Fremd.md', 999)] });

		expect(plan.skips).toEqual([{ reason: 'unknownId', pageId: 999, path: 'Coll/Fremd.md' }]);
		expect(opsOf(plan, 'createRemote')).toEqual([]);
	});
});

describe('planSync: Gelöscht + gegenüber geändert', () => {
	it('keeps a page the user changed although the server deleted it (the executor revives it)', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])]),
			files: baseFiles().map((f) => (f.path === 'Coll/Seite.md' ? { ...f, mtime: 999 } : f)),
		});

		expect(opsOf(plan, 'removeLocal')).toEqual([expect.objectContaining({ pageId: 10, path: 'Coll/Seite.md' })]);
	});
});

describe('planSync: neuer lokaler Ordner auf oberster Ebene', () => {
	it('creates a collective for a folder with notes; the note named like the folder becomes the landing page', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Neu/Neu.md', null), localFile('Neu/Seite.md', null)] });

		expect(opsOf(plan, 'createCollective')).toEqual([{ kind: 'createCollective', folder: 'Neu', landingFile: 'Neu/Neu.md' }]);
		expect(opsOf(plan, 'createRemote')).toEqual([]);
		expect(plan.followUp).toBe(true);
	});

	it('creates a collective without a landing file when no note carries the folder’s name', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Neu/Seite.md', null)] });

		expect(opsOf(plan, 'createCollective')).toEqual([{ kind: 'createCollective', folder: 'Neu', landingFile: null }]);
	});

	it('ignores a folder without notes', () => {
		const plan = planFor({ files: baseFiles(), extraFolders: ['Leer'] });

		expect(opsOf(plan, 'createCollective')).toEqual([]);
		expect(plan.skips).toEqual([]);
	});

	it('does not take the folder of a collective that is new on the server for a new folder', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage()]), remoteCollective(2, 'Neu', [page(50, { title: 'Neu', fileName: 'Readme.md' })])]),
			files: [...baseFiles(), localFile('Neu/Eigen.md', null)],
		});

		expect(opsOf(plan, 'createCollective')).toEqual([]);
	});

	it('skips the folder when the setting says ignore', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Neu/Seite.md', null)], behaviour: { newFolder: 'ignore' } });

		expect(opsOf(plan, 'createCollective')).toEqual([]);
		expect(plan.skips).toEqual([{ reason: 'folderIgnored', path: 'Neu' }]);
	});

	it('asks first when the setting says ask, and creates the collective after the user agreed', () => {
		const files = [...baseFiles(), localFile('Neu/Seite.md', null)];
		const asked = planFor({ files, behaviour: { newFolder: 'ask' } });
		const agreed = planFor({ files, behaviour: { newFolder: 'ask' }, decisions: decided([['newCollective:Neu', 'accept']]) });
		const refused = planFor({ files, behaviour: { newFolder: 'ask' }, decisions: decided([['newCollective:Neu', 'reject']]) });

		expect(asked.proposals).toEqual([{ id: 'newCollective:Neu', kind: 'newCollective', folder: 'Neu', files: 1 }]);
		expect(opsOf(asked, 'createCollective')).toEqual([]);
		expect(opsOf(agreed, 'createCollective')).toEqual([expect.objectContaining({ folder: 'Neu' })]);
		expect(opsOf(refused, 'createCollective')).toEqual([]);
	});

	it('does not look at hidden folders', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('.versteckt/Seite.md', null)] });

		expect(opsOf(plan, 'createCollective')).toEqual([]);
	});
});

describe('planSync: Collective remote gelöscht', () => {
	function vanished(over: Partial<Parameters<typeof planFor>[0]> = {}): ReturnType<typeof planFor> {
		const state = baseState();
		const alt = page(50, { title: 'Alt', fileName: 'Readme.md' });
		state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Alt', localFolder: 'Alt' };
		state.pages['50'] = pageState(alt, 2, 'Alt/Alt.md');
		return planFor({ state, files: [...baseFiles(), localFile('Alt/Alt.md', 50)], ...over });
	}

	it('asks even when page deletions are set to trashRemote', () => {
		expect(vanished({ behaviour: { localDelete: 'trashRemote' } }).proposals).toHaveLength(1);
	});

	it('asks before the folder goes to the trash', () => {
		const plan = vanished();

		expect(plan.proposals).toEqual([{ id: 'removeCollectiveLocal:2', kind: 'removeCollectiveLocal', collectiveId: 2, name: 'Alt', pages: 1 }]);
		expect(plan.ops).toEqual([]);
	});

	it('moves the folder to the trash after the user agreed', () => {
		const plan = vanished({ decisions: decided([['removeCollectiveLocal:2', 'accept']]) });

		expect(opsOf(plan, 'removeCollectiveLocal')).toEqual([{ kind: 'removeCollectiveLocal', collectiveId: 2, folder: 'Alt' }]);
		expect(opsOf(plan, 'removeLocal')).toEqual([]);
	});

	it('forgets the collective and keeps the folder after the user refused', () => {
		const plan = vanished({ decisions: decided([['removeCollectiveLocal:2', 'reject']]) });

		expect(opsOf(plan, 'dropState')).toEqual([{ kind: 'dropState', pageIds: [50], collectiveIds: [2], unlinkPaths: ['Alt/Alt.md'] }]);
		expect(opsOf(plan, 'removeCollectiveLocal')).toEqual([]);
		expect(plan.followUp).toBe(true);
	});
});

describe('planSync: lokaler Collective-Ordner gelöscht', () => {
	const noFolder = (): ReturnType<typeof baseFiles> => [];

	it('asks before the collective is deleted', () => {
		const plan = planFor({ files: noFolder() });

		expect(plan.proposals).toEqual([{ id: 'deleteCollective:1', kind: 'deleteCollective', collectiveId: 1, name: 'Coll', pages: 2 }]);
		expect(plan.ops).toEqual([]);
	});

	it('moves the collective to the trash after the user agreed', () => {
		const plan = planFor({ files: noFolder(), decisions: decided([['deleteCollective:1', 'accept']]) });

		expect(opsOf(plan, 'trashCollective')).toEqual([{ kind: 'trashCollective', collectiveId: 1, folder: 'Coll' }]);
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('asks about the collective even when page deletions are set to trashRemote', () => {
		const plan = planFor({ files: noFolder(), behaviour: { localDelete: 'trashRemote' } });

		expect(plan.proposals).toEqual([expect.objectContaining({ kind: 'deleteCollective' })]);
		expect(opsOf(plan, 'trashCollective')).toEqual([]);
	});

	it('restores the folder and its pages after the user refused', () => {
		const plan = planFor({ files: noFolder(), decisions: decided([['deleteCollective:1', 'reject']]) });

		expect(opsOf(plan, 'trashCollective')).toEqual([]);
		expect(opsOf(plan, 'ensureFolder')).toEqual([{ kind: 'ensureFolder', path: 'Coll' }]);
		expect(opsOf(plan, 'create').map((op) => op.path)).toEqual(['Coll/Coll.md', 'Coll/Seite.md']);
	});

	it('restores the folder without a question when the user may not delete the collective', () => {
		const plan = planFor({
			remote: remote([{ ...remoteCollective(1, 'Coll', [startPage(), seitePage()]), collective: { ...collective(1, 'Coll'), level: 4 } }]),
			files: noFolder(),
		});

		expect(plan.proposals).toEqual([]);
		expect(plan.skips).toEqual([{ reason: 'deleteForbidden', collectiveId: 1 }]);
		expect(opsOf(plan, 'create').map((op) => op.path)).toEqual(['Coll/Coll.md', 'Coll/Seite.md']);
	});
});

describe('planSync: Collective-Ordner umbenannt', () => {
	const renamedFiles = (): ReturnType<typeof baseFiles> => [localFile('Neu/Coll.md', 1), localFile('Neu/Seite.md', 10)];

	it('renames the collective on the server when the user may', () => {
		const plan = planFor({ files: renamedFiles() });

		expect(opsOf(plan, 'renameCollective')).toEqual([{ kind: 'renameCollective', collectiveId: 1, circleId: 'circle-1', name: 'Neu', folder: 'Neu' }]);
		expect(opsOf(plan, 'createCollective')).toEqual([]);
		expect(plan.proposals).toEqual([]);
		expect(plan.followUp).toBe(true);
	});

	it('plans nothing else for the pages of a collective whose folder is being renamed (the next pass does)', () => {
		const plan = planFor({ files: renamedFiles() });

		expect(plan.ops.map((op) => op.kind)).toEqual(['renameCollective']);
	});

	it('does not take a folder that mostly holds other notes for the renamed folder of a collective', () => {
		const plan = planFor({
			files: [localFile('Privat/Coll.md', 1), localFile('Privat/A.md', null), localFile('Privat/B.md', null), localFile('Privat/C.md', null)],
			behaviour: { newFolder: 'ignore' },
		});

		expect(opsOf(plan, 'renameCollective')).toEqual([]);
		expect(opsOf(plan, 'renameCollectiveFolder')).toEqual([]);
		expect(opsOf(plan, 'createRemote')).toEqual([]);
		expect(plan.proposals).toEqual([expect.objectContaining({ kind: 'deleteCollective', collectiveId: 1 })]);
	});

	it('renames the folder back, with a hint, when the user may not rename the collective', () => {
		const plan = planFor({
			remote: remote([{ ...remoteCollective(1, 'Coll', [startPage(), seitePage()]), collective: { ...collective(1, 'Coll'), level: 4 } }]),
			files: renamedFiles(),
		});

		expect(opsOf(plan, 'renameCollective')).toEqual([]);
		expect(opsOf(plan, 'renameCollectiveFolder')).toEqual([{ kind: 'renameCollectiveFolder', collectiveId: 1, from: 'Neu', to: 'Coll', name: 'Coll' }]);
		expect(plan.skips).toEqual([{ reason: 'renameForbidden', collectiveId: 1 }]);
	});

	it('renames the local folder when the collective was renamed on the server', () => {
		const state = baseState();
		state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Alt', localFolder: 'Alt' };
		for (const key of ['1', '10']) state.pages[key] = { ...state.pages[key]!, localPath: state.pages[key]!.localPath.replace('Coll/', 'Alt/') };
		const plan = planFor({ state, files: [localFile('Alt/Coll.md', 1), localFile('Alt/Seite.md', 10)] });

		expect(opsOf(plan, 'renameCollectiveFolder')).toEqual([{ kind: 'renameCollectiveFolder', collectiveId: 1, from: 'Alt', to: 'Coll', name: 'Coll' }]);
		expect(plan.ops.map((op) => op.kind)).toEqual(['renameCollectiveFolder']);
	});

	it('lets the server’s name win when both sides renamed the collective', () => {
		const state = baseState();
		state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Alt', localFolder: 'Coll' };
		const plan = planFor({ state, files: renamedFiles() });

		expect(opsOf(plan, 'renameCollectiveFolder')).toEqual([{ kind: 'renameCollectiveFolder', collectiveId: 1, from: 'Neu', to: 'Coll', name: 'Coll' }]);
		expect(opsOf(plan, 'renameCollective')).toEqual([]);
	});
});

describe('planSync: order of the new operations', () => {
	it('runs folders and collectives first, then local renames, then structure, content and deletions', () => {
		const plan = tree({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ title: 'Anders', fileName: 'Anders.md', timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10), localFile('Coll/Neu.md', null), localFile('Coll/Ordner/Ordner.md', 20), localFile('Coll/Ordner/Kind.md', 21)],
			behaviour: { localDelete: 'trashRemote' },
		});

		const kinds = plan.ops.map((op) => op.kind);
		expect(kinds.indexOf('renameLocal')).toBeLessThan(kinds.indexOf('createRemote'));
		expect(kinds.indexOf('createRemote')).toBeLessThan(kinds.indexOf('update'));
		expect(kinds.indexOf('update')).toBeLessThan(kinds.indexOf('removeLocal'));
	});

	it('creates a parent before its child, whatever the path order', () => {
		const plan = planFor({ files: [...baseFiles(), localFile('Coll/Z/Zz.md', null), localFile('Coll/A/Aa.md', null)] });

		const paths = opsOf(plan, 'createRemote').map((op) => op.path);
		expect(paths.indexOf('Coll/Z/Z.md')).toBeLessThan(paths.indexOf('Coll/Z/Zz.md'));
		expect(paths.indexOf('Coll/A/A.md')).toBeLessThan(paths.indexOf('Coll/A/Aa.md'));
	});
});

