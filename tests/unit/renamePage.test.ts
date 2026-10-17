import { describe, expect, it } from 'vitest';
import { isFolderPageNote, isLandingNote, planPageRename } from '../../src/mapping/renamePage';

const none = (): boolean => false;

describe('planPageRename', () => {
	it('renames only the note of a page without sub-pages', () => {
		expect(planPageRename('Coll/Handbuch/Seite.md', 'Neu', none)).toEqual({ ok: true, name: 'Neu', folderPage: false, steps: [{ from: 'Coll/Handbuch/Seite.md', to: 'Coll/Handbuch/Neu.md' }] });
	});

	it('renames the note and then the folder of a page with sub-pages, to the same name', () => {
		expect(planPageRename('Coll/Handbuch/Prozesse/Prozesse.md', 'Abläufe', none)).toEqual({
			ok: true,
			name: 'Abläufe',
			folderPage: true,
			steps: [
				{ from: 'Coll/Handbuch/Prozesse/Prozesse.md', to: 'Coll/Handbuch/Prozesse/Abläufe.md' },
				{ from: 'Coll/Handbuch/Prozesse', to: 'Coll/Handbuch/Abläufe' },
			],
		});
	});

	it('makes the name usable as a file name, and drops a typed .md', () => {
		expect(planPageRename('Coll/A.md', 'a/b: c.md', none)).toMatchObject({ ok: true, name: 'a_b_ c' });
	});

	it('refuses an empty name, the same name, the start page, and a name that is taken', () => {
		expect(planPageRename('Coll/A.md', '  ', none)).toEqual({ ok: false, reason: 'empty' });
		expect(planPageRename('Coll/A.md', 'a', none)).toEqual({ ok: false, reason: 'unchanged' });
		expect(planPageRename('Coll/Coll.md', 'X', none)).toEqual({ ok: false, reason: 'landing' });
		expect(planPageRename('Coll/A.md', 'B', (p) => p === 'Coll/B.md')).toEqual({ ok: false, reason: 'exists' });
		expect(planPageRename('Coll/A.md', 'B', (p) => p === 'Coll/B')).toEqual({ ok: false, reason: 'exists' });
		expect(planPageRename('Coll/F/F.md', 'B', (p) => p === 'Coll/B.md')).toEqual({ ok: false, reason: 'exists' });
		expect(planPageRename('Coll/F/F.md', 'B', (p) => p === 'Coll/B')).toEqual({ ok: false, reason: 'exists' });
	});
});

describe('isFolderPageNote and isLandingNote', () => {
	it('tell a folder page, a start page and a leaf apart', () => {
		expect(isFolderPageNote('Coll/F/F.md')).toBe(true);
		expect(isFolderPageNote('Coll/F/G.md')).toBe(false);
		expect(isFolderPageNote('Coll/Coll.md')).toBe(false);
		expect(isLandingNote('Coll/Coll.md')).toBe(true);
		expect(isLandingNote('Coll/F/F.md')).toBe(false);
	});
});
