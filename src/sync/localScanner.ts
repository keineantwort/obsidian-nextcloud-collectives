// Types of the local scan (PLAN §5). The scan function itself follows in a later step.
import type { PageId } from '../api/types';

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
