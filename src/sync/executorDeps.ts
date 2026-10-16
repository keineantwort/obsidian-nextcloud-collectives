// Dependencies of the sync executor (PLAN §7.2). Types only.
import type { WebdavClient } from '../api/webdavClient';
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
}

export interface ExecutorDeps {
	vault: VaultWriter;
	webdav: Pick<WebdavClient, 'get' | 'put'>;
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
	/** Set of pathKey of all vault paths; executor adds the paths it creates. */
	occupied: Set<string>;
}
