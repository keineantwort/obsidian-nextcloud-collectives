// Local scan (PLAN §5): synced Markdown files with their nc_page_id, plus all vault paths for collision checks.
import type { PageId } from '../api/types';
import { readPageId } from '../mapping/frontmatter';
import { isSyncedPath, pathKey } from '../mapping/paths';

export interface LocalFile {
	path: string;
	mtime: number;
	/** nc_page_id from the frontmatter, or null. */
	pageId: PageId | null;
}

export interface LocalSnapshot {
	/** Synced Markdown files (isSyncedPath). */
	files: LocalFile[];
	/** pathKey of every file AND folder in the vault (for collision checks), incl. non-synced ones. */
	occupied: Set<string>;
	/** True if the vault contains any file or folder outside configDir. */
	nonEmpty: boolean;
}

/** Port, implemented over app.vault + app.metadataCache in src/sync/obsidianVault.ts. */
export interface VaultReader {
	configDir: string;
	/** All files: path + mtime. */
	listFiles(): { path: string; mtime: number }[];
	/** All folder paths except the root ''. */
	listFolders(): string[];
	/** nc_page_id from the metadata cache, or undefined if the cache has no frontmatter info for the file. */
	cachedPageId(path: string): PageId | null | undefined;
	read(path: string): Promise<string>;
}

/** True for paths inside the config folder (or the folder itself). */
function isInConfigDir(path: string, configDir: string): boolean {
	return path === configDir || path.startsWith(configDir + '/');
}

/** If cachedPageId is undefined, reads the file and uses readPageId. */
export async function scanLocal(vault: VaultReader): Promise<LocalSnapshot> {
	const files: LocalFile[] = [];
	const occupied = new Set<string>();
	let nonEmpty = false;

	for (const file of vault.listFiles()) {
		occupied.add(pathKey(file.path));
		if (!isInConfigDir(file.path, vault.configDir)) nonEmpty = true;
		if (!isSyncedPath(file.path, vault.configDir)) continue;
		const cached = vault.cachedPageId(file.path);
		const pageId = cached !== undefined ? cached : readPageId(await vault.read(file.path));
		files.push({ path: file.path, mtime: file.mtime, pageId });
	}

	for (const folder of vault.listFolders()) {
		occupied.add(pathKey(folder));
		if (!isInConfigDir(folder, vault.configDir)) nonEmpty = true;
	}

	return { files, occupied, nonEmpty };
}
