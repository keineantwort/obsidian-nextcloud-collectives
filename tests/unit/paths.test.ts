import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import type { CollectiveId, PageInfo, PageId } from '../../src/api/types';
import { parsePageInfo } from '../../src/api/parse';
import {
	conflictPath,
	isConflictFileName,
	isSyncedPath,
	pathKey,
	planLocalPaths,
	sanitizeName,
	withSuffix,
} from '../../src/mapping/paths';
import type { CollectiveTree, PathPlan } from '../../src/mapping/paths';

/** Minimal PageInfo with all required fields; override what a test needs. */
function page(id: number, over: Partial<PageInfo> = {}): PageInfo {
	return {
		id: asPageId(id),
		slug: `seite-${id}`,
		title: `Seite ${id}`,
		emoji: null,
		tags: [],
		timestamp: 1,
		size: 0,
		fileName: `Seite ${id}.md`,
		filePath: '',
		collectivePath: '.Collectives/Test',
		parentId: asPageId(0),
		subpageOrder: [],
		lastUserId: null,
		linkedPageIds: [],
		trashTimestamp: null,
		...over,
	};
}

/** Start page (parentId 0) of a collective. */
function startPage(id: number, title: string): PageInfo {
	return page(id, { title, fileName: 'Readme.md', parentId: asPageId(0) });
}

/** Leaf page below `parentId` in the collective root. */
function leaf(id: number, title: string, parentId: number): PageInfo {
	return page(id, { title, fileName: `${title}.md`, parentId: asPageId(parentId) });
}

function tree(id: number, name: string, pages: PageInfo[]): CollectiveTree {
	return { collectiveId: asCollectiveId(id), name, pages };
}

function targetPath(plan: PathPlan, id: number): string | undefined {
	return plan.targets.get(asPageId(id))?.path;
}

function sortedIds(ids: PageId[]): number[] {
	return ids.map((id) => Number(id)).sort((a, b) => a - b);
}

interface PagesFixture {
	response: { ocs: { data: { pages: unknown[] } } };
}

/** Pages of tests/fixtures/m0/pages-list-final.json (collective 1 "Handbuch"), parsed with parsePageInfo. */
function loadFixturePages(): PageInfo[] {
	const fixture = JSON.parse(readFileSync(new URL('../fixtures/m0/pages-list-final.json', import.meta.url), 'utf8')) as PagesFixture;
	return fixture.response.ocs.data.pages.map((raw) => parsePageInfo(raw));
}

const NO_KNOWN = new Map<CollectiveId, string>();

describe('sanitizeName', () => {
	it.each(['*', '"', '\\', '/', '<', '>', ':', '|', '?', '#', '^', '[', ']'])(
		'replaces the forbidden character %s with an underscore',
		(ch) => {
			expect(sanitizeName(`a${ch}b`)).toBe('a_b');
		},
	);

	it('returns the replacement for an empty name', () => {
		expect(sanitizeName('')).toBe('_');
	});

	it('returns the replacement for a name that is only whitespace', () => {
		expect(sanitizeName('   ')).toBe('_');
	});

	it('replaces a leading dot so the file is not hidden', () => {
		expect(sanitizeName('.hidden')).toBe('_hidden');
	});

	it('keeps dots that are not leading', () => {
		expect(sanitizeName('Version 1.2')).toBe('Version 1.2');
	});

	it('trims leading and trailing whitespace', () => {
		expect(sanitizeName('  Titel  ')).toBe('Titel');
	});

	it('uses the given replacement character', () => {
		expect(sanitizeName('a/b', '-')).toBe('a-b');
	});
});

describe('pathKey', () => {
	it('gives the same key for upper and lower case umlauts', () => {
		expect(pathKey('Ä')).toBe(pathKey('ä'));
	});

	it('gives the same key for composed and decomposed umlauts (NFC)', () => {
		expect(pathKey('Ä.md')).toBe(pathKey('Ä.md'));
	});

	it('gives different keys for different names', () => {
		expect(pathKey('Alpha.md')).not.toBe(pathKey('Beta.md'));
	});
});

describe('withSuffix', () => {
	it('returns the base name when it is free', () => {
		expect(withSuffix('Notiz', new Set<string>())).toBe('Notiz');
	});

	it('appends " (2)" when the base name is taken, comparing case-insensitively', () => {
		expect(withSuffix('X', new Set([pathKey('x')]))).toBe('X (2)');
	});

	it('appends " (3)" when " (2)" is taken as well', () => {
		expect(withSuffix('X', new Set([pathKey('X'), pathKey('X (2)')]))).toBe('X (3)');
	});

	it('does not modify the taken set', () => {
		const taken = new Set([pathKey('X')]);
		withSuffix('X', taken);
		expect(taken.size).toBe(1);
	});
});

describe('planLocalPaths with the M0 pages fixture', () => {
	let plan: PathPlan;
	beforeEach(() => {
		plan = planLocalPaths([tree(1, 'Handbuch', loadFixturePages())], NO_KNOWN);
	});

	it('maps the landing page 92 to the collective folder note Handbuch/Handbuch.md', () => {
		expect(targetPath(plan, 92)).toBe('Handbuch/Handbuch.md');
	});

	it('maps the leaf page 102 "Per WebDAV" directly below the collective folder', () => {
		expect(targetPath(plan, 102)).toBe('Handbuch/Per WebDAV.md');
	});

	it('maps the parent page 98 "Prozesse" to its folder note Handbuch/Prozesse/Prozesse.md', () => {
		expect(targetPath(plan, 98)).toBe('Handbuch/Prozesse/Prozesse.md');
	});

	it('maps the leaf page 101 "Umbenannt" into the folder of its parent 98', () => {
		expect(targetPath(plan, 101)).toBe('Handbuch/Prozesse/Umbenannt.md');
	});

	it('maps the parent page 97 "Onboarding" to its folder note Handbuch/Onboarding/Onboarding.md', () => {
		expect(targetPath(plan, 97)).toBe('Handbuch/Onboarding/Onboarding.md');
	});

	it('maps the leaf page 114 "Erster Tag" into the folder Handbuch/Onboarding', () => {
		expect(targetPath(plan, 114)).toBe('Handbuch/Onboarding/Erster Tag.md');
	});

	it('gives no ncTitle for the landing page, even though its title differs from the folder name', () => {
		expect(plan.targets.get(asPageId(92))?.ncTitle).toBeNull();
	});

	it('reports no orphans for the complete fixture', () => {
		expect(plan.orphans).toEqual([]);
	});
});

describe('planLocalPaths rules', () => {
	it('sets ncTitle to the original title when the sanitized name differs', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(10, 'A#B', 1)])],
			NO_KNOWN,
		);
		expect(plan.targets.get(asPageId(10))).toMatchObject({ path: 'Coll/A_B.md', ncTitle: 'A#B' });
	});

	it('sets ncTitle to null when the title equals the file base name', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(10, 'Plain', 1)])],
			NO_KNOWN,
		);
		expect(plan.targets.get(asPageId(10))?.ncTitle).toBeNull();
	});

	it('gives a page with a collision suffix the original title as ncTitle', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(10, 'X', 1), leaf(11, 'x', 1)])],
			NO_KNOWN,
		);
		expect(plan.targets.get(asPageId(11))).toMatchObject({ path: 'Coll/x (2).md', ncTitle: 'x' });
	});

	it('gives the lower page id the plain name when two sibling titles differ only by case', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(10, 'X', 1), leaf(11, 'x', 1)])],
			NO_KNOWN,
		);
		expect(targetPath(plan, 10)).toBe('Coll/X.md');
	});

	it('gives the higher page id the suffix " (2)" when two sibling titles differ only by case', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(10, 'X', 1), leaf(11, 'x', 1)])],
			NO_KNOWN,
		);
		expect(targetPath(plan, 11)).toBe('Coll/x (2).md');
	});

	it('reserves the collective folder note name, so a leaf titled like the collective becomes "(2)"', () => {
		const plan = planLocalPaths(
			[tree(1, 'Handbuch', [startPage(1, 'Landing'), leaf(2, 'Handbuch', 1)])],
			NO_KNOWN,
		);
		expect(targetPath(plan, 2)).toBe('Handbuch/Handbuch (2).md');
	});

	it('does not collide a leaf file "Prozesse.md" with the folder of a parent page "Prozesse"', () => {
		const folderPage = page(13, { title: 'Prozesse', fileName: 'Readme.md', parentId: asPageId(1) });
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), leaf(12, 'Prozesse', 1), folderPage])],
			NO_KNOWN,
		);
		expect(targetPath(plan, 12)).toBe('Coll/Prozesse.md');
	});

	it('gives a folder page without children a folder and folder note of the same name', () => {
		const solo = page(20, { title: 'Solo', fileName: 'Readme.md', parentId: asPageId(1) });
		const plan = planLocalPaths([tree(1, 'Coll', [startPage(1, 'Coll'), solo])], NO_KNOWN);
		expect(targetPath(plan, 20)).toBe('Coll/Solo/Solo.md');
	});

	it('keeps a leaf page with a .md file name as a plain file, not a folder note', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), page(21, { title: 'Solo', fileName: 'Solo.md', parentId: asPageId(1) })])],
			NO_KNOWN,
		);
		expect(targetPath(plan, 21)).toBe('Coll/Solo.md');
	});

	it('reports a page whose parent is missing as an orphan, together with its descendants', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), page(30, { title: 'Waise', parentId: asPageId(999) }), page(31, { title: 'Kind', fileName: 'Readme.md', parentId: asPageId(30), filePath: 'Waise' })])],
			NO_KNOWN,
		);
		expect(sortedIds(plan.orphans)).toEqual([30, 31]);
	});

	it('gives an orphan no target path', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), page(30, { title: 'Waise', parentId: asPageId(999) })])],
			NO_KNOWN,
		);
		expect(plan.targets.has(asPageId(30))).toBe(false);
	});

	it('treats only the lowest id as the start page and reports further start pages as orphans', () => {
		const plan = planLocalPaths(
			[tree(1, 'Coll', [startPage(1, 'Coll'), startPage(2, 'Zweite Startseite')])],
			NO_KNOWN,
		);
		expect(sortedIds(plan.orphans)).toEqual([2]);
	});

	it('gives the collective with the lower id the plain folder name', () => {
		const plan = planLocalPaths([tree(3, 'Team', []), tree(5, 'team', [])], NO_KNOWN);
		expect(plan.collectiveFolders.get(asCollectiveId(3))).toBe('Team');
	});

	it('gives the second collective with a case-insensitively equal name the suffix " (2)"', () => {
		const plan = planLocalPaths([tree(3, 'Team', []), tree(5, 'team', [])], NO_KNOWN);
		expect(plan.collectiveFolders.get(asCollectiveId(5))).toBe('team (2)');
	});

	it('keeps a known folder of a collective even when the remote name differs', () => {
		const known = new Map<CollectiveId, string>([[asCollectiveId(5), 'Alt']]);
		const plan = planLocalPaths([tree(5, 'team', [])], known);
		expect(plan.collectiveFolders.get(asCollectiveId(5))).toBe('Alt');
	});

	it('reserves a known folder first, so another collective with the same name gets the suffix', () => {
		const known = new Map<CollectiveId, string>([[asCollectiveId(5), 'Team']]);
		const plan = planLocalPaths([tree(3, 'Team', []), tree(5, 'team', [])], known);
		expect(plan.collectiveFolders.get(asCollectiveId(3))).toBe('Team (2)');
	});
});

describe('isSyncedPath', () => {
	it('excludes a Markdown file directly in the vault root', () => {
		expect(isSyncedPath('a.md', '.obsidian')).toBe(false);
	});

	it('excludes files below the config directory', () => {
		expect(isSyncedPath('.obsidian/x.md', '.obsidian')).toBe(false);
	});

	it('excludes files in hidden folders', () => {
		expect(isSyncedPath('A/.hidden/x.md', '.obsidian')).toBe(false);
	});

	it('excludes non-Markdown files', () => {
		expect(isSyncedPath('A/x.png', '.obsidian')).toBe(false);
	});

	it('includes a Markdown file below a collective folder', () => {
		expect(isSyncedPath('A/x.md', '.obsidian')).toBe(true);
	});

	it('excludes conflict files', () => {
		expect(isSyncedPath('A/x (Konflikt 2026-10-16 1430).md', '.obsidian')).toBe(false);
	});
});

describe('isConflictFileName', () => {
	it('recognizes a German conflict file name', () => {
		expect(isConflictFileName('A/B (Konflikt 2026-10-16 1430).md')).toBe(true);
	});

	it('recognizes an English conflict file name', () => {
		expect(isConflictFileName('A/B (Conflict 2026-10-16 1430).md')).toBe(true);
	});

	it('recognizes a conflict file name with a collision suffix', () => {
		expect(isConflictFileName('A/B (Konflikt 2026-10-16 1430) (2).md')).toBe(true);
	});

	it('does not treat an ordinary file name as a conflict file', () => {
		expect(isConflictFileName('A/B.md')).toBe(false);
	});
});

describe('conflictPath', () => {
	const date = new Date(2026, 9, 16, 14, 30);

	it('builds the German conflict name with local date and HHmm next to the file', () => {
		expect(conflictPath('A/B.md', 'Konflikt', date, new Set<string>())).toBe('A/B (Konflikt 2026-10-16 1430).md');
	});

	it('builds the English conflict name with the given label', () => {
		expect(conflictPath('A/B.md', 'Conflict', date, new Set<string>())).toBe('A/B (Conflict 2026-10-16 1430).md');
	});

	it('appends " (2)" before ".md" when the conflict name is taken', () => {
		const taken = new Set([pathKey('A/B (Konflikt 2026-10-16 1430).md')]);
		expect(conflictPath('A/B.md', 'Konflikt', date, taken)).toBe('A/B (Konflikt 2026-10-16 1430) (2).md');
	});
});
