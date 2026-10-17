import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiClients, type ApiClients } from '../../src/api/clients';
import type { HttpClientOptions, HttpRequest, RequestFn } from '../../src/api/http';
import type { Collective, PageInfo } from '../../src/api/types';
import { createTranslator } from '../../src/i18n';
import { readPageId, toRemote } from '../../src/mapping/frontmatter';
import { remotePagePath, sanitizeName } from '../../src/mapping/paths';
import { runSync, type SyncRunDeps, type SyncRunOutcome } from '../../src/sync/syncRun';
import { emptyResult } from '../../src/sync/types';
import type { SyncResult } from '../../src/sync/types';
import { StateStore, type StateFile } from '../../src/sync/stateStore';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';
import { fetchRequest, loadTestServerEnv, type TestServerEnv } from './helpers';

/** Request as recorded by the test wrapper. Headers are not recorded, so no credentials end up in test output. */
interface RecordedRequest {
	method: string;
	url: string;
}

interface Fixture {
	/** Collective name; equal to its sanitized form because it contains no forbidden characters. */
	name: string;
	landing: PageInfo;
	chapter: PageInfo;
	section: PageInfo;
	note: PageInfo;
}

const NOTE_CONTENT = 'Hallo Pull';
const NOTE_CONTENT_CHANGED = 'Hallo geändert';

let env: TestServerEnv;
let clients: ApiClients;
let createdCollective: Collective | undefined;
let fixture: Fixture | undefined;
let vault: MemoryVault;
let stateFile: MemoryStateFile;
const requests: RecordedRequest[] = [];

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
	return fetchRequest(req);
};

function makeDeps(): SyncRunDeps {
	return {
		settings: {
			serverUrl: env.baseUrl,
			username: env.user,
			conflictStrategy: 'conflictFile',
			newFolderBehaviour: 'createCollective',
			localDeleteBehaviour: 'ask',
			remoteDeleteBehaviour: 'obsidianTrash',
		},
		readPassword: async () => env.password,
		request: recordingRequest,
		vault,
		stateStore: new StateStore(stateFile, new Logger()),
		confirm: async () => new Map(),
		confirmInitialSync: async () => {
			throw new Error('confirmInitialSync must not be called: the vault is empty in the first run');
		},
		dirty: () => new Set(),
		t: createTranslator('en'),
		log: new Logger(),
	};
}

/** Runs one pull and returns its counters; fails if the run did not end with kind 'done'. */
async function pull(): Promise<SyncResult> {
	const outcome: SyncRunOutcome = await runSync(makeDeps());
	if (outcome.kind !== 'done') throw new Error(`Pull ended with "${outcome.kind}" instead of "done"`);
	return outcome.result;
}

async function readLocal(path: string): Promise<string> {
	return vault.read(path);
}

/** Path → content of every file in the vault. */
async function snapshot(): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const file of vault.listFiles()) out.set(file.path, await vault.read(file.path));
	return out;
}

/** URLs of all WebDAV GET requests recorded from index `start` on. */
function davGetsSince(start: number): string[] {
	return requests
		.slice(start)
		.filter((req) => req.method === 'GET' && req.url.includes('/remote.php/dav/'))
		.map((req) => req.url);
}

beforeAll(async () => {
	env = loadTestServerEnv();
	if (!(await isServerInstalled(env.baseUrl))) throw new Error('Testserver läuft nicht: npm run nc:up ausführen');

	vault = new MemoryVault();
	stateFile = new MemoryStateFile();

	const userId = await createApiClients(clientOptions(env.password)).collectives.getCurrentUserId();
	clients = createApiClients(clientOptions(env.password), userId);

	const name = 'ONC Pull ' + Date.now();
	const collective = await clients.collectives.createCollective(name);
	createdCollective = collective;

	const landing = (await clients.collectives.listPages(collective.id)).find(
		(p) => p.parentId === 0 && p.fileName === 'Readme.md',
	);
	if (!landing) throw new Error('landing page (Readme.md at collective root) not found');
	const chapter = await clients.collectives.createPage(collective.id, landing.id, 'Kapitel');
	const section = await clients.collectives.createPage(collective.id, chapter.id, 'Abschnitt');
	const note = await clients.collectives.createPage(collective.id, landing.id, 'Notiz');

	const notePath = remotePagePath(note);
	const current = await clients.webdav.get(notePath);
	await waitPastSecondBoundary();
	await clients.webdav.put(notePath, NOTE_CONTENT, { ifMatch: current.etag });
	// The first pull must see the write as confirmed (its Last-Modified is in an earlier second than the response Date).
	await waitPastSecondBoundary();

	fixture = { name, landing, chapter, section, note };
});

afterAll(async () => {
	if (!createdCollective) return;
	try {
		await clients.collectives.trashCollective(createdCollective.id);
	} catch {
		throw new Error(`Aufräumen fehlgeschlagen: Collective "${createdCollective.name}" wurde nicht in den Papierkorb verschoben`);
	}
});

describe('Pull against the local Docker Nextcloud with an in-memory vault', () => {
	it('creates one top-level folder per collective with its landing page, and the test pages at the expected paths', async () => {
		const f = required(fixture, 'fixture');

		const result = await pull();

		expect(result.failed).toBe(0);
		const collectives = await clients.collectives.listCollectives();
		for (const c of collectives) {
			const folder = sanitizeName(c.name);
			expect(vault.exists(folder), `folder "${folder}" missing`).toBe(true);
			expect(vault.exists(`${folder}/${folder}.md`), `landing page of "${folder}" missing`).toBe(true);
		}

		const expectedFiles = [
			`${f.name}/${f.name}.md`,
			`${f.name}/Kapitel/Kapitel.md`,
			`${f.name}/Kapitel/Abschnitt.md`,
			`${f.name}/Notiz.md`,
		];
		const ourFiles = vault
			.listFiles()
			.map((file) => file.path)
			.filter((path) => path.startsWith(f.name + '/'));
		expect(ourFiles.sort()).toEqual([...expectedFiles].sort());

		expect(readPageId(await readLocal(`${f.name}/${f.name}.md`))).toBe(f.landing.id);
		expect(readPageId(await readLocal(`${f.name}/Kapitel/Kapitel.md`))).toBe(f.chapter.id);
		expect(readPageId(await readLocal(`${f.name}/Kapitel/Abschnitt.md`))).toBe(f.section.id);
		expect(readPageId(await readLocal(`${f.name}/Notiz.md`))).toBe(f.note.id);
		expect(toRemote(await readLocal(`${f.name}/Notiz.md`))).toBe(NOTE_CONTENT);
	});

	it('writes nothing to the vault or the state file and fetches no WebDAV file on a second run without remote changes', async () => {
		const f = required(fixture, 'fixture');
		const writesBefore = vault.writes;
		const stateWritesBefore = stateFile.writes;
		const requestsBefore = requests.length;

		const result = await pull();

		expect(vault.writes).toBe(writesBefore);
		expect(stateFile.writes).toBe(stateWritesBefore);
		expect(result).toEqual(emptyResult());
		expect(davGetsSince(requestsBefore)).toEqual([]);
		expect(readPageId(await readLocal(`${f.name}/Notiz.md`))).toBe(f.note.id);
	});

	it('fetches a remote change of the leaf page, updates only that file and keeps its nc_page_id', async () => {
		const f = required(fixture, 'fixture');
		const notePath = remotePagePath(f.note);
		const localNotePath = `${f.name}/Notiz.md`;
		const before = await snapshot();

		await waitPastSecondBoundary();
		const current = await clients.webdav.get(notePath);
		await clients.webdav.put(notePath, NOTE_CONTENT_CHANGED, { ifMatch: current.etag });
		await waitPastSecondBoundary();

		const result = await pull();

		expect(result.updated).toBe(1);
		const after = await snapshot();
		const noteAfter = required(after.get(localNotePath), 'local note after the pull');
		expect(toRemote(noteAfter)).toBe(NOTE_CONTENT_CHANGED);
		expect(readPageId(noteAfter)).toBe(f.note.id);
		expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
		for (const [path, content] of before) {
			if (path === localNotePath) continue;
			expect(after.get(path), `unexpected change in ${path}`).toBe(content);
		}
	});
});
