// Shared setup for the integration tests against the local Docker Nextcloud: an in-memory vault, a state file, the
// recording request wrapper and helpers for the user's actions. Every Harness has its own vault and state.
import { setTimeout as delay } from 'node:timers/promises';
import { createApiClients } from '../../src/api/clients';
import type { ApiClients } from '../../src/api/clients';
import type { HttpClientOptions, HttpRequest, RequestFn } from '../../src/api/http';
import type { Collective, PageInfo } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import { readPageId } from '../../src/mapping/frontmatter';
import { DirtyQueue } from '../../src/sync/dirtyQueue';
import { StateStore } from '../../src/sync/stateStore';
import type { StateFile } from '../../src/sync/stateStore';
import { runSync } from '../../src/sync/syncRun';
import type { SyncRunDeps } from '../../src/sync/syncRun';
import type { Decision, Proposal, SyncRunOutcome } from '../../src/sync/types';
import type { SyncState } from '../../src/sync/state';
import { parseSyncState } from '../../src/sync/state';
import { ForbiddenError, NotFoundError } from '../../src/util/errors';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';
import { fetchRequest, loadTestServerEnv } from './helpers';
import type { TestServerEnv } from './helpers';

export type DoneOutcome = Extract<SyncRunOutcome, { kind: 'done' }>;

export interface RecordedRequest {
	method: string;
	url: string;
}

/** In-memory StateFile that counts writes. `text` is what is stored (null = no file). */
export class MemoryStateFile implements StateFile {
	text: string | null = null;
	writes = 0;

	async read(): Promise<string | null> {
		return this.text;
	}

	async write(text: string): Promise<void> {
		this.text = text;
		this.writes++;
	}
}

/** Returns the value or fails with a message naming the earlier step that should have set it. */
export function required<T>(value: T | undefined | null, what: string): T {
	if (value === undefined || value === null) throw new Error(`${what} is not set: an earlier step failed`);
	return value;
}

/**
 * Nextcloud derives ETags from the mtime in whole seconds: a write in the same second as the previous one keeps the old
 * ETag (docs/api-notes.md §5). Waiting past the second boundary makes the ETag change observable.
 */
export function waitPastSecondBoundary(): Promise<void> {
	return delay(1100);
}

export async function isServerInstalled(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/status.php`);
		const body = (await res.json()) as { installed?: unknown };
		return body.installed === true;
	} catch {
		return false;
	}
}

/** Answers to the questions of a run: by proposal kind, default 'reject' (nothing destructive happens by accident). */
export type Answer = (proposal: Proposal) => Decision;

export interface HarnessOptions {
	settings?: Partial<SyncRunDeps['settings']>;
}

export class Harness {
	readonly vault = new MemoryVault();
	readonly stateFile = new MemoryStateFile();
	readonly queue = new DirtyQueue();
	readonly requests: RecordedRequest[] = [];
	/** Every set of questions the runs asked, in order. */
	readonly asked: Proposal[][] = [];
	answer: Answer = () => 'reject';
	settings: SyncRunDeps['settings'];
	readonly env: TestServerEnv;
	readonly clients: ApiClients;

	private constructor(env: TestServerEnv, clients: ApiClients, options: HarnessOptions) {
		this.env = env;
		this.clients = clients;
		this.settings = {
			serverUrl: env.baseUrl,
			username: env.user,
			conflictStrategy: 'conflictFile',
			newFolderBehaviour: 'createCollective',
			localDeleteBehaviour: 'ask',
			remoteDeleteBehaviour: 'obsidianTrash',
			...options.settings,
		};
	}

	static async create(options: HarnessOptions = {}): Promise<Harness> {
		const env = loadTestServerEnv();
		if (!(await isServerInstalled(env.baseUrl))) throw new Error('Testserver läuft nicht: npm run nc:up ausführen');
		const httpOptions = (): HttpClientOptions => ({ baseUrl: env.baseUrl, username: env.user, appPassword: env.password, request: fetchRequest, sleep: () => Promise.resolve() });
		const userId = await createApiClients(httpOptions()).collectives.getCurrentUserId();
		return new Harness(env, createApiClients(httpOptions(), userId), options);
	}

	private readonly request: RequestFn = async (req: HttpRequest) => {
		this.requests.push({ method: req.method, url: req.url });
		return fetchRequest(req);
	};

	deps(): SyncRunDeps {
		return {
			settings: this.settings,
			readPassword: async () => this.env.password,
			request: this.request,
			vault: this.vault,
			stateStore: new StateStore(this.stateFile, new Logger()),
			confirmInitialSync: async () => true,
			confirm: async (proposals) => {
				this.asked.push(proposals);
				return new Map(proposals.map((proposal): [string, Decision] => [proposal.id, this.answer(proposal)]));
			},
			dirty: () => this.queue.drain(),
			t: createTranslator('en'),
			log: new Logger(),
			sleep: (ms: number) => delay(ms),
		};
	}

	/** Runs one sync and returns its outcome; fails if the run did not end with kind 'done'. */
	async sync(): Promise<DoneOutcome> {
		const outcome = await runSync(this.deps());
		if (outcome.kind !== 'done') throw new Error(`Sync ended with "${outcome.kind}" instead of "done"`);
		return outcome;
	}

	state(): SyncState {
		const parsed = parseSyncState(JSON.parse(required(this.stateFile.text, 'state file')) as unknown);
		return required(parsed, 'valid state');
	}

	/** The user edits a file. */
	edit(path: string, content: string): void {
		this.vault.userEdit(path, content);
		this.queue.noteModified(path);
	}

	/** The user creates a file (and its folders). */
	create(path: string, content: string): void {
		this.vault.seed(path, content);
		this.queue.noteModified(path);
	}

	/** The user renames or moves a file or folder. */
	async rename(from: string, to: string): Promise<void> {
		const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
		this.vault.seedFolder(dir);
		await this.vault.rename(from, to);
		this.queue.noteRenamed(from, to);
	}

	/** The user deletes a file or a folder with everything in it. */
	async remove(path: string): Promise<void> {
		await this.vault.trash(path);
		this.queue.noteDeleted(path);
	}

	/** Local page ids by path, for all synced notes. */
	async ids(): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		for (const file of this.vault.listFiles()) {
			const id = readPageId(await this.vault.read(file.path));
			if (id !== null) out.set(file.path, id);
		}
		return out;
	}

	/** The collective is renamed on the server (what another user does in the web app: the Circles API owns the name). */
	async renameCollectiveOnServer(collective: Collective, name: string): Promise<void> {
		await this.clients.collectives.renameCollective(collective.circleId, name);
	}

	paths(prefix = ''): string[] {
		return this.vault.listFiles().map((file) => file.path).filter((path) => path.startsWith(prefix)).sort();
	}

	count(method: string, part: string, since = 0): number {
		return this.requests.slice(since).filter((req) => req.method === method && decodeURIComponent(req.url).includes(part)).length;
	}
}

/** A fresh collective with a landing page and the given page titles below it; trashed again by `cleanup`. */
export class CollectiveFixture {
	readonly created: Collective[] = [];

	constructor(private readonly clients: ApiClients) {}

	async collective(prefix: string): Promise<{ collective: Collective; landing: PageInfo; name: string }> {
		const name = `${prefix} ${Date.now().toString(36)}`;
		const collective = await this.clients.collectives.createCollective(name);
		this.created.push(collective);
		const landing = required(
			(await this.clients.collectives.listPages(collective.id)).find((p) => p.parentId === 0),
			'landing page',
		);
		return { collective, landing, name };
	}

	/** Creates a page and writes its text through WebDAV. */
	async page(collective: Collective, parent: PageInfo, title: string, text: string): Promise<PageInfo> {
		const created = await this.clients.collectives.createPage(collective.id, parent.id, title);
		const path = (await this.clients.collectives.getPage(collective.id, created.id));
		const file = await this.clients.webdav.get(`${path.collectivePath}/${path.filePath === '' ? '' : path.filePath + '/'}${path.fileName}`);
		await this.clients.webdav.put(`${path.collectivePath}/${path.filePath === '' ? '' : path.filePath + '/'}${path.fileName}`, text, { ifMatch: file.etag });
		return this.clients.collectives.getPage(collective.id, created.id);
	}

	async cleanup(): Promise<void> {
		const failed: string[] = [];
		for (const collective of this.created) {
			try {
				await this.clients.collectives.trashCollective(collective.id);
			} catch (err) {
				// Already in the trash (the test trashed it): nothing left to clean up.
				if (!(err instanceof NotFoundError) && !(err instanceof ForbiddenError)) failed.push(collective.name);
			}
		}
		if (failed.length > 0) throw new Error(`Aufräumen fehlgeschlagen: ${failed.join(', ')} nicht in den Papierkorb verschoben`);
	}
}
