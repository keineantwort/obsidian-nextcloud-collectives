// In-memory stand-in for app.vault, used by unit tests of the local scan and the executor.
// Mirrors the parts of Obsidian's vault API that the sync code relies on, including its refusals:
// create() throws for an existing path or a missing parent folder, process() throws for a missing file.
import type { PageId } from '../../src/api/types';
import { readPageId } from '../../src/mapping/frontmatter';
import type { VaultWriter } from '../../src/sync/executor';
import type { VaultReader } from '../../src/sync/localScanner';

export interface MemoryVaultOptions {
	/** Obsidian config folder, default '.obsidian'. */
	configDir?: string;
	/** false: cachedPageId returns undefined for every file (metadata cache has no frontmatter info). Default true. */
	metadataCache?: boolean;
}

interface FileEntry {
	content: string;
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

	private readonly files = new Map<string, FileEntry>();
	private readonly folders = new Set<string>();
	private readonly metadataCache: boolean;
	private clock = 1000;

	constructor(options: MemoryVaultOptions = {}) {
		this.configDir = options.configDir ?? '.obsidian';
		this.metadataCache = options.metadataCache ?? true;
	}

	exists(path: string): boolean {
		return this.files.has(path) || this.folders.has(path);
	}

	mtime(path: string): number | null {
		return this.files.get(path)?.mtime ?? null;
	}

	async read(path: string): Promise<string> {
		return this.require(path).content;
	}

	async create(path: string, content: string): Promise<number> {
		if (this.exists(path)) throw new Error(`File already exists: ${path}`);
		this.requireParent(path);
		const mtime = this.tick();
		this.files.set(path, { content, mtime });
		this.writes++;
		return mtime;
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
		this.folders.add(path);
		this.writes++;
	}

	cachedPageId(path: string): PageId | null | undefined {
		if (!this.metadataCache) return undefined;
		const entry = this.files.get(path);
		return entry === undefined ? undefined : readPageId(entry.content);
	}

	listFiles(): { path: string; mtime: number }[] {
		return [...this.files].map(([path, entry]) => ({ path, mtime: entry.mtime }));
	}

	listFolders(): string[] {
		return [...this.folders];
	}

	/** Setup helper: writes a file and its missing ancestor folders without counting a write. */
	seed(path: string, content: string): void {
		this.seedFolder(parentOf(path));
		this.files.set(path, { content, mtime: this.tick() });
	}

	/** Setup helper: adds a folder and its missing ancestors without counting a write. */
	seedFolder(path: string): void {
		if (path === '') return;
		this.seedFolder(parentOf(path));
		this.folders.add(path);
	}

	/** Simulates the user editing an existing file: new text, new mtime, not counted as a sync write. */
	userEdit(path: string, content: string): void {
		const entry = this.require(path);
		entry.content = content;
		entry.mtime = this.tick();
	}

	private require(path: string): FileEntry {
		const entry = this.files.get(path);
		if (entry === undefined) throw new Error(`File does not exist: ${path}`);
		return entry;
	}

	private requireParent(path: string): void {
		const parent = parentOf(path);
		if (parent !== '' && !this.folders.has(parent)) throw new Error(`Parent folder does not exist: ${parent}`);
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
