import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import type { ConflictEntry } from '../../src/sync/conflicts';
import type { DiffLine } from '../../src/util/diff';
import {
	describeConflict,
	diffRows,
	entryKey,
	hasChanges,
	nextFocusIndex,
	remoteUnavailableMessage,
	resolutionAnnouncement,
	splitPath,
} from '../../src/ui/conflictView';

const en = createTranslator('en');
const de = createTranslator('de');

function same(count: number): DiffLine[] {
	return Array.from({ length: count }, (_, i) => ({ kind: 'same' as const, text: `s${i}` }));
}

const REMOVED: DiffLine = { kind: 'removed', text: 'old' };
const ADDED: DiffLine = { kind: 'added', text: 'new' };

function entry(partial: Partial<ConflictEntry> = {}): ConflictEntry {
	return {
		pageId: asPageId(7),
		collectiveId: asCollectiveId(1),
		status: 'conflict',
		localPath: 'Coll/Sub/Page.md',
		conflictPath: 'Coll/Sub/Page (Conflict 2026-10-16 0950).md',
		...partial,
	};
}

describe('diffRows', () => {
	it('returns no rows for no lines', () => {
		expect(diffRows([])).toEqual([]);
	});

	it('keeps all lines when the changes are close together', () => {
		const lines = [...same(2), REMOVED, ...same(2)];

		expect(diffRows(lines)).toEqual(lines.map((line) => ({ kind: line.kind, text: line.text })));
	});

	it('hides the start of a run before a change and keeps the last context lines', () => {
		const rows = diffRows([...same(10), ADDED]);

		expect(rows).toEqual([
			{ kind: 'skipped', count: 7 },
			{ kind: 'same', text: 's7' },
			{ kind: 'same', text: 's8' },
			{ kind: 'same', text: 's9' },
			{ kind: 'added', text: 'new' },
		]);
	});

	it('hides the end of a run after a change and keeps the first context lines', () => {
		const rows = diffRows([REMOVED, ...same(10)]);

		expect(rows).toEqual([
			{ kind: 'removed', text: 'old' },
			{ kind: 'same', text: 's0' },
			{ kind: 'same', text: 's1' },
			{ kind: 'same', text: 's2' },
			{ kind: 'skipped', count: 7 },
		]);
	});

	it('hides the middle of a run between two changes and keeps context on both sides', () => {
		const rows = diffRows([REMOVED, ...same(10), ADDED]);

		expect(rows).toEqual([
			{ kind: 'removed', text: 'old' },
			{ kind: 'same', text: 's0' },
			{ kind: 'same', text: 's1' },
			{ kind: 'same', text: 's2' },
			{ kind: 'skipped', count: 4 },
			{ kind: 'same', text: 's7' },
			{ kind: 'same', text: 's8' },
			{ kind: 'same', text: 's9' },
			{ kind: 'added', text: 'new' },
		]);
	});

	it('shows a run of seven unchanged lines between changes in full', () => {
		const rows = diffRows([REMOVED, ...same(7), ADDED]);

		expect(rows.some((row) => row.kind === 'skipped')).toBe(false);
		expect(rows).toHaveLength(9);
	});

	it('hides exactly two lines of a run of eight between changes', () => {
		const rows = diffRows([REMOVED, ...same(8), ADDED]);

		expect(rows[4]).toEqual({ kind: 'skipped', count: 2 });
	});

	it('respects a smaller context', () => {
		const rows = diffRows([...same(10), ADDED], 1);

		expect(rows[0]).toEqual({ kind: 'skipped', count: 9 });
		expect(rows[1]).toEqual({ kind: 'same', text: 's9' });
	});

	it('keeps the order and the text of changed lines', () => {
		const rows = diffRows([REMOVED, { kind: 'removed', text: 'older' }, ADDED]);

		expect(rows).toEqual([
			{ kind: 'removed', text: 'old' },
			{ kind: 'removed', text: 'older' },
			{ kind: 'added', text: 'new' },
		]);
	});
});

describe('hasChanges', () => {
	it('is false when every line is unchanged', () => {
		expect(hasChanges(same(3))).toBe(false);
	});

	it('is true when one line was added', () => {
		expect(hasChanges([...same(3), ADDED])).toBe(true);
	});
});

describe('describeConflict', () => {
	it('names the page and explains the kept local file and the conflict copy', () => {
		const description = describeConflict(entry(), en);

		expect(description.name).toBe('Page');
		expect(description.path).toBe('Coll/Sub/Page.md');
		expect(description.explanation).toContain('“Page (Conflict 2026-10-16 0950).md”');
		expect(description.keepLocalEffect).toBe('“Keep local” uploads your file and overwrites the version on the server.');
		expect(description.takeRemoteEffect).toBe('“Take remote” replaces the content of your file with the server version.');
		expect(description.trashNote).toBe('In both cases, “Page (Conflict 2026-10-16 0950).md” is moved to the trash.');
		expect(description.laterEffect).toBe('“Later” leaves everything as it is. The page is not uploaded until you decide.');
	});

	it('uses the no-copy explanation and no trash note without a conflict copy', () => {
		const description = describeConflict(entry({ conflictPath: null }), en);

		expect(description.explanation).toBe('This page was changed here and on the server since the last sync. Your file was kept.');
		expect(description.trashNote).toBeNull();
	});

	it('uses the collision texts and the linking effects for a collision with a copy', () => {
		const description = describeConflict(entry({ status: 'collision' }), en);

		expect(description.explanation).toContain('the server page was saved next to it as “Page (Conflict 2026-10-16 0950).md”');
		expect(description.keepLocalEffect).toBe(
			'“Keep local” links your file to this server page, uploads it and overwrites the page on the server.',
		);
		expect(description.takeRemoteEffect).toBe(
			'“Take remote” links your file to this server page and replaces its content with the server version.',
		);
		expect(description.trashNote).not.toBeNull();
	});

	it('uses the collision text without a copy', () => {
		const description = describeConflict(entry({ status: 'collision', conflictPath: null }), en);

		expect(description.explanation).toBe(
			'A file with this name already existed in your vault when this page was downloaded from the server. Your file was kept.',
		);
		expect(description.trashNote).toBeNull();
	});

	it('uses German quotes in German', () => {
		const description = describeConflict(entry(), de);

		expect(description.explanation).toContain('„Page (Conflict 2026-10-16 0950).md“');
	});
});

describe('remoteUnavailableMessage', () => {
	it('names the missing conflict copy when there is one', () => {
		expect(remoteUnavailableMessage(entry(), en)).toBe(
			'The server version “Page (Conflict 2026-10-16 0950).md” is no longer in your vault, so it cannot be compared. “Take remote” downloads the server version again.',
		);
	});

	it('explains that no server version was saved when there is no copy', () => {
		expect(remoteUnavailableMessage(entry({ conflictPath: null }), en)).toBe(
			'No server version was saved in your vault, so it cannot be compared. “Take remote” downloads the server version.',
		);
	});
});

describe('splitPath', () => {
	it('splits at the last slash', () => {
		expect(splitPath('a/b/c.md')).toEqual({ folder: 'a/b', file: 'c.md' });
	});

	it('gives an empty folder for a file in the root', () => {
		expect(splitPath('c.md')).toEqual({ folder: '', file: 'c.md' });
	});
});

describe('nextFocusIndex', () => {
	it.each([
		[0, 0, null],
		[0, 3, 0],
		[1, 3, 1],
		[2, 2, 1],
		[5, 1, 0],
	])('for resolved index %i with %i remaining gives %s', (resolved, remaining, expected) => {
		expect(nextFocusIndex(resolved, remaining)).toBe(expected);
	});
});

describe('resolutionAnnouncement', () => {
	it('reports the remaining conflicts', () => {
		expect(resolutionAnnouncement('Page', 2, false, en)).toBe('“Page” is resolved. 2 conflicts left.');
	});

	it('uses the singular for one remaining conflict', () => {
		expect(resolutionAnnouncement('Page', 1, false, en)).toBe('“Page” is resolved. 1 conflict left.');
	});

	it('announces that all conflicts are resolved when none is left', () => {
		expect(resolutionAnnouncement('Page', 0, false, en)).toBe('All conflicts are resolved.');
	});

	it('announces a page that is open again', () => {
		expect(resolutionAnnouncement('Page', 2, true, en)).toBe(
			'The server version of “Page” changed again in the meantime, so there is a new conflict.',
		);
	});

	it('uses the German texts', () => {
		expect(resolutionAnnouncement('Seite', 2, false, de)).toBe('„Seite“ ist geklärt. 2 Konflikte offen.');
	});
});

describe('entryKey', () => {
	it('is stable for the same entry', () => {
		expect(entryKey(entry())).toBe(entryKey(entry()));
	});

	it('distinguishes the same page ID in different collectives', () => {
		expect(entryKey(entry({ collectiveId: asCollectiveId(1) }))).not.toBe(entryKey(entry({ collectiveId: asCollectiveId(2) })));
	});
});
