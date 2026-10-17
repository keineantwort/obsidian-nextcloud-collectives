import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import type { Proposal } from '../../src/sync/types';
import { buildConfirmGroups, buildConfirmRows, decisionsFor, laterDecisions } from '../../src/ui/confirmView';

const en = createTranslator('en');
const de = createTranslator('de');

const PAGE: Proposal = {
	id: 'deletePage:10', kind: 'deletePage', pageId: asPageId(10), collectiveId: asCollectiveId(1), title: 'Urlaub', path: 'Coll/Urlaub.md', descendants: 0, mass: null,
};
const PARENT: Proposal = { ...PAGE, id: 'deletePage:20', pageId: asPageId(20), title: 'Prozesse', path: 'Coll/Prozesse/Prozesse.md', descendants: 3 };
const MASS: Proposal = { ...PAGE, id: 'deletePage:30', pageId: asPageId(30), title: 'Alt', mass: { collectiveName: 'Coll', deleted: 5, total: 20 } };
const COLLECTIVE: Proposal = { id: 'deleteCollective:1', kind: 'deleteCollective', collectiveId: asCollectiveId(1), name: 'Handbuch', pages: 12 };
const GONE: Proposal = { id: 'removeCollectiveLocal:2', kind: 'removeCollectiveLocal', collectiveId: asCollectiveId(2), name: 'Alt', notes: 4 };
const FOLDER: Proposal = { id: 'newCollective:Neu', kind: 'newCollective', folder: 'Neu', files: 2 };

describe('buildConfirmRows', () => {
	it('says in a few words what happens if the box is checked, and where', () => {
		const [row] = buildConfirmRows([PAGE], en);

		expect(row?.label).toBe('Delete page “Urlaub” on the server');
		expect(row?.details).toEqual(['Coll/Urlaub.md']);
		expect(row?.warning).toBeNull();
	});

	it('names the number of sub-pages that go with a folder page', () => {
		const [row] = buildConfirmRows([PARENT], en);

		expect(row?.details).toEqual(['Coll/Prozesse/Prozesse.md', 'with 3 sub-pages']);
	});

	it('warns about a mass deletion with the numbers', () => {
		const [row] = buildConfirmRows([MASS], en);

		expect(row?.warning).toBe('5 of 20 pages of “Coll”');
	});

	it('words the collective and folder questions', () => {
		const rows = buildConfirmRows([COLLECTIVE, GONE, FOLDER], en);

		expect(rows.map((row) => row.label)).toEqual([
			'Delete collective “Handbuch” on the server',
			'Remove folder “Alt” from the vault',
			'Create collective “Neu” on the server',
		]);
		expect(rows.map((row) => row.details)).toEqual([['12 pages'], ['4 notes'], ['2 notes']]);
	});

	it('puts collective deletions before page deletions and mass deletions first among the pages', () => {
		const rows = buildConfirmRows([PAGE, FOLDER, MASS, COLLECTIVE, GONE], en);

		expect(rows.map((row) => row.id)).toEqual(['deleteCollective:1', 'deletePage:30', 'deletePage:10', 'removeCollectiveLocal:2', 'newCollective:Neu']);
	});

	it('speaks German', () => {
		const [row] = buildConfirmRows([PAGE], de);

		expect(row?.label).toBe('Seite „Urlaub“ auf dem Server löschen');
	});
});

describe('buildConfirmGroups', () => {
	it('groups the questions by cause, in a fixed order, and leaves empty groups out', () => {
		const groups = buildConfirmGroups([FOLDER, PAGE, GONE], de);

		expect(groups.map((group) => [group.heading, group.rows.map((row) => row.id)])).toEqual([
			['Im Vault gelöscht', ['deletePage:10']],
			['Auf dem Server gelöscht', ['removeCollectiveLocal:2']],
			['Neu im Vault', ['newCollective:Neu']],
		]);
		expect(buildConfirmGroups([PAGE], en).map((group) => group.heading)).toEqual(['Deleted in the vault']);
	});

	it('shows no count for a removed folder without notes', () => {
		const [row] = buildConfirmRows([{ ...GONE, notes: 0 }], en);

		expect(row?.details).toEqual([]);
	});
});

describe('answers', () => {
	const rows = buildConfirmRows([PAGE, PARENT], en);

	it('accepts the checked rows and refuses the others', () => {
		expect(decisionsFor(rows, new Set(['deletePage:20']))).toEqual(new Map([['deletePage:10', 'reject'], ['deletePage:20', 'accept']]));
	});

	it('refuses everything when nothing is checked', () => {
		expect([...decisionsFor(rows, new Set()).values()]).toEqual(['reject', 'reject']);
	});

	it('postpones every question when the dialog is closed', () => {
		expect(laterDecisions(rows)).toEqual(new Map([['deletePage:10', 'defer'], ['deletePage:20', 'defer']]));
	});
});
