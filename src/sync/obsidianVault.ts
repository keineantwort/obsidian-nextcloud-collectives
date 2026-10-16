// Obsidian adapter for the sync: app.vault for notes and the metadata cache for nc_page_id.
// Notes are only touched through the vault API (AGENTS rule 2).
import type { App, TFile } from 'obsidian';
import { asPageId } from '../api/types';
import type { PageId } from '../api/types';
import { NotFoundError } from '../util/errors';
import { isRecord } from '../util/isRecord';
import type { VaultWriter } from './executor';
import type { VaultReader } from './localScanner';

/** nc_page_id from the metadata cache: a number, or a string of digits (quoted in YAML). Anything else → null. */
function parsePageId(value: unknown): PageId | null {
	if (typeof value === 'number' && Number.isInteger(value)) return asPageId(value);
	if (typeof value === 'string' && /^\d+$/.test(value)) return asPageId(Number(value));
	return null;
}

export function createObsidianVault(app: App): VaultReader & VaultWriter {
	const vault = app.vault;

	/** The file at `path`; throws NotFoundError if it is gone (e.g. renamed by the user during the run). */
	function requireFile(path: string): TFile {
		const file = vault.getFileByPath(path);
		if (file === null) throw new NotFoundError('Vault file not found');
		return file;
	}

	return {
		configDir: vault.configDir,
		listFiles: () => vault.getFiles().map((file) => ({ path: file.path, mtime: file.stat.mtime })),
		listFolders: () => vault.getAllFolders(false).map((folder) => folder.path),
		cachedPageId(path: string): PageId | null | undefined {
			const file = vault.getFileByPath(path);
			if (file === null) return undefined;
			const cache = app.metadataCache.getFileCache(file);
			if (cache === null) return undefined;
			const frontmatter: unknown = cache.frontmatter;
			if (!isRecord(frontmatter)) return undefined;
			return parsePageId(frontmatter['nc_page_id']);
		},
		read: (path) => vault.read(requireFile(path)),
		exists: (path) => vault.getAbstractFileByPath(path) !== null,
		create: async (path, content) => {
			const file = await vault.create(path, content);
			return file.stat.mtime;
		},
		process: async (path, fn) => {
			const file = requireFile(path);
			await vault.process(file, fn);
			return file.stat.mtime;
		},
		createFolder: async (path) => {
			await vault.createFolder(path);
		},
		mtime: (path) => vault.getFileByPath(path)?.stat.mtime ?? null,
	};
}
