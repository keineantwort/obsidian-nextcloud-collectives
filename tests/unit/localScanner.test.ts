import { describe, expect, it } from 'vitest';
import { asPageId } from '../../src/api/types';
import { pathKey } from '../../src/mapping/paths';
import { scanLocal } from '../../src/sync/localScanner';
import { MemoryVault } from '../fakes/memoryVault';

/** Keys of a path and all of its ancestor folders, as the scanner must record them. */
function keysOf(path: string): string[] {
	const parts = path.split('/');
	return parts.map((_part, i) => pathKey(parts.slice(0, i + 1).join('/')));
}

describe('scanLocal', () => {
	it('returns no files and nothing occupied for an empty vault', async () => {
		const snapshot = await scanLocal(new MemoryVault());

		expect(snapshot.files).toEqual([]);
		expect(snapshot.occupied.size).toBe(0);
		expect(snapshot.nonEmpty).toBe(false);
	});

	it('lists only synced Markdown files, with their mtime and the nc_page_id from the metadata cache', async () => {
		const vault = new MemoryVault();
		vault.seed('Handbuch/Seite.md', '---\nnc_page_id: 10\n---\nText\n');
		vault.seed('Handbuch/Ohne ID.md', 'Nur Text\n');
		vault.seed('Handbuch/.verborgen.md', '---\nnc_page_id: 11\n---\n');
		vault.seed('Handbuch/Notiz.txt', 'kein Markdown');
		vault.seed('Bild.png', 'bytes');
		vault.seed('Notizen/Konflikt (Konflikt 2026-10-16 1430).md', 'Kopie');

		const snapshot = await scanLocal(vault);

		expect(snapshot.files).toHaveLength(2);
		expect(snapshot.files).toEqual(
			expect.arrayContaining([
				{ path: 'Handbuch/Ohne ID.md', mtime: vault.mtime('Handbuch/Ohne ID.md'), pageId: null },
				{ path: 'Handbuch/Seite.md', mtime: vault.mtime('Handbuch/Seite.md'), pageId: asPageId(10) },
			]),
		);
	});

	it('reads the file for its nc_page_id when the metadata cache has no info for it', async () => {
		const vault = new MemoryVault({ metadataCache: false });
		vault.seed('Handbuch/Seite.md', '---\nnc_page_id: 42\n---\nText\n');
		vault.seed('Handbuch/Ohne ID.md', 'Nur Text\n');

		const snapshot = await scanLocal(vault);

		expect(snapshot.files).toHaveLength(2);
		expect(snapshot.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'Handbuch/Ohne ID.md', pageId: null }),
				expect.objectContaining({ path: 'Handbuch/Seite.md', pageId: asPageId(42) }),
			]),
		);
	});

	it('occupied holds the keys of every file and folder, including those that are not synced', async () => {
		const vault = new MemoryVault();
		vault.seed('Handbuch/Seite.md', '---\nnc_page_id: 10\n---\n');
		vault.seed('Handbuch/Notiz.txt', 'kein Markdown');
		vault.seed('Bild.png', 'bytes');
		vault.seed('.obsidian/app.json', '{}');
		vault.seedFolder(`${vault.configDir}/plugins`);
		vault.seedFolder('Leer');

		const snapshot = await scanLocal(vault);

		const expected = new Set([
			...keysOf('Handbuch/Seite.md'),
			...keysOf('Handbuch/Notiz.txt'),
			...keysOf('Bild.png'),
			...keysOf('.obsidian/app.json'),
			...keysOf('.obsidian/plugins'),
			...keysOf('Leer'),
		]);
		expect([...snapshot.occupied].sort()).toEqual([...expected].sort());
	});

	it('paths maps the key of every file and folder to the spelling that is on disk', async () => {
		const vault = new MemoryVault();
		vault.seed('Handbuch/Prozesse/Seite.md', '---\nnc_page_id: 10\n---\n');
		vault.seed('Bild.png', 'bytes');
		vault.seedFolder('Leer');

		const snapshot = await scanLocal(vault);

		expect(snapshot.paths.get(pathKey('handbuch'))).toBe('Handbuch');
		expect(snapshot.paths.get(pathKey('HANDBUCH/prozesse'))).toBe('Handbuch/Prozesse');
		expect(snapshot.paths.get(pathKey('handbuch/prozesse/seite.md'))).toBe('Handbuch/Prozesse/Seite.md');
		expect(snapshot.paths.get(pathKey('bild.png'))).toBe('Bild.png');
		expect(snapshot.paths.get(pathKey('leer'))).toBe('Leer');
	});

	it('nonEmpty is false when only the config folder has content', async () => {
		const vault = new MemoryVault();
		vault.seed('.obsidian/app.json', '{}');
		vault.seedFolder('.obsidian/plugins/x');

		const snapshot = await scanLocal(vault);

		expect(snapshot.nonEmpty).toBe(false);
		expect(snapshot.files).toEqual([]);
	});

	it('nonEmpty is true when a file outside the config folder exists, even if it is not a synced file', async () => {
		const vault = new MemoryVault();
		vault.seed('.obsidian/app.json', '{}');
		vault.seed('Bild.png', 'bytes');

		const snapshot = await scanLocal(vault);

		expect(snapshot.nonEmpty).toBe(true);
		expect(snapshot.files).toEqual([]);
	});

	it('nonEmpty is true when only an empty folder outside the config folder exists', async () => {
		const vault = new MemoryVault();
		vault.seedFolder('Leer');

		const snapshot = await scanLocal(vault);

		expect(snapshot.nonEmpty).toBe(true);
	});
});

describe('scanLocal: folders and root files', () => {
	it('lists every folder outside the config folder, with its spelling on disk', async () => {
		const vault = new MemoryVault();
		vault.seed('Handbuch/Prozesse/Urlaub.md', 'x');
		vault.seedFolder('Leer');
		vault.seedFolder(`${vault.configDir}/plugins`);

		const snapshot = await scanLocal(vault);

		expect([...snapshot.folders].sort()).toEqual(['Handbuch', 'Handbuch/Prozesse', 'Leer']);
	});

	it('reports Markdown files directly in the vault root, which are not synced', async () => {
		const vault = new MemoryVault();
		vault.seed('Lose Notiz.md', 'x');
		vault.seed('Bild.png', 'bytes');
		vault.seed('Handbuch/Seite.md', 'x');

		const snapshot = await scanLocal(vault);

		expect(snapshot.rootFiles).toEqual(['Lose Notiz.md']);
		expect(snapshot.files.map((file) => file.path)).toEqual(['Handbuch/Seite.md']);
	});
});
