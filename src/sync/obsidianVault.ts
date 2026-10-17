// Obsidian adapter for the sync: app.vault for notes and the metadata cache for nc_page_id.
// Notes are only touched through the vault API (AGENTS rule 2).
import type { App, TFile } from 'obsidian';
import type { PageId } from '../api/types';
import { pageIdFromFrontmatterValue } from '../mapping/frontmatter';
import { NotFoundError } from '../util/errors';
import { isRecord } from '../util/isRecord';
import type { VaultWriter } from './executor';
import type { VaultReader } from './localScanner';

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
		listFiles: () => vault.getFiles().map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size })),
		listFolders: () => vault.getAllFolders(false).map((folder) => folder.path),
		/** Valid nc_page_id from the cache; undefined for anything else, so the scan reads the file itself. */
		cachedPageId(path: string): PageId | undefined {
			const file = vault.getFileByPath(path);
			if (file === null) return undefined;
			const cache = app.metadataCache.getFileCache(file);
			if (cache === null) return undefined;
			const frontmatter: unknown = cache.frontmatter;
			if (!isRecord(frontmatter)) return undefined;
			return pageIdFromFrontmatterValue(frontmatter['nc_page_id']);
		},
		read: (path) => vault.read(requireFile(path)),
		readBinary: (path) => vault.readBinary(requireFile(path)),
		createBinary: async (path, data) => {
			const file = await vault.createBinary(path, data);
			return file.stat.mtime;
		},
		modifyBinary: async (path, data) => {
			const file = requireFile(path);
			await vault.modifyBinary(file, data);
			return file.stat.mtime;
		},
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
		rename: async (from, to) => {
			const entry = vault.getAbstractFileByPath(from);
			if (entry === null) throw new NotFoundError('Vault entry not found');
			await app.fileManager.renameFile(entry, to);
		},
		trash: async (path) => {
			const entry = vault.getAbstractFileByPath(path);
			if (entry !== null) await app.fileManager.trashFile(entry);
		},
	};
}
