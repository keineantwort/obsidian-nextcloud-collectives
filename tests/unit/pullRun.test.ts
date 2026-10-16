import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';
import { toLocal } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { readPageId } from '../../src/mapping/frontmatter';
import { StateStore } from '../../src/sync/stateStore';
import type { StateFile } from '../../src/sync/stateStore';
import { emptyState, serializeSyncState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { runPull } from '../../src/sync/pullRun';
import type { PullRunDeps } from '../../src/sync/pullRun';
import { createTranslator } from '../../src/i18n';
import { ConfigError } from '../../src/util/errors';
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

function ocs(data: unknown): HttpResponse {
	return { status: 200, headers: {}, text: JSON.stringify({ ocs: { meta: {}, data } }) };
}

const NOT_FOUND: HttpResponse = { status: 404, headers: {}, text: '' };

/**
 * Fake Nextcloud behind the RequestFn: Collectives OCS endpoints for collective 1, the user endpoint with the
 * user ID 'alice-id' (login name 'alice'), and WebDAV GET under /remote.php/dav/files/alice-id/.
 * Tests may change `pages` and `davFiles` between runs.
 */
class FakeNextcloud {
	readonly calls: HttpRequest[] = [];
	readonly pages: Record<string, unknown>[] = structuredClone(PAGES_FIXTURE);
	readonly davFiles = new Map<string, { content: string; etag: string }>();

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
		if (req.method !== 'GET') return { status: 405, headers: {}, text: '' };
		const key = req.url.slice(DAV_ROOT.length).split('/').map((segment) => decodeURIComponent(segment)).join('/');
		const file = this.davFiles.get(key);
		if (file === undefined) return NOT_FOUND;
		return { status: 200, headers: { ETag: file.etag }, text: file.content };
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

function makeDeps(server: FakeNextcloud, vault: MemoryVault, stateFile: FakeStateFile, over: Partial<PullRunDeps> = {}): PullRunDeps {
	return {
		settings: { serverUrl: BASE, username: 'alice' },
		readPassword: async () => PASSWORD,
		request: server.request,
		vault,
		stateStore: new StateStore(stateFile),
		confirmInitialSync: vi.fn(async () => true),
		t: createTranslator('de'),
		log: new Logger(),
		now: () => NOW,
		...over,
	};
}

function metaOf(id: number): NcMeta {
	return { pageId: asPageId(id), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPull: first sync into an empty vault', () => {
	it('creates each remote page as a Markdown file with its nc_page_id and stores the state', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();

		const outcome = await runPull(makeDeps(server, vault, stateFile));

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

	it('uses the Nextcloud user ID in every WebDAV path, not the login name', async () => {
		const server = new FakeNextcloud();

		await runPull(makeDeps(server, new MemoryVault(), new FakeStateFile()));

		const dav = server.davRequests();
		expect(dav).toHaveLength(DAV_FILES.length);
		expect(dav.every((req) => req.url.startsWith(DAV_ROOT))).toBe(true);
		expect(dav.some((req) => req.url.includes('/remote.php/dav/files/alice/'))).toBe(false);
	});

	it('does not ask for the initial-sync confirmation when the vault is empty', async () => {
		const confirmInitialSync = vi.fn(async () => true);

		await runPull(makeDeps(new FakeNextcloud(), new MemoryVault(), new FakeStateFile(), { confirmInitialSync }));

		expect(confirmInitialSync).not.toHaveBeenCalled();
	});
});

describe('runPull: second run', () => {
	it('writes no file and no state and makes no WebDAV request when the remote is unchanged', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		await runPull(deps);
		const vaultWrites = vault.writes;
		const stateWrites = stateFile.writes;
		const callsBefore = server.calls.length;

		const outcome = await runPull(deps);

		expect(outcome).toMatchObject({
			kind: 'done',
			result: { created: 0, updated: 0, metaUpdated: 0, conflicts: 0 },
		});
		expect(vault.writes).toBe(vaultWrites);
		expect(stateFile.writes).toBe(stateWrites);
		expect(server.davRequests(callsBefore)).toEqual([]);
	});

	it('updates only the one file whose remote content changed between the runs', async () => {
		const server = new FakeNextcloud();
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		const deps = makeDeps(server, vault, stateFile);
		await runPull(deps);
		const changed = server.pages.find((p) => p['id'] === 102);
		if (changed === undefined) throw new Error('fixture has no page 102');
		changed['timestamp'] = 1792139000;
		changed['size'] = 40;
		const newText = '# Per WebDAV\n\nNeuer Inhalt\n';
		server.davFiles.set('.Collectives/Handbuch/Per WebDAV.md', { content: newText, etag: '"etag-102-v2"' });
		const writesBefore = vault.writes;

		const outcome = await runPull(deps);

		expect(outcome).toMatchObject({
			kind: 'done',
			result: { created: 0, updated: 1, metaUpdated: 0, conflicts: 0, failed: 0 },
		});
		expect(vault.writes - writesBefore).toBe(1);
		expect(await vault.read('Handbuch/Per WebDAV.md')).toBe(toLocal(newText, metaOf(102)));
	});
});

describe('runPull: initial sync into a non-empty vault', () => {
	it('asks for confirmation and writes nothing when the user cancels', async () => {
		const vault = new MemoryVault();
		vault.seed('Notizen/a.md', 'Meine Notiz\n');
		const stateFile = new FakeStateFile();
		const confirmInitialSync = vi.fn(async () => false);

		const outcome = await runPull(makeDeps(new FakeNextcloud(), vault, stateFile, { confirmInitialSync }));

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

		const outcome = await runPull(makeDeps(new FakeNextcloud(), vault, new FakeStateFile(), { confirmInitialSync }));

		expect(confirmInitialSync).toHaveBeenCalledTimes(1);
		expect(outcome).toMatchObject({ kind: 'done', result: { created: 6, failed: 0 } });
		expect(await vault.read('Notizen/a.md')).toBe('Meine Notiz\n');
		for (const expected of EXPECTED_FILES) expect(vault.exists(expected.path)).toBe(true);
	});
});

describe('runPull: refusals and errors', () => {
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

		const outcome = await runPull(makeDeps(new FakeNextcloud(), vault, stateFile));

		expect(outcome).toEqual({ kind: 'serverMismatch', stateServer: 'https://other.example.com' });
		expect(vault.writes).toBe(0);
		expect(stateFile.writes).toBe(0);
		expect(stateFile.text).toBe(storedBefore);
	});

	it('returns serverMismatch and writes nothing when the stored state belongs to another account on the same server', async () => {
		const vault = new MemoryVault();
		const stateFile = new FakeStateFile();
		await runPull(makeDeps(new FakeNextcloud(), vault, stateFile));
		const parsed = JSON.parse(stateFile.text ?? '') as SyncState;
		stateFile.text = serializeSyncState({ ...parsed, user: 'bob-id' });
		const storedBefore = stateFile.text;
		const writesBefore = vault.writes;

		const outcome = await runPull(makeDeps(new FakeNextcloud(), vault, stateFile));

		expect(outcome).toEqual({ kind: 'serverMismatch', stateServer: `bob-id @ ${BASE}` });
		expect(vault.writes).toBe(writesBefore);
		expect(stateFile.text).toBe(storedBefore);
	});

	it('rejects with ConfigError for appPassword when no app password is stored, before any request', async () => {
		const server = new FakeNextcloud();

		const err: unknown = await runPull(makeDeps(server, new MemoryVault(), new FakeStateFile(), { readPassword: async () => null })).then(
			() => null,
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'appPassword' });
		expect(server.calls).toEqual([]);
	});
});
