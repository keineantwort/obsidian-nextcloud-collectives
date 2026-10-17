// Dependencies of the sync executor (PLAN §7.2). Types only.
import type { CollectivesApi } from '../api/collectivesApi';
import type { WebdavClient } from '../api/webdavClient';
import type { AttachmentOptions } from '../mapping/attachments';
import type { LinkIndex } from '../mapping/links';
import type { Logger } from '../util/logger';
import type { ConflictStrategy } from './decide';
import type { SyncState } from './state';

/** Vault writes used by the executor; implemented over app.vault in obsidianVault.ts. */
export interface VaultWriter {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	/** Bytes of a file (attachments). */
	readBinary(path: string): Promise<ArrayBuffer>;
	/** Creates a new binary file (fails if it exists; the parent folder must exist). Returns mtime after write. */
	createBinary(path: string, data: ArrayBuffer): Promise<number>;
	/** Replaces the bytes of an existing file. Returns mtime after write. */
	modifyBinary(path: string, data: ArrayBuffer): Promise<number>;
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

/** What the attachment step needs (PLAN §9.4). Without it attachments are not synced. */
export interface AttachmentDeps {
	options: AttachmentOptions;
	/** Delete the server file of an attachment deleted in the vault and no longer embedded. */
	deleteRemote: boolean;
	/** What happens to the vault file of an attachment the server deleted. */
	remoteDelete: 'obsidianTrash' | 'keepUnlinked';
	webdav: Pick<WebdavClient, 'propfind' | 'mkcol' | 'getBinary' | 'putBinary'>;
	api: Pick<CollectivesApi, 'listAttachments' | 'deleteAttachment'>;
}

export interface ExecutorDeps {
	vault: VaultWriter;
	webdav: Pick<WebdavClient, 'get' | 'put'>;
	/** Needed by the structure operations only. */
	api?: StructureApi;
	state: SyncState;
	/** Pages that links can point to (PLAN §9). Without it, links are neither converted nor hashed in local form. */
	links?: LinkIndex;
	/** Attachments of pages (PLAN §9.4); absent = not synced. */
	attachments?: AttachmentDeps;
	/** Persist state after each op (StateStore.save). 'lazy' may be written later (throttled, flushed at the end of the run). */
	persist: (state: SyncState, mode?: 'now' | 'lazy') => Promise<void>;
	now: () => Date;
	/** Translated label for conflict file names ('Konflikt' / 'Conflict'). */
	conflictLabel: string;
	/** Conflict decision for pages changed on both sides (PLAN §7.3). */
	strategy: ConflictStrategy;
	/** Waits before a second GET when an ETag is not confirmed yet. Injectable for tests. */
	sleep: (ms: number) => Promise<void>;
	log: Logger;
	/** Set of pathKey of all vault paths; executor adds the paths it creates. */
	occupied: Set<string>;
}
