// Dependencies of the sync executor (PLAN §7.2). Types only.
import type { CollectivesApi } from '../api/collectivesApi';
import type { WebdavClient } from '../api/webdavClient';
import type { TagsProperty } from '../mapping/tags';
import type { Logger } from '../util/logger';
import type { ConflictStrategy } from './decide';
import type { SyncState } from './state';

/** Vault writes used by the executor; implemented over app.vault in obsidianVault.ts. */
export interface VaultWriter {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	/** Creates a new file (fails if it exists). Returns mtime after write. */
	create(path: string, content: string): Promise<number>;
	/** Atomic read-modify-write (app.vault.process). Returns mtime after write. */
	process(path: string, fn: (current: string) => string): Promise<number>;
	createFolder(path: string): Promise<void>;
	mtime(path: string): number | null;
	/** Renames or moves a file or folder (app.fileManager.renameFile: links to it are updated). The parent folder must exist. */
	rename(from: string, to: string): Promise<void>;
	/** Moves a file or folder to the trash the user chose in Obsidian (app.fileManager.trashFile). */
	trash(path: string): Promise<void>;
}

/** The Collectives calls the structure operations make. */
export type StructureApi = Pick<
	CollectivesApi,
	| 'createPage' | 'getPage' | 'updatePage' | 'movePageToCollective' | 'trashPage' | 'restorePage' | 'listPages'
	| 'createCollective' | 'renameCollective' | 'trashCollective'
	| 'setPageEmoji' | 'addPageTag' | 'removePageTag' | 'listTags' | 'createTag'
>;

export interface ExecutorDeps {
	vault: VaultWriter;
	webdav: Pick<WebdavClient, 'get' | 'put'>;
	/** Needed by the structure operations only. */
	api?: StructureApi;
	state: SyncState;
	/** Persist state after each op (StateStore.save). */
	persist: (state: SyncState) => Promise<void>;
	now: () => Date;
	/** Translated label for conflict file names ('Konflikt' / 'Conflict'). */
	conflictLabel: string;
	/** Conflict decision for pages changed on both sides (PLAN §7.3). */
	strategy: ConflictStrategy;
	/** Waits before a second GET when an ETag is not confirmed yet. Injectable for tests. */
	sleep: (ms: number) => Promise<void>;
	log: Logger;
	/** Frontmatter key for the tags besides nc_tags (PLAN §10.2); default nc_tags only. */
	tagsProperty?: TagsProperty;
	/** Set of pathKey of all vault paths; executor adds the paths it creates. */
	occupied: Set<string>;
}
