import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';
import { toLocal, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { readPageId } from '../../src/mapping/frontmatter';
import { StateStore } from '../../src/sync/stateStore';
import type { StateFile } from '../../src/sync/stateStore';
import { emptyState, serializeSyncState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { runSync } from '../../src/sync/syncRun';
import type { SyncRunDeps } from '../../src/sync/syncRun';
import { createTranslator } from '../../src/i18n';
import { ConfigError } from '../../src/util/errors';
import { metaHash } from '../../src/util/hash';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';

const BASE = 'https://cloud.example.com';
const OCS = BASE + '/ocs/v2.php/apps/collectives/api/v1.0';
const DAV_ROOT = BASE + '/remote.php/dav/files/alice-id/';
const NOW = new Date(2026, 9, 16, 14, 30);
const PASSWORD = 'pw-SECRET-123';

// ---------------------------------------------------------------------------
// Fixtures (M0): page list and tags of collective 1 'Handbuch'; collectives filtered to Handbuch.
// ---------------------------------------------------------------------------

interface FixtureFile { response: { ocs: { data: Record<string, unknown> } } }

function loadData(name: string): Record<string, unknown> {
	const file = JSON.parse(readFileSync(new URL(`../fixtures/m0/${name}`, import.meta.url), 'utf8')) as FixtureFile;
	return file.response.ocs.data;
}

const HANDBUCH_ONLY = (() => {
	const data = loadData('collectives-list.json');
	const all = data['collectives'] as { id: number }[];
	return { collectives: all.filter((c) => c.id === 1) };
})();
const PAGES_FIXTURE = loadData('pages-list-final.json')['pages'] as Record<string, unknown>[];
const TAGS_FIXTURE = loadData('tags-list.json');

/** Remote Markdown file per page, keyed by user-relative WebDAV path. */
const DAV_FILES: { path: string; title: string; id: number }[] = [
	{ path: '.Collectives/Handbuch/Readme.md', title: 'Landing page', id: 92 },
	{ path: '.Collectives/Handbuch/Per WebDAV.md', title: 'Per WebDAV', id: 102 },
	{ path: '.Collectives/Handbuch/Prozesse/Readme.md', title: 'Prozesse', id: 98 },
	{ path: '.Collectives/Handbuch/Prozesse/Umbenannt.md', title: 'Umbenannt', id: 101 },
	{ path: '.Collectives/Handbuch/Onboarding/Readme.md', title: 'Onboarding', id: 97 },
	{ path: '.Collectives/Handbuch/Onboarding/Erster Tag.md', title: 'Erster Tag', id: 114 },
];

/** Local path and nc_page_id expected after a first sync. */
const EXPECTED_FILES: { path: string; id: number }[] = [
	{ path: 'Handbuch/Handbuch.md', id: 92 },
	{ path: 'Handbuch/Per WebDAV.md', id: 102 },
	{ path: 'Handbuch/Prozesse/Prozesse.md', id: 98 },
	{ path: 'Handbuch/Prozesse/Umbenannt.md', id: 101 },
	{ path: 'Handbuch/Onboarding/Onboarding.md', id: 97 },
	{ path: 'Handbuch/Onboarding/Erster Tag.md', id: 114 },
];

function remoteText(title: string): string {
	return `# ${title}\n\nInhalt von ${title}\n`;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Response headers of a GET whose ETag can be trusted (the file was written in an earlier second than the response). */
const CONFIRMED_HEADERS = { 'Last-Modified': 'Thu, 15 Oct 2026 10:00:00 GMT', Date: 'Fri, 16 Oct 2026 12:30:00 GMT' };
const PRECONDITION_FAILED: HttpResponse = { status: 412, headers: {}, text: '' };

function ocs(data: unknown): HttpResponse {
	return { status: 200, headers: {}, text: JSON.stringify({ ocs: { meta: {}, data } }) };
}

const NOT_FOUND: HttpResponse = { status: 404, headers: {}, text: '' };

/**
 * Fake Nextcloud behind the RequestFn: Collectives OCS endpoints for collective 1, the user endpoint with the
 * user ID 'alice-id' (login name 'alice'), and WebDAV GET under /remote.php/dav/files/alice-id/.
 * Tests may change `pages` and `davFiles` between runs.
 */
/** A WebDAV file of the fake server. Headers default to CONFIRMED_HEADERS, so the ETag of a GET is trusted. */
interface DavFileEntry { content: string; etag: string; lastModified?: string; date?: string; }

class FakeNextcloud {
	readonly calls: HttpRequest[] = [];
	readonly pages: Record<string, unknown>[] = structuredClone(PAGES_FIXTURE);
	readonly davFiles = new Map<string, DavFileEntry>();
	private putCount = 0;

	readonly request: RequestFn = async (req) => {
		this.calls.push(req);
		return this.answer(req);
	};

	constructor() {
		for (const file of DAV_FILES) this.davFiles.set(file.path, { content: remoteText(file.title), etag: `"etag-${file.id}"` });
	}

	davRequests(since = 0): HttpRequest[] {
		return this.calls.slice(since).filter((req) => req.url.startsWith(BASE + '/remote.php/dav/'));
	}

	private answer(req: HttpRequest): HttpResponse {
		if (req.url === BASE + '/ocs/v2.php/cloud/user') return ocs({ id: 'alice-id' });
		if (req.url === OCS + '/collectives') return ocs(HANDBUCH_ONLY);
		if (req.url === OCS + '/collectives/1/pages') return ocs({ pages: this.pages });
		if (req.url === OCS + '/collectives/1/tags') return ocs(TAGS_FIXTURE);
		if (req.url.startsWith(DAV_ROOT)) return this.dav(req);
		return NOT_FOUND;
	}

	private dav(req: HttpRequest): HttpResponse {
		const key = req.url.slice(DAV_ROOT.length).split('/').map((segment) => decodeURIComponent(segment)).join('/');
		if (req.method === 'PUT') return this.put(req, key);
		if (req.method !== 'GET') return { status: 405, headers: {}, text: '' };
		const file = this.davFiles.get(key);
		if (file === undefined) return NOT_FOUND;
		const headers = {
			ETag: file.etag,
			'Last-Modified': file.lastModified ?? CONFIRMED_HEADERS['Last-Modified'],
			Date: file.date ?? CONFIRMED_HEADERS.Date,
		};
		return { status: 200, headers, text: file.content };
	}

	/** PUT with If-Match: 412 unless the header equals the stored ETag. Stores the body under a new ETag. */
	private put(req: HttpRequest, key: string): HttpResponse {
		const file = this.davFiles.get(key);
		if (file === undefined) return NOT_FOUND;
		if (req.headers['If-Match'] !== file.etag) return PRECONDITION_FAILED;
		this.putCount++;
		const etag = `"etag-put-${this.putCount}"`;
		this.davFiles.set(key, { content: req.body ?? '', etag });
		return { status: 204, headers: { ETag: etag }, text: '' };
	}
}

/** In-memory StateFile that counts writes. `text` is what is stored (null = no file). */
class FakeStateFile implements StateFile {
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

function makeDeps(server: FakeNextcloud, vault: MemoryVault, stateFile: FakeStateFile, over: Partial<SyncRunDeps> = {}): SyncRunDeps {
	return {
		settings: { serverUrl: BASE, username: 'alice', conflictStrategy: 'conflictFile' },
		readPassword: async () => PASSWORD,
		request: server.request,
		vault,
		stateStore: new StateStore(stateFile),
		confirmInitialSync: vi.fn(async () => true),
		t: createTranslator('de'),
		log: new Logger(),
		now: () => NOW,
		dirty: () => new Set<string>(),
		sleep: async () => undefined,
		...over,
	};
}

function metaOf(id: number): NcMeta {
	return { pageId: asPageId(id), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] };
}

const ZERO_RESULT = { created: 0, updated: 0, pushed: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0 };

/** Raw page entry as the Collectives API returns it, based on the fixture entry of page 102 (child of the landing page 92). */
function rawPage(id: number, title: string, fileName: string, parentId: number): Record<string, unknown> {
	const base = PAGES_FIXTURE.find((p) => p['id'] === 102);
	if (base === undefined) throw new Error('fixture has no page 102');
	return { ...base, id, slug: `seite-${id}`, title, fileName, parentId, filePath: '', timestamp: 1792138978, size: 20 };
}

/** The raw entry of a page the test has added or changed on the fake server. */
function serverPage(server: FakeNextcloud, id: number): Record<string, unknown> {
	const page = server.pages.find((p) => p['id'] === id);
	if (page === undefined) throw new Error(`fake server has no page ${id}`);
	return page;
}

/** State as the last run stored it, parsed from the fake state file. */
function storedState(stateFile: FakeStateFile): SyncState {
	return JSON.parse(stateFile.text ?? 'null') as SyncState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSync: first sync into an empty vault', () => {
	it('creates each remote page as a Markdown file with its nc_page_id and stores the state', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();

		const outcome = await runSync(makeDeps(server, vault, stateFile));

		expect(outcome).toMatchObject({
			kind: 'done',
			result: { created: 6, updated: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0 },
			skips: [],
		});
		for (const expected of EXPECTED_FILES) {
			const text = await vault.read(expected.path);
			expect(readPageId(text)).toBe(expected.id);
		}
		const saved = JSON.parse(stateFile.text ?? 'null') as SyncState;
		expect(Object.keys(saved.pages).map(Number).sort((a, b) => a - b)).toEqual([92, 97, 98, 101, 102, 114]);
	});

	it('stores the metadata hash of the remote title for the landing page, whose nc_title stays absent', async () => {
		const stateFile = new FakeStateFile();

		await runSync(makeDeps(new FakeNextcloud(), new MemoryVault(), stateFile));

		expect(storedState(stateFile).pages['92']?.metaHash).toBe(await metaHash('Landing page', null, []));
	});

	it('uses the Nextcloud user ID in every WebDAV path, not the login name', async () => {
		const server = new FakeNextcloud();

		await runSync(makeDeps(server, new MemoryVault(), new FakeStateFile()));

		const dav = server.davRequests();
		expect(dav).toHaveLength(DAV_FILES.length);
		expect(dav.every((req) => req.url.startsWith(DAV_ROOT))).toBe(true);
		expect(dav.some((req) => req.url.includes('/remote.php/dav/files/alice/'))).toBe(false);
	});

	it('does not ask for the initial-sync confirmation when the vault is empty', async () => {
		const confirmInitialSync = vi.fn(async () => true);

		await runSync(makeDeps(new FakeNextcloud(), new MemoryVault(), new FakeStateFile(), { confirmInitialSync }));

		expect(confirmInitialSync).not.toHaveBeenCalled();
	});
});

describe('runSync: second run', () => {
	it('writes no file and no state and makes no WebDAV request when the remote is unchanged', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		await runSync(deps);
		const vaultWrites = vault.writes;
		const stateWrites = stateFile.writes;
		const callsBefore = server.calls.length;

		const outcome = await runSync(deps);

		expect(outcome).toEqual({ kind: 'done', result: ZERO_RESULT, skips: [], openConflicts: 0 });
		expect(vault.writes).toBe(vaultWrites);
		expect(stateFile.writes).toBe(stateWrites);
		expect(server.davRequests(callsBefore)).toEqual([]);
	});

	it('updates only the one file whose remote content changed between the runs', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		await runSync(deps);
		const changed = server.pages.find((p) => p['id'] === 102);
		if (changed === undefined) throw new Error('fixture has no page 102');
		changed['timestamp'] = 1792139000;
		changed['size'] = 40;
		const newText = '# Per WebDAV\n\nNeuer Inhalt\n';
		server.davFiles.set('.Collectives/Handbuch/Per WebDAV.md', { content: newText, etag: '"etag-102-v2"' });
		const writesBefore = vault.writes;

		const outcome = await runSync(deps);

		expect(outcome).toMatchObject({
			kind: 'done',
			result: { created: 0, updated: 1, metaUpdated: 0, conflicts: 0, failed: 0 },
		});
		expect(vault.writes - writesBefore).toBe(1);
		expect(await vault.read('Handbuch/Per WebDAV.md')).toBe(toLocal(newText, metaOf(102)));
	});
});

describe('runSync: initial sync into a non-empty vault', () => {
	it('asks for confirmation and writes nothing when the user cancels', async () => {
		const vault = new MemoryVault();
		vault.seed('Notizen/a.md', 'Meine Notiz\n');
		const stateFile = new FakeStateFile();
		const confirmInitialSync = vi.fn(async () => false);

		const outcome = await runSync(makeDeps(new FakeNextcloud(), vault, stateFile, { confirmInitialSync }));

		expect(confirmInitialSync).toHaveBeenCalledTimes(1);
		expect(outcome).toEqual({ kind: 'cancelled' });
		expect(vault.writes).toBe(0);
		expect(stateFile.writes).toBe(0);
		expect(stateFile.text).toBeNull();
	});

	it('merges the remote pages when the user confirms and leaves the existing note unchanged', async () => {
		const vault = new MemoryVault();
		vault.seed('Notizen/a.md', 'Meine Notiz\n');
		const confirmInitialSync = vi.fn(async () => true);

		const outcome = await runSync(makeDeps(new FakeNextcloud(), vault, new FakeStateFile(), { confirmInitialSync }));

		expect(confirmInitialSync).toHaveBeenCalledTimes(1);
		expect(outcome).toMatchObject({ kind: 'done', result: { created: 6, failed: 0 } });
		expect(await vault.read('Notizen/a.md')).toBe('Meine Notiz\n');
		for (const expected of EXPECTED_FILES) expect(vault.exists(expected.path)).toBe(true);
	});
});

describe('runSync: refusals and errors', () => {
	it('returns serverMismatch and writes nothing when the stored state belongs to another server', async () => {
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const other: SyncState = {
			...emptyState('https://other.example.com', 'alice-id'),
			pages: {
				'92': {
					pageId: asPageId(92),
					collectiveId: asCollectiveId(1),
					localPath: 'Handbuch/Handbuch.md',
					localMtime: 1,
					remoteFilePath: '',
					remoteFileName: 'Readme.md',
					parentId: asPageId(0),
					remoteEtag: '"x"',
					remoteMtime: 1,
					remoteSize: 1,
					baseHash: 'b',
					metaHash: 'm',
					status: 'synced',
					conflictPath: null,
					attachments: [{ id: asAttachmentId(1), name: 'a.png', etag: 'e', localPath: 'x' }],
					lastSyncedAt: 1,
				} satisfies PageState,
			},
			tags: { '1': [{ id: asTagId(1), name: 'Projekt', color: '0082c9' }] },
		};
		stateFile.text = serializeSyncState(other);
		const storedBefore = stateFile.text;

		const outcome = await runSync(makeDeps(new FakeNextcloud(), vault, stateFile));

		expect(outcome).toEqual({ kind: 'serverMismatch', stateServer: 'https://other.example.com' });
		expect(vault.writes).toBe(0);
		expect(stateFile.writes).toBe(0);
		expect(stateFile.text).toBe(storedBefore);
	});

	it('returns accountMismatch with the stored user and server and writes nothing when the state belongs to another account on the same server', async () => {
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		await runSync(makeDeps(new FakeNextcloud(), vault, stateFile));
		const parsed = JSON.parse(stateFile.text ?? '') as SyncState;
		stateFile.text = serializeSyncState({ ...parsed, user: 'bob-id' });
		const storedBefore = stateFile.text;
		const writesBefore = vault.writes;

		const outcome = await runSync(makeDeps(new FakeNextcloud(), vault, stateFile));

		expect(outcome).toEqual({ kind: 'accountMismatch', stateUser: 'bob-id', stateServer: BASE });
		expect(vault.writes).toBe(writesBefore);
		expect(stateFile.text).toBe(storedBefore);
	});

	it('rejects with ConfigError for appPassword when no app password is stored, before any request', async () => {
		const server = new FakeNextcloud();

		const err: unknown = await runSync(makeDeps(server, new MemoryVault(), new FakeStateFile(), { readPassword: async () => null })).then(
			() => null,
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'appPassword' });
		expect(server.calls).toEqual([]);
	});
});

describe('runSync: several runs over colliding, renamed and sibling pages', () => {
	it('keeps the nc_title of a remaining sibling whose sibling disappeared remotely, and writes nothing', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		server.pages.push(rawPage(200, 'Notes', 'Notes.md', 92), rawPage(201, 'Notes', 'Notes (2).md', 92));
		server.davFiles.set('.Collectives/Handbuch/Notes.md', { content: remoteText('Notes A'), etag: '"etag-200"' });
		server.davFiles.set('.Collectives/Handbuch/Notes (2).md', { content: remoteText('Notes B'), etag: '"etag-201"' });
		await runSync(deps);
		expect(await vault.read('Handbuch/Notes (2).md')).toContain('nc_title: "Notes"');

		server.pages.splice(server.pages.findIndex((p) => p['id'] === 200), 1);
		const writesBefore = vault.writes;

		const outcome = await runSync(deps);

		expect(outcome).toEqual({
			kind: 'done',
			result: ZERO_RESULT,
			skips: [{ reason: 'remoteDeleted', pageId: 200, collectiveId: 1 }],
			openConflicts: 0,
		});
		expect(vault.writes).toBe(writesBefore);
		expect(readPageId(await vault.read('Handbuch/Notes (2).md'))).toBe(201);
	});

	it('keeps the nc_page_id of a renamed page and gives a new page with its old title a suffixed name', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const deps = makeDeps(server, vault, new FakeStateFile());
		server.pages.push(rawPage(200, 'Notes', 'Notes.md', 92));
		server.davFiles.set('.Collectives/Handbuch/Notes.md', { content: remoteText('Notes'), etag: '"etag-200a"' });
		await runSync(deps);

		const renamed = serverPage(server, 200);
		renamed['title'] = 'Neu';
		renamed['fileName'] = 'Neu.md';
		renamed['timestamp'] = 1792139000;
		server.davFiles.set('.Collectives/Handbuch/Neu.md', { content: remoteText('Neu'), etag: '"etag-200b"' });
		server.pages.push(rawPage(201, 'Notes', 'Notes.md', 92));
		server.davFiles.set('.Collectives/Handbuch/Notes.md', { content: remoteText('Notes neu'), etag: '"etag-201"' });

		const outcome = await runSync(deps);

		expect(outcome).toMatchObject({ kind: 'done', result: { created: 1, conflicts: 0, failed: 0 } });
		expect(readPageId(await vault.read('Handbuch/Notes.md'))).toBe(200);
		expect(readPageId(await vault.read('Handbuch/Notes (2).md'))).toBe(201);
		expect(vault.listFiles().some((file) => file.path.includes('Konflikt'))).toBe(false);
	});

	it('keeps a user file on a page path untouched across runs, and links it once the remote text equals it', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		const userText = 'Mein eigener Text\n';
		vault.seed('Handbuch/Per WebDAV.md', userText);

		const first = await runSync(deps);

		expect(first).toMatchObject({ kind: 'done', result: { conflicts: 1, failed: 0 } });
		expect(storedState(stateFile).pages['102']?.status).toBe('collision');
		expect(vault.listFiles().filter((file) => file.path.startsWith('Handbuch/Per WebDAV (Konflikt'))).toHaveLength(1);
		expect(await vault.read('Handbuch/Per WebDAV.md')).toBe(userText);

		const writesBefore = vault.writes;
		const stateWritesBefore = stateFile.writes;
		const second = await runSync(deps);

		expect(second).toEqual({ kind: 'done', result: ZERO_RESULT, skips: [], openConflicts: 1 });
		expect(vault.writes).toBe(writesBefore);
		expect(stateFile.writes).toBe(stateWritesBefore);

		serverPage(server, 102)['timestamp'] = 1792139000;
		server.davFiles.set('.Collectives/Handbuch/Per WebDAV.md', { content: userText, etag: '"etag-102-v3"' });
		const third = await runSync(deps);

		expect(third).toMatchObject({ kind: 'done', result: { conflicts: 0, failed: 0 } });
		expect(readPageId(await vault.read('Handbuch/Per WebDAV.md'))).toBe(102);
		expect(storedState(stateFile).pages['102']?.status).toBe('synced');
	});
});

describe('runSync: pushing local edits', () => {
	const PAGE_102_LOCAL = 'Handbuch/Per WebDAV.md';
	const PAGE_102_REMOTE = '.Collectives/Handbuch/Per WebDAV.md';

	/** Local edit of page 102 after a first sync: appends a line, so the local mtime moves and the text differs. */
	async function editLocally(vault: MemoryVault): Promise<string> {
		const localText = `${await vault.read(PAGE_102_LOCAL)}Mein Zusatz\n`;
		vault.userEdit(PAGE_102_LOCAL, localText);
		return localText;
	}

	/** Server-side change of page 102: newer timestamp, new text and a new ETag. */
	function serverChangesPage102(server: FakeNextcloud, text: string): void {
		serverPage(server, 102)['timestamp'] = 1792139000;
		server.davFiles.set(PAGE_102_REMOTE, { content: text, etag: '"etag-102-server"' });
	}

	it('uploads a locally edited synced page, returns no open conflicts and leaves the server with the local text', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const deps = makeDeps(server, vault, new FakeStateFile());
		await runSync(deps);
		const localText = await editLocally(vault);

		const outcome = await runSync(deps);

		expect(outcome).toEqual({ kind: 'done', result: { ...ZERO_RESULT, pushed: 1 }, skips: [], openConflicts: 0 });
		expect(server.davFiles.get(PAGE_102_REMOTE)?.content).toBe(toRemote(localText));
	});

	it('asks the dirty-path source once per run', async () => {
		const dirty = vi.fn(() => new Set<string>());
		const deps = makeDeps(new FakeNextcloud(), new MemoryVault(), new FakeStateFile(), { dirty });

		await runSync(deps);

		expect(dirty).toHaveBeenCalledTimes(1);
	});

	it('does not upload the same text again on the next run, fetches the page once, and leaves it alone on the run after', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const deps = makeDeps(server, vault, new FakeStateFile());
		await runSync(deps);
		await editLocally(vault);
		await runSync(deps);

		const callsBeforeSecond = server.calls.length;
		const second = await runSync(deps);
		const secondDav = server.davRequests(callsBeforeSecond);

		expect(secondDav.filter((req) => req.method === 'PUT')).toEqual([]);
		expect(secondDav.filter((req) => req.method === 'GET')).toHaveLength(1);
		expect(second).toMatchObject({ kind: 'done', openConflicts: 0, result: { pushed: 0, conflicts: 0, failed: 0 } });

		const callsBeforeThird = server.calls.length;
		const third = await runSync(deps);

		expect(server.davRequests(callsBeforeThird)).toEqual([]);
		expect(third).toEqual({ kind: 'done', result: ZERO_RESULT, skips: [], openConflicts: 0 });
	});

	it('pushes the local text when both sides changed and conflictStrategy is preferLocal', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const deps = makeDeps(server, vault, new FakeStateFile(), {
			settings: { serverUrl: BASE, username: 'alice', conflictStrategy: 'preferLocal' },
		});
		await runSync(deps);
		const localText = await editLocally(vault);
		serverChangesPage102(server, '# Per WebDAV\n\nServer-Fassung\n');

		const outcome = await runSync(deps);

		expect(outcome).toEqual({ kind: 'done', result: { ...ZERO_RESULT, pushed: 1 }, skips: [], openConflicts: 0 });
		expect(server.davFiles.get(PAGE_102_REMOTE)?.content).toBe(toRemote(localText));
		expect(await vault.read(PAGE_102_LOCAL)).toBe(localText);
		expect(vault.listFiles().some((file) => file.path.includes('Konflikt'))).toBe(false);
	});
});
