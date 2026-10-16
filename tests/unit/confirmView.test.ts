import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import type { Proposal } from '../../src/sync/types';
import { buildConfirmRows, decisionsFor, laterDecisions } from '../../src/ui/confirmView';

const en = createTranslator('en');
const de = createTranslator('de');

const PAGE: Proposal = {
	id: 'deletePage:10', kind: 'deletePage', pageId: asPageId(10), collectiveId: asCollectiveId(1), title: 'Urlaub', path: 'Coll/Urlaub.md', descendants: 0, mass: null,
};
const PARENT: Proposal = { ...PAGE, id: 'deletePage:20', pageId: asPageId(20), title: 'Prozesse', path: 'Coll/Prozesse/Prozesse.md', descendants: 3 };
const MASS: Proposal = { ...PAGE, id: 'deletePage:30', pageId: asPageId(30), title: 'Alt', mass: { collectiveName: 'Coll', deleted: 5, total: 20 } };
const COLLECTIVE: Proposal = { id: 'deleteCollective:1', kind: 'deleteCollective', collectiveId: asCollectiveId(1), name: 'Handbuch', pages: 12 };
const GONE: Proposal = { id: 'removeCollectiveLocal:2', kind: 'removeCollectiveLocal', collectiveId: asCollectiveId(2), name: 'Alt', pages: 4 };
const FOLDER: Proposal = { id: 'newCollective:Neu', kind: 'newCollective', folder: 'Neu', files: 2 };

describe('buildConfirmRows', () => {
	it('says what happens if the box is checked, with the place and the consequence of leaving it unchecked', () => {
		const [row] = buildConfirmRows([PAGE], en);

		expect(row?.label).toBe('Delete the page “Urlaub” on the server');
		expect(row?.details[0]).toBe('Coll/Urlaub.md');
		expect(row?.details.join(' ')).toContain('Unchecked: the file comes back to your vault.');
		expect(row?.warning).toBeNull();
	});

	it('names the number of sub-pages that go with a folder page', () => {
		const [row] = buildConfirmRows([PARENT], en);

		expect(row?.details).toContain('This also deletes 3 sub-pages.');
	});

	it('warns about a mass deletion with the numbers', () => {
		const [row] = buildConfirmRows([MASS], en);

		expect(row?.warning).toBe('Many pages: 5 of 20 pages of “Coll” would be deleted.');
	});

	it('words the collective and folder questions', () => {
		const rows = buildConfirmRows([COLLECTIVE, GONE, FOLDER], en);

		expect(rows.map((row) => row.label)).toEqual([
			'Delete the collective “Handbuch” on the server',
			'Move the folder “Alt” to the trash',
			'Create the collective “Neu” on the server',
		]);
		expect(rows[1]?.details[0]).toContain('4 pages');
	});

	it('puts collective questions before page questions and mass deletions first among the pages', () => {
		const rows = buildConfirmRows([PAGE, FOLDER, MASS, COLLECTIVE, GONE], en);

		expect(rows.map((row) => row.id)).toEqual(['deleteCollective:1', 'removeCollectiveLocal:2', 'deletePage:30', 'deletePage:10', 'newCollective:Neu']);
	});

	it('speaks German', () => {
		const [row] = buildConfirmRows([PAGE], de);

		expect(row?.label).toBe('Seite „Urlaub“ auf dem Server löschen');
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
