import { describe, expect, it } from 'vitest';
import type { DavFile, WebdavClient } from '../../src/api/webdavClient';
import { asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { Collective, PageInfo } from '../../src/api/types';
import { canonicalRemote, replaceNcMeta, toLocal } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { pathKey, remotePagePath } from '../../src/mapping/paths';
import { executePull } from '../../src/sync/executor';
import type { ExecutorDeps } from '../../src/sync/executor';
import { planPull } from '../../src/sync/planner';
import type { PullOp, PullPlan } from '../../src/sync/planner';
import type { LocalSnapshot } from '../../src/sync/localScanner';
import type { RemoteSnapshot } from '../../src/sync/remoteScanner';
import { emptyState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { sha256Hex } from '../../src/util/hash';
import { ApiChangedError, AuthError, NetworkError, NotFoundError } from '../../src/util/errors';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';

const SERVER = 'https://cloud.example.com';
const NOW = new Date(2026, 9, 16, 14, 30);
const CONFLICT_SUFFIX = ' (Konflikt 2026-10-16 1430)';
const META_HASH = 'meta-1';
const META_HASH_2 = 'meta-2';

const REMOTE_V1 = '# Notiz\n\nErste Fassung\n';
const REMOTE_V2 = '# Notiz\n\nZweite Fassung\n';

const NOTE_PATH = 'Coll/Notiz.md';
const NOTE_CONFLICT = `Coll/Notiz${CONFLICT_SUFFIX}.md`;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Remote page 10 'Notiz' in the collective 'Coll' (id 1), top level. */
function page(id: number, over: Partial<PageInfo> = {}): PageInfo {
	return {
		id: asPageId(id),
		slug: `seite-${id}`,
		title: 'Notiz',
		emoji: null,
		tags: [],
		timestamp: 1000,
		size: 20,
		fileName: 'Notiz.md',
		filePath: '',
		collectivePath: '.Collectives/Coll',
		parentId: asPageId(1),
		subpageOrder: [],
		lastUserId: null,
		linkedPageIds: [],
		trashTimestamp: null,
		...over,
	};
}

const NOTE = page(10);

function metaOf(id: number, over: Partial<NcMeta> = {}): NcMeta {
	return { pageId: asPageId(id), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [], ...over };
}

function collective(): Collective {
	return {
		id: asCollectiveId(1),
		circleId: 'circle-1',
		name: 'Coll',
		slug: 'coll',
		emoji: null,
		level: 9,
		canEdit: true,
		trashTimestamp: null,
	};
}

/** Body of a local text: everything after the frontmatter block. */
function bodyOf(text: string): string {
	return text.slice(text.indexOf('\n---\n') + '\n---\n'.length);
}

// ---------------------------------------------------------------------------
// Fakes and harness
// ---------------------------------------------------------------------------

/** Fake WebDAV: serves files by user-relative path, can fail a path with a given error. */
class FakeDav {
	readonly files = new Map<string, DavFile>();
	readonly errors = new Map<string, Error>();
	readonly webdav: Pick<WebdavClient, 'get'> = {
		get: async (path: string): Promise<DavFile> => {
			const error = this.errors.get(path);
			if (error) throw error;
			const file = this.files.get(path);
			if (file === undefined) throw new NotFoundError(`Not found: ${path}`);
			return { content: file.content, etag: file.etag };
		},
	};

	serve(p: PageInfo, content: string, etag: string): void {
		this.files.set(remotePagePath(p), { content, etag });
	}

	fail(p: PageInfo, error: Error): void {
		this.errors.set(remotePagePath(p), error);
	}
}

interface Harness {
	vault: MemoryVault;
	dav: FakeDav;
	state: SyncState;
	/** Deep copies of the state at each persist call, in order. */
	persisted: SyncState[];
	deps: ExecutorDeps;
}

function harness(): Harness {
	const vault = new MemoryVault();
	const dav = new FakeDav();
	const state = emptyState(SERVER, 'alice-id');
	const persisted: SyncState[] = [];
	const deps: ExecutorDeps = {
		vault,
		webdav: dav.webdav,
		state,
		persist: async (current) => {
			persisted.push(structuredClone(current));
		},
		now: () => NOW,
		conflictLabel: 'Konflikt',
		log: new Logger(),
		occupied: new Set<string>(),
	};
	return { vault, dav, state, persisted, deps };
}

function plan(ops: PullOp[]): PullPlan {
	return { ops, skips: [] };
}

/** Records a page as synced with the given local text as base, as an earlier run would have. */
async function remember(h: Harness, p: PageInfo, localPath: string, baseText: string): Promise<void> {
	h.state.pages[String(p.id)] = {
		pageId: p.id,
		collectiveId: asCollectiveId(1),
		localPath,
		localMtime: h.vault.mtime(localPath) ?? 0,
		remoteFilePath: p.filePath,
		remoteFileName: p.fileName,
		parentId: p.parentId,
		remoteEtag: 'etag-old',
		remoteMtime: p.timestamp,
		remoteSize: p.size,
		baseHash: await sha256Hex(canonicalRemote(baseText)),
		metaHash: META_HASH,
		status: 'synced',
		conflictPath: null,
		attachments: [],
		lastSyncedAt: 1,
	};
}

function stateOf(h: Harness, p: PageInfo): PageState {
	const entry = h.state.pages[String(p.id)];
	if (entry === undefined) throw new Error(`no state for page ${p.id}`);
	return entry;
}

const ZERO_RESULT = { created: 0, updated: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executePull: create', () => {
	it('writes the remote text with nc fields and records a synced state', async () => {
		const h = harness();
		h.vault.seedFolder('Coll');
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');
		const meta = metaOf(10);

		const result = await executePull(plan([{ kind: 'create', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH }]), h.deps);

		expect(await h.vault.read(NOTE_PATH)).toBe(toLocal(REMOTE_V1, meta));
		expect(result).toEqual({ ...ZERO_RESULT, created: 1 });
		expect(h.state.pages['10']).toEqual({
			pageId: asPageId(10),
			collectiveId: asCollectiveId(1),
			localPath: NOTE_PATH,
			localMtime: h.vault.mtime(NOTE_PATH),
			remoteFilePath: '',
			remoteFileName: 'Notiz.md',
			parentId: asPageId(1),
			remoteEtag: '"e1"',
			remoteMtime: 1000,
			remoteSize: 20,
			baseHash: await sha256Hex(canonicalRemote(REMOTE_V1)),
			metaHash: META_HASH,
			status: 'synced',
			conflictPath: null,
			attachments: [],
			lastSyncedAt: NOW.getTime(),
		});
		expect(h.persisted).toHaveLength(1);
		expect(h.persisted[0]?.pages['10']).toEqual(h.state.pages['10']);
	});

	it('creates a page in a subfolder when the ensureFolder ops come first in the plan', async () => {
		const h = harness();
		const erster = page(20, { title: 'Erster Tag', fileName: 'Erster Tag.md', filePath: 'Onboarding' });
		h.dav.serve(erster, REMOTE_V1, '"e20"');
		const meta = metaOf(20);

		const result = await executePull(
			plan([
				{ kind: 'ensureFolder', path: 'Coll' },
				{ kind: 'ensureFolder', path: 'Coll/Onboarding' },
				{ kind: 'create', page: erster, path: 'Coll/Onboarding/Erster Tag.md', meta, metaHash: META_HASH },
			]),
			h.deps,
		);

		expect(result).toEqual({ ...ZERO_RESULT, created: 1 });
		expect(h.vault.exists('Coll/Onboarding')).toBe(true);
		expect(await h.vault.read('Coll/Onboarding/Erster Tag.md')).toBe(toLocal(REMOTE_V1, meta));
		expect(h.vault.writes).toBe(3);
	});

	it('does not create a folder that already exists', async () => {
		const h = harness();
		h.vault.seedFolder('Coll');

		const result = await executePull(plan([{ kind: 'ensureFolder', path: 'Coll' }]), h.deps);

		expect(result).toEqual(ZERO_RESULT);
		expect(h.vault.writes).toBe(0);
	});

	it('saveCollective and saveTags only change the state and persist after each op', async () => {
		const h = harness();
		const tags = [{ id: asTagId(1), name: 'Projekt', color: '0082c9' }];

		const result = await executePull(
			plan([
				{ kind: 'saveCollective', collective: { collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' } },
				{ kind: 'saveTags', collectiveId: asCollectiveId(1), tags },
			]),
			h.deps,
		);

		expect(result).toEqual(ZERO_RESULT);
		expect(h.state.collectives['1']).toEqual({ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' });
		expect(h.state.tags['1']).toEqual(tags);
		expect(h.vault.writes).toBe(0);
		expect(h.persisted).toHaveLength(2);
	});
});

describe('executePull: createConflict and conflict naming', () => {
	it('keeps the user file byte-identical and writes the remote text as a conflict copy', async () => {
		const h = harness();
		const userText = 'Mein eigener Text\n';
		h.vault.seed(NOTE_PATH, userText);
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');

		const result = await executePull(plan([{ kind: 'createConflict', page: NOTE, path: NOTE_PATH, meta: metaOf(10), metaHash: META_HASH }]), h.deps);

		expect(await h.vault.read(NOTE_PATH)).toBe(userText);
		expect(await h.vault.read(NOTE_CONFLICT)).toBe(canonicalRemote(REMOTE_V1));
		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({
			status: 'collision',
			localPath: NOTE_PATH,
			baseHash: '',
			conflictPath: NOTE_CONFLICT,
		});
	});

	it('never overwrites an existing conflict file and picks the next free name', async () => {
		const h = harness();
		const oldCopy = 'Alte Kopie\n';
		h.vault.seed(NOTE_PATH, 'Mein Text\n');
		h.vault.seed(NOTE_CONFLICT, oldCopy);
		h.deps.occupied.add(pathKey(NOTE_CONFLICT));
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');

		await executePull(plan([{ kind: 'createConflict', page: NOTE, path: NOTE_PATH, meta: metaOf(10), metaHash: META_HASH }]), h.deps);

		expect(await h.vault.read(NOTE_CONFLICT)).toBe(oldCopy);
		expect(stateOf(h, NOTE).conflictPath).toBe(`Coll/Notiz${CONFLICT_SUFFIX} (2).md`);
		expect(await h.vault.read(`Coll/Notiz${CONFLICT_SUFFIX} (2).md`)).toBe(canonicalRemote(REMOTE_V1));
	});
});

describe('executePull: adopt', () => {
	it('leaves a file whose text already equals the remote untouched and records a synced state', async () => {
		const h = harness();
		const meta = metaOf(10);
		const before = toLocal(REMOTE_V1, meta);
		h.vault.seed(NOTE_PATH, before);
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');

		const result = await executePull(plan([{ kind: 'adopt', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH }]), h.deps);

		expect(await h.vault.read(NOTE_PATH)).toBe(before);
		expect(h.vault.writes).toBe(0);
		expect(result).toEqual({ ...ZERO_RESULT, unchanged: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'synced', baseHash: await sha256Hex(canonicalRemote(REMOTE_V1)), localPath: NOTE_PATH });
	});

	it('rewrites only the nc fields when the user text equals the remote but the nc fields differ', async () => {
		const h = harness();
		const meta = metaOf(10);
		const before = '---\nnc_page_id: 10\nnc_title: "Alt"\n---\n# Notiz\n\nErste Fassung\n';
		h.vault.seed(NOTE_PATH, before);
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');

		const result = await executePull(plan([{ kind: 'adopt', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH }]), h.deps);

		const after = await h.vault.read(NOTE_PATH);
		expect(after).toBe(replaceNcMeta(before, meta));
		expect(after).not.toContain('nc_title');
		expect(bodyOf(after)).toBe(bodyOf(before));
		expect(result).toEqual({ ...ZERO_RESULT, metaUpdated: 1 });
		expect(stateOf(h, NOTE).status).toBe('synced');
	});

	it('creates a conflict copy when the user text differs from the remote', async () => {
		const h = harness();
		const meta = metaOf(10);
		const userText = `${toLocal(REMOTE_V1, meta)}Eigener Zusatz\n`;
		h.vault.seed(NOTE_PATH, userText);
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');

		const result = await executePull(plan([{ kind: 'adopt', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH }]), h.deps);

		expect(await h.vault.read(NOTE_PATH)).toBe(userText);
		expect(await h.vault.read(NOTE_CONFLICT)).toBe(canonicalRemote(REMOTE_V1));
		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'conflict', baseHash: '', localPath: NOTE_PATH });
	});
});

describe('executePull: update', () => {
	it('writes the new remote text and the new baseHash when the local file is unchanged', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V1, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(toLocal(REMOTE_V2, meta));
		expect(result).toEqual({ ...ZERO_RESULT, updated: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({
			baseHash: await sha256Hex(canonicalRemote(REMOTE_V2)),
			remoteMtime: 2000,
			remoteSize: 30,
			remoteEtag: '"e2"',
			localMtime: h.vault.mtime(NOTE_PATH),
			status: 'synced',
		});
	});

	it('refreshes only the remote fields and writes nothing when the remote text hash equals the baseHash', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V1, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const touched = page(10, { timestamp: 2000 });
		h.dav.serve(touched, REMOTE_V1, '"e1b"');
		const writesBefore = h.vault.writes;
		const baseBefore = stateOf(h, NOTE).baseHash;

		const result = await executePull(
			plan([{ kind: 'update', page: touched, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(h.vault.writes).toBe(writesBefore);
		expect(result).toEqual({ ...ZERO_RESULT, unchanged: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ remoteMtime: 2000, remoteEtag: '"e1b"', baseHash: baseBefore });
	});

	it('keeps the local file and writes a conflict copy when both sides changed to different text', async () => {
		const h = harness();
		const meta = metaOf(10);
		const localText = `${toLocal(REMOTE_V1, meta)}Mein Zusatz\n`;
		h.vault.seed(NOTE_PATH, localText);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');
		const baseBefore = stateOf(h, NOTE).baseHash;

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(localText);
		expect(await h.vault.read(NOTE_CONFLICT)).toBe(canonicalRemote(REMOTE_V2));
		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({
			status: 'conflict',
			conflictPath: NOTE_CONFLICT,
			baseHash: baseBefore,
			remoteMtime: 2000,
			remoteEtag: '"e2"',
		});
	});

	it('does not produce another update op on the next planner run after such a conflict', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, `${toLocal(REMOTE_V1, meta)}Mein Zusatz\n`);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		h.state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' };
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');
		await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		const remote: RemoteSnapshot = { collectives: [{ collective: collective(), pages: [newer], tags: [] }], failed: [] };
		const local: LocalSnapshot = {
			files: [{ path: NOTE_PATH, mtime: h.vault.mtime(NOTE_PATH) ?? 0, pageId: asPageId(10) }],
			occupied: new Set<string>(),
			paths: new Map<string, string>(),
			nonEmpty: true,
		};
		const next = planPull({
			state: h.state,
			remote,
			local,
			remoteMeta: new Map([[asPageId(10), { meta, hash: META_HASH }]]),
			paths: { collectiveFolders: new Map([[asCollectiveId(1), 'Coll']]), targets: new Map(), orphans: [] },
		});

		expect(next.ops.filter((op) => 'page' in op)).toEqual([]);
	});

	it('records the new baseHash without writing when local and remote now hold the same text', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V2, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');
		const writesBefore = h.vault.writes;

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(h.vault.writes).toBe(writesBefore);
		expect(result).toEqual({ ...ZERO_RESULT, unchanged: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ baseHash: await sha256Hex(canonicalRemote(REMOTE_V2)), status: 'synced' });
	});

	it('does not overwrite user text that was typed between reading the file and writing it', async () => {
		const h = harness();
		const meta = metaOf(10);
		const originalText = toLocal(REMOTE_V1, meta);
		const userText = `${originalText}Eingetippt waehrend des Syncs\n`;
		h.vault.seed(NOTE_PATH, originalText);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');
		h.vault.beforeProcess = (path) => {
			h.vault.beforeProcess = null;
			h.vault.userEdit(path, userText);
		};

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(userText);
		expect(await h.vault.read(NOTE_CONFLICT)).toBe(canonicalRemote(REMOTE_V2));
		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'conflict', conflictPath: NOTE_CONFLICT });
	});
});

describe('executePull: updateMeta', () => {
	it('rewrites only the nc fields and keeps the body byte-identical', async () => {
		const h = harness();
		const oldMeta = metaOf(10, { tags: ['alt'] });
		const newMeta = metaOf(10, { tags: ['neu'] });
		const before = toLocal(REMOTE_V1, oldMeta);
		h.vault.seed(NOTE_PATH, before);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);

		const result = await executePull(
			plan([{ kind: 'updateMeta', page: NOTE, path: NOTE_PATH, meta: newMeta, metaHash: META_HASH_2 }]),
			h.deps,
		);

		const after = await h.vault.read(NOTE_PATH);
		expect(after).toBe(replaceNcMeta(before, newMeta));
		expect(bodyOf(after)).toBe(bodyOf(before));
		expect(result).toEqual({ ...ZERO_RESULT, metaUpdated: 1 });
		expect(stateOf(h, NOTE).metaHash).toBe(META_HASH_2);
	});

	it('does not write when the nc fields already hold the new meta', async () => {
		const h = harness();
		const meta = metaOf(10, { tags: ['neu'] });
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V1, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const writesBefore = h.vault.writes;

		await executePull(plan([{ kind: 'updateMeta', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH_2 }]), h.deps);

		expect(h.vault.writes).toBe(writesBefore);
		expect(stateOf(h, NOTE).metaHash).toBe(META_HASH_2);
	});
});

describe('executePull: errors', () => {
	it('counts a failing page operation as failed and still runs the next operation', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V1, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		const newer = page(10, { timestamp: 2000 });
		h.dav.fail(newer, new NotFoundError('gone'));
		const zweite = page(30, { title: 'Zweite', fileName: 'Zweite.md' });
		h.dav.serve(zweite, REMOTE_V2, '"e30"');

		const result = await executePull(
			plan([
				{ kind: 'ensureFolder', path: 'Coll' },
				{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false },
				{ kind: 'create', page: zweite, path: 'Coll/Zweite.md', meta: metaOf(30), metaHash: META_HASH },
			]),
			h.deps,
		);

		expect(result).toEqual({ ...ZERO_RESULT, created: 1, failed: 1 });
		expect(await h.vault.read('Coll/Zweite.md')).toBe(toLocal(REMOTE_V2, metaOf(30)));
		expect(await h.vault.read(NOTE_PATH)).toBe(toLocal(REMOTE_V1, meta));
		expect(stateOf(h, NOTE).remoteMtime).toBe(1000);
	});

	it.each([
		['AuthError', new AuthError(401)],
		['ApiChangedError', new ApiChangedError('unexpected shape')],
		['NetworkError', new NetworkError('offline')],
	])('rejects with %s and does not run the remaining operations', async (_name, error) => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, toLocal(REMOTE_V1, meta));
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		h.dav.fail(page(10, { timestamp: 2000 }), error);
		h.vault.seedFolder('Coll');
		const zweite = page(30, { title: 'Zweite', fileName: 'Zweite.md' });
		h.dav.serve(zweite, REMOTE_V2, '"e30"');

		await expect(
			executePull(
				plan([
					{ kind: 'update', page: page(10, { timestamp: 2000 }), path: NOTE_PATH, meta, metaHash: META_HASH, metaChanged: false },
					{ kind: 'create', page: zweite, path: 'Coll/Zweite.md', meta: metaOf(30), metaHash: META_HASH },
				]),
				h.deps,
			),
		).rejects.toBe(error);
		expect(h.vault.exists('Coll/Zweite.md')).toBe(false);
	});
});

describe('executePull: collision page (status collision, baseHash empty)', () => {
	const USER_TEXT = '# Eigene Notiz\n\nVon mir\n';

	/** State as createConflict leaves it: the user file at NOTE_PATH has no nc_page_id and is not linked. */
	async function rememberCollision(h: Harness): Promise<void> {
		h.vault.seed(NOTE_PATH, USER_TEXT);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		h.state.pages[String(NOTE.id)] = { ...stateOf(h, NOTE), baseHash: '', status: 'collision', conflictPath: NOTE_CONFLICT };
	}

	it('never writes nc fields into the unlinked user file on a metadata change', async () => {
		const h = harness();
		await rememberCollision(h);
		const writesBefore = h.vault.writes;

		const result = await executePull(
			plan([{ kind: 'updateMeta', page: NOTE, path: NOTE_PATH, meta: metaOf(10, { tags: ['neu'] }), metaHash: META_HASH_2 }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(USER_TEXT);
		expect(h.vault.writes).toBe(writesBefore);
		expect(result).toEqual({ ...ZERO_RESULT, unchanged: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'collision', baseHash: '', metaHash: META_HASH_2 });
	});

	it('keeps the user file byte-identical and writes a new conflict copy when the remote text changed to other text', async () => {
		const h = harness();
		await rememberCollision(h);
		h.deps.occupied.add(pathKey(NOTE_CONFLICT));
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, REMOTE_V2, '"e2"');

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta: metaOf(10), metaHash: META_HASH_2, metaChanged: true }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(USER_TEXT);
		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'collision', baseHash: '', remoteMtime: 2000 });
	});

	it('links the user file and records a synced state when the remote text now equals it', async () => {
		const h = harness();
		await rememberCollision(h);
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, USER_TEXT, '"e2"');
		const meta = metaOf(10);

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta, metaHash: META_HASH_2, metaChanged: true }]),
			h.deps,
		);

		expect(await h.vault.read(NOTE_PATH)).toBe(replaceNcMeta(USER_TEXT, meta));
		expect(result).toEqual({ ...ZERO_RESULT, unchanged: 1 });
		expect(stateOf(h, NOTE)).toMatchObject({
			status: 'synced',
			conflictPath: null,
			baseHash: await sha256Hex(canonicalRemote(USER_TEXT)),
			metaHash: META_HASH_2,
		});
	});
});

describe('executePull: collision names, links and nc_title', () => {
	const USER_TEXT = '# Eigene Notiz\n\nVon mir\n';

	it('never links a collision file that carries an nc_page_id, and writes a conflict copy instead', async () => {
		const h = harness();
		const linked = toLocal(USER_TEXT, metaOf(10));
		h.vault.seed(NOTE_PATH, linked);
		await remember(h, NOTE, NOTE_PATH, REMOTE_V1);
		h.state.pages['10'] = { ...stateOf(h, NOTE), baseHash: '', status: 'collision', conflictPath: null };
		const newer = page(10, { timestamp: 2000, size: 30 });
		h.dav.serve(newer, USER_TEXT, '"e2"');

		const result = await executePull(
			plan([{ kind: 'update', page: newer, path: NOTE_PATH, meta: metaOf(10), metaHash: META_HASH, metaChanged: false }]),
			h.deps,
		);

		expect(result).toEqual({ ...ZERO_RESULT, conflicts: 1 });
		expect(await h.vault.read(NOTE_PATH)).toBe(linked);
		expect(await h.vault.read(NOTE_CONFLICT)).toBe(canonicalRemote(USER_TEXT));
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'collision', baseHash: '', conflictPath: NOTE_CONFLICT });
	});

	it('keeps an adopt conflict findable by nc_page_id after the user renamed its file, so no page is skipped as localDeleted', async () => {
		const h = harness();
		const meta = metaOf(10);
		h.vault.seed(NOTE_PATH, `${toLocal(REMOTE_V1, meta)}Eigener Zusatz\n`);
		h.dav.serve(NOTE, REMOTE_V1, '"e1"');
		await executePull(plan([{ kind: 'adopt', page: NOTE, path: NOTE_PATH, meta, metaHash: META_HASH }]), h.deps);
		expect(stateOf(h, NOTE)).toMatchObject({ status: 'conflict', baseHash: '' });
		h.state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' };

		const planned = planPull({
			state: h.state,
			remote: { collectives: [{ collective: collective(), pages: [NOTE], tags: [] }], failed: [] },
			local: {
				files: [{ path: 'Coll/Umbenannt.md', mtime: 1, pageId: asPageId(10) }],
				occupied: new Set<string>(),
				paths: new Map<string, string>(),
				nonEmpty: true,
			},
			remoteMeta: new Map([[asPageId(10), { meta, hash: META_HASH }]]),
			paths: { collectiveFolders: new Map([[asCollectiveId(1), 'Coll']]), targets: new Map(), orphans: [] },
		});

		expect(planned.skips).toEqual([]);
	});

	it('writes nc_title from the file name it is written to, so a suffixed file keeps the original title', async () => {
		const h = harness();
		h.vault.seedFolder('Coll');
		const note = page(12, { title: 'Notes', fileName: 'Notes.md' });
		h.dav.serve(note, REMOTE_V1, '"e12"');

		await executePull(
			plan([{ kind: 'create', page: note, path: 'Coll/Notes (2).md', meta: metaOf(12, { title: null }), metaHash: META_HASH }]),
			h.deps,
		);

		expect(await h.vault.read('Coll/Notes (2).md')).toBe(toLocal(REMOTE_V1, metaOf(12, { title: 'Notes' })));
	});

	it('never writes nc_title into a landing page, whatever title the planned meta carries', async () => {
		const h = harness();
		h.vault.seedFolder('Coll');
		const landing = page(92, { title: 'Landing page', fileName: 'Readme.md', parentId: asPageId(0) });
		h.dav.serve(landing, REMOTE_V1, '"e92"');

		await executePull(
			plan([{ kind: 'create', page: landing, path: 'Coll/Coll.md', meta: metaOf(92, { title: 'Landing page' }), metaHash: META_HASH }]),
			h.deps,
		);

		expect(await h.vault.read('Coll/Coll.md')).toBe(toLocal(REMOTE_V1, metaOf(92)));
	});
});
