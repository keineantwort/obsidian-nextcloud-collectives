import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { asPageId } from '../../src/api/types';
import { createObsidianVault } from '../../src/sync/obsidianVault';

/**
 * Minimal app with one file 'Coll/Seite.md'. `cache` is what the metadata cache returns for it:
 * undefined → no file at the path, null → no cache entry, otherwise the cache with that frontmatter.
 */
function appWith(cache: { frontmatter?: unknown } | null | undefined): App {
	const file = { path: 'Coll/Seite.md' };
	const app = {
		vault: {
			configDir: '.obsidian',
			getFileByPath: (path: string) => (path === file.path && cache !== undefined ? file : null),
		},
		metadataCache: {
			getFileCache: () => cache,
		},
	};
	return app as unknown as App;
}

describe('createObsidianVault cachedPageId', () => {
	it.each<{ name: string; cache: { frontmatter?: unknown } | null; expected: number | undefined }>([
		{ name: 'returns the page id of a valid integer nc_page_id', cache: { frontmatter: { nc_page_id: 97 } }, expected: 97 },
		{ name: 'returns the page id of a quoted nc_page_id', cache: { frontmatter: { nc_page_id: '97' } }, expected: 97 },
		{ name: 'returns undefined when the cache has a frontmatter without nc_page_id', cache: { frontmatter: { title: 'x' } }, expected: undefined },
		{ name: 'returns undefined when the cached nc_page_id is not a number', cache: { frontmatter: { nc_page_id: 'abc' } }, expected: undefined },
		{ name: 'returns undefined when the cached nc_page_id is negative', cache: { frontmatter: { nc_page_id: -1 } }, expected: undefined },
		{ name: 'returns undefined when the cached nc_page_id is a fraction', cache: { frontmatter: { nc_page_id: 1.5 } }, expected: undefined },
		{ name: 'returns undefined when the cache has no frontmatter at all', cache: { frontmatter: undefined }, expected: undefined },
		{ name: 'returns undefined when the metadata cache has no entry for the file', cache: null, expected: undefined },
	])('$name', ({ cache, expected }) => {
		const vault = createObsidianVault(appWith(cache));
		expect(vault.cachedPageId('Coll/Seite.md')).toBe(expected);
	});

	it('returns undefined when the file is not in the vault', () => {
		const vault = createObsidianVault(appWith({ frontmatter: { nc_page_id: 97 } }));
		expect(vault.cachedPageId('Coll/Fehlt.md')).toBeUndefined();
	});

	it('returns the page id of a valid cache entry for the file', () => {
		const vault = createObsidianVault(appWith({ frontmatter: { nc_page_id: 97 } }));
		expect(vault.cachedPageId('Coll/Seite.md')).toBe(asPageId(97));
	});
});

describe('createObsidianVault rename and trash', () => {
	function appWithFileManager(): { app: App; renamed: [string, string][]; trashed: string[] } {
		const entries = new Set(['Coll/Alt.md', 'Coll']);
		const renamed: [string, string][] = [];
		const trashed: string[] = [];
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => (entries.has(path) ? { path } : null),
			},
			fileManager: {
				renameFile: (entry: { path: string }, to: string) => {
					renamed.push([entry.path, to]);
					return Promise.resolve();
				},
				trashFile: (entry: { path: string }) => {
					trashed.push(entry.path);
					return Promise.resolve();
				},
			},
		};
		return { app: app as unknown as App, renamed, trashed };
	}

	it('renames files and folders through the file manager, so that links are updated', async () => {
		const { app, renamed } = appWithFileManager();
		const vault = createObsidianVault(app);

		await vault.rename('Coll/Alt.md', 'Coll/Neu.md');
		await vault.rename('Coll', 'Neu');

		expect(renamed).toEqual([['Coll/Alt.md', 'Coll/Neu.md'], ['Coll', 'Neu']]);
	});

	it('fails to rename what is not in the vault', async () => {
		const { app } = appWithFileManager();

		await expect(createObsidianVault(app).rename('Coll/Fehlt.md', 'Coll/Neu.md')).rejects.toThrow('not found');
	});

	it('moves files and folders to the trash through the file manager, and ignores what is gone', async () => {
		const { app, trashed } = appWithFileManager();
		const vault = createObsidianVault(app);

		await vault.trash('Coll');
		await vault.trash('Coll/Fehlt.md');

		expect(trashed).toEqual(['Coll']);
	});
});
