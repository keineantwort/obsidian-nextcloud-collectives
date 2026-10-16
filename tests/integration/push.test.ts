import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiClients, type ApiClients } from '../../src/api/clients';
import type { HttpClientOptions, HttpRequest, RequestFn } from '../../src/api/http';
import type { Collective, PageInfo } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import { readPageId, toRemote } from '../../src/mapping/frontmatter';
import { remotePagePath } from '../../src/mapping/paths';
import { applyResolution } from '../../src/sync/conflicts';
import { DirtyQueue } from '../../src/sync/dirtyQueue';
import { runSync, type SyncRunDeps, type SyncRunOutcome } from '../../src/sync/syncRun';
import { StateStore, type StateFile } from '../../src/sync/stateStore';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';
import { fetchRequest, loadTestServerEnv, type TestServerEnv } from './helpers';

/** Request as recorded by the test wrapper. Headers are not recorded, so no credentials end up in test output. */
interface RecordedRequest {
	method: string;
	url: string;
}

type DoneOutcome = Extract<SyncRunOutcome, { kind: 'done' }>;

interface Fixture {
	/** Collective name; equal to its sanitized form because it contains no forbidden characters. */
	name: string;
	landing: PageInfo;
	note: PageInfo;
}

const NOTE_CONTENT = 'Hallo Push';
const LOCAL_EDIT = 'Lokal geändert';
const CONFLICT_LOCAL = 'Lokal im Konflikt';
const CONFLICT_REMOTE = 'Entfernt im Konflikt';
const LOCAL_AFTER_CONFLICT = 'Lokal nach Konflikt';
const REMOTE_DURING_PUSH = 'Entfernt während des Pushes';

let env: TestServerEnv;
let clients: ApiClients;
let createdCollective: Collective | undefined;
let fixture: Fixture | undefined;
let vault: MemoryVault;
let stateFile: MemoryStateFile;
let queue: DirtyQueue;
const requests: RecordedRequest[] = [];
/** One-shot hook: runs right before the plugin's next PUT to the note, after the request was recorded. */
let beforePluginPut: (() => Promise<void>) | null = null;

/** Returns the value or fails with a message naming the earlier step that should have set it. */
function required<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`${what} is not set: an earlier step failed`);
	return value;
}

function clientOptions(appPassword: string): HttpClientOptions {
	return {
		baseUrl: env.baseUrl,
		username: env.user,
		appPassword,
		request: fetchRequest,
		sleep: () => Promise.resolve(),
	};
}

/**
 * Nextcloud derives ETags from the mtime in whole seconds: a write in the same second as the previous one keeps
 * the old ETag (docs/api-notes.md §5). Waiting past the second boundary makes the ETag change observable.
 */
function waitPastSecondBoundary(): Promise<void> {
	return delay(1100);
}

async function isServerInstalled(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/status.php`);
		const body = (await res.json()) as { installed?: unknown };
		return body.installed === true;
	} catch {
		return false;
	}
}

/** In-memory StateFile that counts writes. `text` is what is stored (null = no file). */
class MemoryStateFile implements StateFile {
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

/** Wrapper around the real fetch that records method and URL of every request. */
const recordingRequest: RequestFn = async (req: HttpRequest) => {
	requests.push({ method: req.method, url: req.url });
	if (req.method === 'PUT' && beforePluginPut !== null && isPutToNote(req.url)) {
		const hook = beforePluginPut;
		beforePluginPut = null;
		await hook();
	}
	return fetchRequest(req);
};

function makeDeps(): SyncRunDeps {
	return {
		settings: { serverUrl: env.baseUrl, username: env.user, conflictStrategy: 'conflictFile' },
		readPassword: async () => env.password,
		request: recordingRequest,
		vault,
		stateStore: stateStoreOf(),
		confirmInitialSync: async () => {
			throw new Error('confirmInitialSync must not be called: the vault is empty in the first run');
		},
		dirty: () => queue.drain(),
		t: createTranslator('en'),
		log: new Logger(),
		sleep: (ms: number) => delay(ms),
	};
}

function stateStoreOf(): StateStore {
	return new StateStore(stateFile, new Logger());
}

/** Runs one sync and returns its outcome; fails if the run did not end with kind 'done'. */
async function sync(): Promise<DoneOutcome> {
	const outcome: SyncRunOutcome = await runSync(makeDeps());
	if (outcome.kind !== 'done') throw new Error(`Sync ended with "${outcome.kind}" instead of "done"`);
	return outcome;
}

/** Simulates the user editing a local file: the new text is in the vault and the file is reported as modified. */
function editLocal(path: string, content: string): void {
	vault.userEdit(path, content);
	queue.noteModified(path);
}

/**
 * Replaces the body below the frontmatter block and keeps every line of the block (the nc_* fields included).
 * The body starts after the closing "---" of the block, separated by one empty line.
 */
function withBody(local: string, body: string): string {
	const close = local.indexOf('\n---', 3);
	if (!local.startsWith('---\n') || close < 0) throw new Error('local note has no frontmatter block');
	const head = local.slice(0, close + '\n---'.length);
	return `${head}\n\n${body}\n`;
}

/** Path of a WebDAV URL, decoded, e.g. '/remote.php/dav/files/alice/.Collectives/…/Notiz.md'. */
function davPathOf(url: string): string {
	return decodeURIComponent(new URL(url).pathname);
}

/** True for a request URL that addresses the note's Markdown file on WebDAV. */
function isPutToNote(url: string): boolean {
	const note = required(fixture, 'fixture').note;
	return davPathOf(url).endsWith('/' + remotePagePath(note));
}

/** Number of PUT requests to the note's WebDAV URL recorded from index `start` on. */
function notePutsSince(start: number): number {
	return requests.slice(start).filter((req) => req.method === 'PUT' && isPutToNote(req.url)).length;
}

/** WebDAV GET requests recorded from index `start` on. */
function davGetsSince(start: number): string[] {
	return requests
		.slice(start)
		.filter((req) => req.method === 'GET' && req.url.includes('/remote.php/dav/'))
		.map((req) => req.url);
}

/** Conflict copies of the note: files next to it whose name contains the conflict label. */
function conflictCopies(): string[] {
	const f = required(fixture, 'fixture');
	return vault
		.listFiles()
		.map((file) => file.path)
		.filter((path) => path.startsWith(`${f.name}/`) && path.includes('(Conflict '));
}

beforeAll(async () => {
	env = loadTestServerEnv();
	if (!(await isServerInstalled(env.baseUrl))) throw new Error('Testserver läuft nicht: npm run nc:up ausführen');

	vault = new MemoryVault();
	stateFile = new MemoryStateFile();
	queue = new DirtyQueue();

	const userId = await createApiClients(clientOptions(env.password)).collectives.getCurrentUserId();
	clients = createApiClients(clientOptions(env.password), userId);

	const name = 'ONC Push ' + Date.now();
	const collective = await clients.collectives.createCollective(name);
	createdCollective = collective;

	const landing = (await clients.collectives.listPages(collective.id)).find(
		(p) => p.parentId === 0 && p.fileName === 'Readme.md',
	);
	if (!landing) throw new Error('landing page (Readme.md at collective root) not found');
	const note = await clients.collectives.createPage(collective.id, landing.id, 'Notiz');

	const notePath = remotePagePath(note);
	const current = await clients.webdav.get(notePath);
	await waitPastSecondBoundary();
	await clients.webdav.put(notePath, NOTE_CONTENT, { ifMatch: current.etag });
	await waitPastSecondBoundary();

	fixture = { name, landing, note };
});

afterAll(async () => {
	if (!createdCollective) return;
	try {
		await clients.collectives.trashCollective(createdCollective.id);
	} catch {
		throw new Error(`Aufräumen fehlgeschlagen: Collective "${createdCollective.name}" wurde nicht in den Papierkorb verschoben`);
	}
});

describe('Push and conflicts against the local Docker Nextcloud with an in-memory vault', () => {
	it('initial pull creates the local note with the remote text', async () => {
		const f = required(fixture, 'fixture');

		const outcome = await sync();

		expect(outcome.result.failed).toBe(0);
		const localNotePath = `${f.name}/Notiz.md`;
		expect(vault.exists(localNotePath)).toBe(true);
		const local = await vault.read(localNotePath);
		expect(readPageId(local)).toBe(f.note.id);
		expect(toRemote(local)).toBe(NOTE_CONTENT);

		await waitPastSecondBoundary();
	});

	it('a local edit lands in Collectives', async () => {
		const f = required(fixture, 'fixture');
		const localNotePath = `${f.name}/Notiz.md`;
		const requestsBefore = requests.length;

		editLocal(localNotePath, withBody(await vault.read(localNotePath), LOCAL_EDIT));
		const outcome = await sync();

		expect(outcome.result.pushed).toBe(1);
		expect(outcome.result.failed).toBe(0);
		const edited = await vault.read(localNotePath);
		expect(toRemote(edited)).toBe(LOCAL_EDIT);
		const remote = await clients.webdav.get(remotePagePath(f.note));
		expect(remote.content).toBe(toRemote(edited));
		expect(notePutsSince(requestsBefore)).toBe(1);
	});

	it('no ping-pong after a push: the next runs upload nothing and write nothing', async () => {
		const f = required(fixture, 'fixture');
		const localNotePath = `${f.name}/Notiz.md`;

		await waitPastSecondBoundary();
		const writesBeforeFirst = vault.writes;
		const requestsBeforeFirst = requests.length;

		// The first run GETs the page once to confirm the ETag of its own write, then changes nothing.
		const first = await sync();
		expect(first.result.pushed).toBe(0);
		expect(notePutsSince(requestsBeforeFirst)).toBe(0);
		expect(davGetsSince(requestsBeforeFirst).length).toBeLessThanOrEqual(1);
		expect(vault.writes).toBe(writesBeforeFirst);

		const writesBeforeSecond = vault.writes;
		const stateWritesBeforeSecond = stateFile.writes;
		const requestsBeforeSecond = requests.length;

		const second = await sync();
		expect(second.result.pushed).toBe(0);
		expect(notePutsSince(requestsBeforeSecond)).toBe(0);
		expect(davGetsSince(requestsBeforeSecond)).toEqual([]);
		expect(vault.writes).toBe(writesBeforeSecond);
		expect(stateFile.writes).toBe(stateWritesBeforeSecond);
		expect(toRemote(await vault.read(localNotePath))).toBe(LOCAL_EDIT);
	});

	it('a concurrent change creates a conflict instead of data loss', async () => {
		const f = required(fixture, 'fixture');
		const notePath = remotePagePath(f.note);
		const localNotePath = `${f.name}/Notiz.md`;

		editLocal(localNotePath, withBody(await vault.read(localNotePath), CONFLICT_LOCAL));
		await waitPastSecondBoundary();
		const current = await clients.webdav.get(notePath);
		await clients.webdav.put(notePath, CONFLICT_REMOTE, { ifMatch: current.etag });
		await waitPastSecondBoundary();

		const outcome = await sync();

		expect(outcome.result.conflicts).toBe(1);
		expect(outcome.result.pushed).toBe(0);
		expect(outcome.openConflicts).toBe(1);

		expect((await clients.webdav.get(notePath)).content).toBe(CONFLICT_REMOTE);
		expect(toRemote(await vault.read(localNotePath))).toBe(CONFLICT_LOCAL);

		const copies = conflictCopies();
		expect(copies).toHaveLength(1);
		const copy = required(copies[0], 'conflict copy');
		expect(copy.startsWith(`${f.name}/Notiz (Conflict `)).toBe(true);
		expect(toRemote(await vault.read(copy))).toBe(CONFLICT_REMOTE);

		// A page in conflict is not pushed until the conflict is resolved.
		const requestsBefore = requests.length;
		const further = await sync();
		expect(further.openConflicts).toBe(1);
		expect(notePutsSince(requestsBefore)).toBe(0);
		expect((await clients.webdav.get(notePath)).content).toBe(CONFLICT_REMOTE);
	});

	it('412 when the server changed after the listing: the remote text is kept and the local text becomes a conflict copy', async () => {
		const f = required(fixture, 'fixture');
		const notePath = remotePagePath(f.note);
		const localNotePath = `${f.name}/Notiz.md`;

		// Resolve the open conflict of the previous test: keep the local text, which then gets pushed.
		const store = stateStoreOf();
		const state = required(await store.load(), 'sync state');
		const resolutionVault = {
			read: (path: string) => vault.read(path),
			process: (path: string, fn: (current: string) => string) => vault.process(path, fn),
			exists: (path: string) => vault.exists(path),
			trash: (path: string) => vault.remove(path),
		};
		const applied = await applyResolution({ vault: resolutionVault, state, log: new Logger() }, f.note.id, 'keepLocal');
		expect(applied).toBe(true);
		await store.save(state);
		expect(conflictCopies()).toHaveLength(0);

		const pushed = await sync();
		expect(pushed.result.pushed).toBe(1);
		expect((await clients.webdav.get(notePath)).content).toBe(CONFLICT_LOCAL);

		// Local edit; a remote write lands right before the plugin's PUT, so the If-Match check must fail.
		editLocal(localNotePath, withBody(await vault.read(localNotePath), LOCAL_AFTER_CONFLICT));
		beforePluginPut = async () => {
			const cur = await clients.webdav.get(notePath);
			await waitPastSecondBoundary();
			await clients.webdav.put(notePath, REMOTE_DURING_PUSH, { ifMatch: cur.etag });
		};
		const requestsBefore = requests.length;

		const outcome = await sync();

		expect(beforePluginPut).toBeNull();
		expect(notePutsSince(requestsBefore)).toBe(1);
		expect(outcome.result.pushed).toBe(0);
		expect(outcome.result.conflicts).toBe(1);
		expect((await clients.webdav.get(notePath)).content).toBe(REMOTE_DURING_PUSH);
		expect(toRemote(await vault.read(localNotePath))).toBe(LOCAL_AFTER_CONFLICT);

		const copies = conflictCopies();
		expect(copies).toHaveLength(1);
		expect(toRemote(await vault.read(required(copies[0], 'conflict copy')))).toBe(REMOTE_DURING_PUSH);
	});
});
