import { describe, expect, it } from 'vitest';
import { asPageId } from '../../src/api/types';
import type { PageId } from '../../src/api/types';
import { indexFiles, locatePage } from '../../src/sync/locate';
import type { Locatable } from '../../src/sync/locate';
import type { PageStatus } from '../../src/sync/state';

function file(path: string, pageId: number | null): Locatable {
	return { path, pageId: pageId === null ? null : asPageId(pageId) };
}

function known(pageId: number, localPath: string, status: PageStatus = 'synced'): { pageId: PageId; localPath: string; status: PageStatus } {
	return { pageId: asPageId(pageId), localPath, status };
}

describe('locatePage', () => {
	it('finds a linked page by nc_page_id, wherever the user moved the file', () => {
		const index = indexFiles([file('Coll/Neu/Umbenannt.md', 10), file('Coll/Andere.md', 11)]);

		expect(locatePage(known(10, 'Coll/Alt.md'), index)?.path).toBe('Coll/Neu/Umbenannt.md');
	});

	it('finds nothing when no file carries the id', () => {
		const index = indexFiles([file('Coll/Andere.md', 11)]);

		expect(locatePage(known(10, 'Coll/Alt.md'), index)).toBeUndefined();
	});

	it('finds nothing when several files carry the id (the page is not touched)', () => {
		const index = indexFiles([file('Coll/A.md', 10), file('Coll/B.md', 10)]);

		expect(locatePage(known(10, 'Coll/A.md'), index)).toBeUndefined();
		expect(index.duplicates.has(asPageId(10))).toBe(true);
	});

	it('finds a collision page by its path in any case, among files without nc_page_id only', () => {
		const index = indexFiles([file('Coll/notiz.md', null), file('Coll/Notiz.md', 10)]);

		expect(locatePage(known(10, 'Coll/Notiz.md', 'collision'), index)?.path).toBe('Coll/notiz.md');
	});

	it('does not find a collision page through an nc_page_id', () => {
		const index = indexFiles([file('Coll/Woanders.md', 10)]);

		expect(locatePage(known(10, 'Coll/Notiz.md', 'collision'), index)).toBeUndefined();
	});
});
