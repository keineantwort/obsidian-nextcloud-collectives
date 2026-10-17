// In-memory stand-in for app.vault, used by unit tests of the local scan and the executor.
// Mirrors the parts of Obsidian's vault API that the sync code relies on, including its refusals:
// create() throws for an existing path or a missing parent folder, process() throws for a missing file.
import type { PageId } from '../../src/api/types';
import { pathKey } from '../../src/mapping/paths';
import { readPageId } from '../../src/mapping/frontmatter';
import type { VaultWriter } from '../../src/sync/executor';
import type { VaultReader } from '../../src/sync/localScanner';

export interface MemoryVaultOptions {
	/** Obsidian config folder, default '.obsidian'. */
	configDir?: string;
	/** false: cachedPageId returns undefined for every file (metadata cache has no frontmatter info). Default true. */
	metadataCache?: boolean;
	/**
	 * true (default, like macOS and Windows): paths that differ only in case or Unicode form (pathKey) name the same
	 * file or folder. listFiles/listFolders return the spelling used when the entry was created.
	 * false: paths are compared exactly (like Linux).
	 */
	caseInsensitive?: boolean;
}

interface FileEntry {
	/** Path as spelled when the file was created. */
	path: string;
	content: string;
	/** Set for binary files (attachments); `content` is '' then. */
	bytes: ArrayBuffer | null;
	mtime: number;
}

/**
 * Writes made through the sync code are counted in `writes` (create, process that changed the text, createFolder).
 * `processCalls` counts every process() call, including those that change nothing.
 * `seed`, `seedFolder` and `userEdit` simulate the setup and the user; they are not counted.
 * `beforeProcess` runs at the start of process(), before the callback is applied; it is cleared by the test if one-shot.
 */
export class MemoryVault implements VaultReader, VaultWriter {
	readonly configDir: string;
	writes = 0;
	processCalls = 0;
	beforeProcess: ((path: string) => void) | null = null;

	/** Keyed by keyOf(path); the entry keeps the spelling of its creation. */
	private readonly files = new Map<string, FileEntry>();
	/** Keyed by keyOf(path); value is the spelling of its creation. */
	private readonly folders = new Map<string, string>();
	private readonly metadataCache: boolean;
	private readonly caseInsensitive: boolean;
	private clock = 1000;

	constructor(options: MemoryVaultOptions = {}) {
		this.configDir = options.configDir ?? '.obsidian';
		this.metadataCache = options.metadataCache ?? true;
		this.caseInsensitive = options.caseInsensitive ?? true;
	}

	exists(path: string): boolean {
		const key = this.keyOf(path);
		return this.files.has(key) || this.folders.has(key);
	}

	mtime(path: string): number | null {
		return this.files.get(this.keyOf(path))?.mtime ?? null;
	}

	async read(path: string): Promise<string> {
		return this.require(path).content;
	}

	async create(path: string, content: string): Promise<number> {
		if (this.exists(path)) throw new Error(`File already exists: ${path}`);
		this.requireParent(path);
		const mtime = this.tick();
		this.files.set(this.keyOf(path), { path, content, bytes: null, mtime });
		this.writes++;
		return mtime;
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const entry = this.require(path);
		return entry.bytes ?? new TextEncoder().encode(entry.content).buffer;
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<number> {
		if (this.exists(path)) throw new Error(`File already exists: ${path}`);
		this.requireParent(path);
		const mtime = this.tick();
		this.files.set(this.keyOf(path), { path, content: '', bytes: data, mtime });
		this.writes++;
		return mtime;
	}

	async modifyBinary(path: string, data: ArrayBuffer): Promise<number> {
		const entry = this.require(path);
		entry.bytes = data;
		entry.content = '';
		entry.mtime = this.tick();
		this.writes++;
		return entry.mtime;
	}

	async process(path: string, fn: (current: string) => string): Promise<number> {
		this.processCalls++;
		this.beforeProcess?.(path);
		const entry = this.require(path);
		const next = fn(entry.content);
		if (next === entry.content) return entry.mtime;
		entry.content = next;
		entry.mtime = this.tick();
		this.writes++;
		return entry.mtime;
	}

	async createFolder(path: string): Promise<void> {
		if (this.exists(path)) throw new Error(`Folder already exists: ${path}`);
		this.requireParent(path);
		this.folders.set(this.keyOf(path), path);
		this.writes++;
	}

	cachedPageId(path: string): PageId | null | undefined {
		if (!this.metadataCache) return undefined;
		const entry = this.files.get(this.keyOf(path));
		return entry === undefined ? undefined : readPageId(entry.content);
	}

	listFiles(): { path: string; mtime: number; size: number }[] {
		return [...this.files.values()].map((entry) => ({
			path: entry.path,
			mtime: entry.mtime,
			size: entry.bytes?.byteLength ?? new TextEncoder().encode(entry.content).byteLength,
		}));
	}

	listFolders(): string[] {
		return [...this.folders.values()];
	}

	/** Setup helper: writes a file and its missing ancestor folders without counting a write. */
	seed(path: string, content: string): void {
		this.seedFolder(parentOf(path));
		this.files.set(this.keyOf(path), { path, content, bytes: null, mtime: this.tick() });
	}

	/** Setup helper: writes a binary file (and its missing ancestor folders) without counting a write. */
	seedBinary(path: string, data: ArrayBuffer): void {
		this.seedFolder(parentOf(path));
		this.files.set(this.keyOf(path), { path, content: '', bytes: data, mtime: this.tick() });
	}

	/** Simulates the user replacing the bytes of a file: new mtime, not counted as a sync write. */
	userEditBinary(path: string, data: ArrayBuffer): void {
		const entry = this.require(path);
		entry.bytes = data;
		entry.mtime = this.tick();
	}

	/** Setup helper: adds a folder and its missing ancestors without counting a write. */
	seedFolder(path: string): void {
		if (path === '') return;
		this.seedFolder(parentOf(path));
		const key = this.keyOf(path);
		if (!this.folders.has(key)) this.folders.set(key, path);
	}

	/**
	 * Like app.fileManager.renameFile: a file or a folder with everything below it moves; the parent folder of the target
	 * must exist and the target must not. Counted as a write.
	 */
	async rename(from: string, to: string): Promise<void> {
		const fromKey = this.keyOf(from);
		const isFile = this.files.has(fromKey);
		if (!isFile && !this.folders.has(fromKey)) throw new Error(`Nothing to rename at ${from}`);
		if (this.exists(to) && this.keyOf(to) !== fromKey) throw new Error(`Target exists: ${to}`);
		this.requireParent(to);
		if (isFile) {
			const entry = this.require(from);
			this.files.delete(fromKey);
			entry.path = to;
			this.files.set(this.keyOf(to), entry);
		} else {
			const prefix = fromKey + '/';
			for (const [key, entry] of [...this.files]) {
				if (!key.startsWith(prefix)) continue;
				this.files.delete(key);
				entry.path = to + entry.path.slice(from.length);
				this.files.set(this.keyOf(entry.path), entry);
			}
			for (const [key, path] of [...this.folders]) {
				if (key !== fromKey && !key.startsWith(prefix)) continue;
				this.folders.delete(key);
				const moved = to + path.slice(from.length);
				this.folders.set(this.keyOf(moved), moved);
			}
		}
		this.writes++;
	}

	/** Like app.fileManager.trashFile: a file, or a folder with everything below it, disappears. Counted as a write. */
	async trash(path: string): Promise<void> {
		const key = this.keyOf(path);
		const prefix = key + '/';
		let found = this.files.delete(key) || this.folders.delete(key);
		for (const fileKey of [...this.files.keys()]) if (fileKey.startsWith(prefix)) found = this.files.delete(fileKey) || found;
		for (const folderKey of [...this.folders.keys()]) if (folderKey.startsWith(prefix)) found = this.folders.delete(folderKey) || found;
		if (!found) throw new Error(`Nothing to trash at ${path}`);
		this.writes++;
	}

	/** Simulates moving a file to the trash: it disappears. Counted as a write, like the plugin's own trash call. */
	async remove(path: string): Promise<void> {
		const key = this.keyOf(path);
		if (!this.files.has(key)) throw new Error(`File does not exist: ${path}`);
		this.files.delete(key);
		this.writes++;
	}

	/** Simulates the user editing an existing file: new text, new mtime, not counted as a sync write. */
	userEdit(path: string, content: string): void {
		const entry = this.require(path);
		entry.content = content;
		entry.mtime = this.tick();
	}

	/**
	 * Simulates an edit that keeps the file's mtime (same millisecond as the last write, or a tool that restores it):
	 * the text changes, the mtime does not. Not counted as a sync write.
	 */
	userEditSameMtime(path: string, content: string): void {
		this.require(path).content = content;
	}

	private keyOf(path: string): string {
		return this.caseInsensitive ? pathKey(path) : path;
	}

	private require(path: string): FileEntry {
		const entry = this.files.get(this.keyOf(path));
		if (entry === undefined) throw new Error(`File does not exist: ${path}`);
		return entry;
	}

	private requireParent(path: string): void {
		const parent = parentOf(path);
		if (parent !== '' && !this.folders.has(this.keyOf(parent))) throw new Error(`Parent folder does not exist: ${parent}`);
	}

	private tick(): number {
		this.clock += 1;
		return this.clock;
	}
}

function parentOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}
