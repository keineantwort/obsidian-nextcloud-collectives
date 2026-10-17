// M6 (PLAN §7.5): emoji and tags from the vault to the server, against a fake Collectives API, a fake WebDAV and an in-memory vault.
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { PageInfo } from '../../src/api/types';
import { readLocalFields, readNcMeta, readPageId, toLocal, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import type { TagsProperty } from '../../src/mapping/tags';
import { applyResolution } from '../../src/sync/conflicts';
import { executeSync } from '../../src/sync/executor';
import type { ExecutorDeps } from '../../src/sync/executor';
import type { SyncOp, SyncPlan } from '../../src/sync/planner';
import { emptyState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { emptyResult } from '../../src/sync/types';
import { ServerError } from '../../src/util/errors';
import { metaHash, sha256Hex } from '../../src/util/hash';
import { Logger } from '../../src/util/logger';
import { FakeApi } from '../fakes/fakeApi';
import { FakeDav } from '../fakes/fakeDav';
import { MemoryVault } from '../fakes/memoryVault';

const NOW = new Date(2026, 9, 17, 10, 0);
const COLL = asCollectiveId(1);
const OTHER = asCollectiveId(2);
const LANDING = asPageId(100);
const PATH = 'Coll/Notiz.md';
const TEXT = 'Inhalt';

interface H {
	vault: MemoryVault;
	dav: FakeDav;
	api: FakeApi;
	state: SyncState;
	deps: ExecutorDeps;
	infos: string[];
}

function harness(tagsProperty?: TagsProperty): H {
	const vault = new MemoryVault();
	const dav = new FakeDav();
	const api = new FakeApi(dav);
	api.addCollective(1, 'Coll');
	api.addCollective(2, 'Zwei');
	const state = emptyState('https://cloud.example.com', 'alice-id');
	state.collectives['1'] = { collectiveId: COLL, name: 'Coll', localFolder: 'Coll' };
	state.collectives['2'] = { collectiveId: OTHER, name: 'Zwei', localFolder: 'Zwei' };
	state.tags['1'] = [];
	state.tags['2'] = [];
	const infos: string[] = [];
	const log = new Logger();
	log.info = (message: string) => {
		infos.push(message);
	};
	const deps: ExecutorDeps = {
		vault: {
			exists: (p) => vault.exists(p),
			read: (p) => vault.read(p),
			create: (p, c) => vault.create(p, c),
			process: (p, f) => vault.process(p, f),
			createFolder: (p) => vault.createFolder(p),
			mtime: (p) => vault.mtime(p),
			rename: (a, b) => vault.rename(a, b),
			trash: (p) => vault.trash(p),
		},
		webdav: dav.webdav,
		api,
		state,
		persist: async () => undefined,
		now: () => NOW,
		conflictLabel: 'Konflikt',
		strategy: 'conflictFile',
		sleep: async () => undefined,
		log,
		occupied: new Set<string>(),
		...(tagsProperty === undefined ? {} : { tagsProperty }),
	};
	vault.seedFolder('Coll');
	vault.seedFolder('Zwei');
	return { vault, dav, api, state, deps, infos };
}

function plan(ops: SyncOp[]): SyncPlan {
	return { ops, skips: [], proposals: [], followUp: false };
}

/** Tag known to the server and the state cache. */
function serverTag(h: H, collective: number, name: string): number {
	const tag = h.api.addTag(collective, name);
	const cache = h.state.tags[String(collective)] ?? [];
	cache.push({ id: tag.id, name: tag.name, color: tag.color });
	h.state.tags[String(collective)] = cache;
	return tag.id;
}

function metaOf(page: PageInfo, over: Partial<NcMeta> = {}): NcMeta {
	return { pageId: page.id, collectiveId: COLL, title: page.title, emoji: page.emoji, tags: [], ...over };
}

interface Synced {
	page: PageInfo;
	meta: NcMeta;
	hash: string;
}

/** A page the state knows as synced: file, state and server agree on `emoji` and `tagNames`. */
async function synced(h: H, over: { emoji?: string | null; tagNames?: string[]; tagIds?: number[]; tagsProperty?: TagsProperty } = {}): Promise<Synced> {
	const page = h.api.addPage(1, { title: 'Notiz', parentId: LANDING, emoji: over.emoji ?? null, tags: (over.tagIds ?? []).map(asTagId) });
	const meta = metaOf(page, { emoji: over.emoji ?? null, tags: over.tagNames ?? [], ...(over.tagsProperty === 'tags' ? { tagsProperty: 'tags' as const } : {}) });
	const hash = await metaHash(meta.emoji, meta.tags);
	h.vault.seed(PATH, toLocal(TEXT, meta));
	h.dav.serve(page, TEXT, '"e1"');
	h.state.pages[String(page.id)] = {
		pageId: page.id,
		collectiveId: COLL,
		localPath: PATH,
		localMtime: h.vault.mtime(PATH) ?? 0,
		remoteFilePath: page.filePath,
		remoteFileName: page.fileName,
		parentId: page.parentId,
		remoteEtag: '"e1"',
		remoteMtime: page.timestamp,
		remoteSize: page.size,
		baseHash: await sha256Hex(toRemote(toLocal(TEXT, meta))),
		metaHash: hash,
		status: 'synced',
		conflictPath: null,
		attachments: [],
		lastSyncedAt: 1,
	};
	return { page, meta, hash };
}

function stateOf(h: H, page: PageInfo): PageState {
	const entry = h.state.pages[String(page.id)];
	if (entry === undefined) throw new Error('no state');
	return entry;
}

/** The user edits the nc fields of the file (the text stays). */
function userSetsFields(h: H, page: PageInfo, over: Partial<NcMeta>): void {
	h.vault.userEdit(PATH, toLocal(TEXT, metaOf(page, over)));
}

const push = (s: Synced): SyncOp => ({ kind: 'push', page: s.page, path: PATH, meta: s.meta, metaHash: s.hash, metaChanged: false });

describe('emoji and tags changed in the vault go to the server (push)', () => {
	it('sets a new emoji without uploading the text', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { emoji: '🚀' });

		const result = await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} 🚀`);
		expect(h.dav.puts()).toEqual([]);
		expect(result).toEqual({ ...emptyResult(), unchanged: 1, metaPushed: 1 });
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash('🚀', []));
	});

	it('removes the emoji when the nc_emoji line is gone', async () => {
		const h = harness();
		const s = await synced(h, { emoji: '📘' });
		userSetsFields(h, s.page, { emoji: null });

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} null`);
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash(null, []));
	});

	it('creates a missing tag once, with the default color, and adds it to the page', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { tags: ['Neu', 'neu'] });

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls.filter((c) => c.startsWith('createTag'))).toEqual(['createTag 1 Neu 0082c9']);
		const created = h.state.tags['1']?.find((tag) => tag.name === 'Neu');
		expect(created).toBeDefined();
		expect(h.api.calls).toContain(`addPageTag 1 ${s.page.id} ${created?.id}`);
		expect(h.api.entries.get(s.page.id)?.page.tags).toEqual([created?.id]);
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash(null, ['Neu']));
	});

	it('creates no duplicate tag for a name that differs in case, and writes the server spelling into the note', async () => {
		const h = harness();
		const tagId = serverTag(h, 1, 'Projekt');
		const s = await synced(h);
		userSetsFields(h, s.page, { tags: ['projekt'] });

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls.some((c) => c.startsWith('createTag'))).toBe(false);
		expect(h.api.entries.get(s.page.id)?.page.tags).toEqual([tagId]);
		expect(readLocalFields(await h.vault.read(PATH))?.tags).toEqual(['Projekt']);
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash(null, ['Projekt']));
	});

	it('removes a tag the user took out and keeps the others', async () => {
		const h = harness();
		const a = serverTag(h, 1, 'A');
		const b = serverTag(h, 1, 'B');
		const s = await synced(h, { tagNames: ['A', 'B'], tagIds: [a, b] });
		userSetsFields(h, s.page, { tags: ['B'] });

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls).toContain(`removePageTag 1 ${s.page.id} ${a}`);
		expect(h.api.calls.some((c) => c.startsWith('addPageTag'))).toBe(false);
		expect(h.api.entries.get(s.page.id)?.page.tags).toEqual([b]);
	});

	it('uses the tag somebody else created in the meantime when the server refuses the duplicate', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { tags: ['Fremd'] });
		const foreign = h.api.addTag(1, 'Fremd');

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls).toContain('createTag 1 Fremd 0082c9');
		expect(h.api.calls).toContain('listTags 1');
		expect(h.api.entries.get(s.page.id)?.page.tags).toEqual([foreign.id]);
		expect(h.state.tags['1']).toEqual([{ id: foreign.id, name: 'Fremd', color: '' }]);
	});

	it('fails the page when the tag cannot be created and is not on the server either', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { tags: ['X'] });
		h.api.failures.set('createTag', new ServerError(500));

		const result = await executeSync(plan([push(s)]), h.deps);

		expect(result.failed).toBe(1);
		expect(stateOf(h, s.page).metaHash).toBe(s.hash);
	});

	it('sends nothing when the fields equal the metadata of the server', async () => {
		const h = harness();
		const tagId = serverTag(h, 1, 'A');
		const s = await synced(h, { emoji: '📘', tagNames: ['A'], tagIds: [tagId] });
		h.vault.userEdit(PATH, `${await h.vault.read(PATH)}\nmehr`);
		h.dav.serve(s.page, `${TEXT}\nmehr`, '"e1"');

		await executeSync(plan([push(s)]), h.deps);

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
	});

	it('sends the metadata together with a changed text', async () => {
		const h = harness();
		const s = await synced(h);
		h.vault.userEdit(PATH, toLocal('Neuer Inhalt', metaOf(s.page, { emoji: '🚀' })));

		const result = await executeSync(plan([push(s)]), h.deps);

		expect(h.dav.puts()).toHaveLength(1);
		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} 🚀`);
		expect(result).toMatchObject({ pushed: 1, metaPushed: 1 });
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash('🚀', []));
	});
});

describe('emoji changed on both sides: the same strategies as for the content (PLAN §7.3)', () => {
	/** Note says 🚀, the server says 🎯, the state still knows no emoji. Returns the op the planner would plan. */
	async function bothChanged(h: H): Promise<{ s: Synced; op: SyncOp; remoteHash: string }> {
		const s = await synced(h);
		userSetsFields(h, s.page, { emoji: '🚀' });
		const remoteHash = await metaHash('🎯', []);
		const remoteMeta = metaOf(s.page, { emoji: '🎯' });
		return { s, remoteHash, op: { kind: 'push', page: { ...s.page, emoji: '🎯' }, path: PATH, meta: remoteMeta, metaHash: remoteHash, metaChanged: true } };
	}

	it('conflictFile: keeps the emoji of the note, saves the server\'s in a conflict copy and waits as a conflict', async () => {
		const h = harness();
		const { s, op, remoteHash } = await bothChanged(h);

		const result = await executeSync(plan([op]), h.deps);

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
		expect(h.dav.puts()).toEqual([]);
		expect(readNcMeta(await h.vault.read(PATH))?.emoji).toBe('🚀');
		const entry = stateOf(h, s.page);
		expect(entry).toMatchObject({ status: 'conflict', metaHash: remoteHash });
		const copy = await h.vault.read(entry.conflictPath as string);
		expect(copy).toContain('nc_emoji: "🎯"');
		expect(readPageId(copy)).toBeNull();
		expect(result).toMatchObject({ conflicts: 1, metaPushed: 0, failed: 0 });
	});

	it('preferRemote: the note takes the server\'s emoji', async () => {
		const h = harness();
		h.deps.strategy = 'preferRemote';
		const { s, op, remoteHash } = await bothChanged(h);

		const result = await executeSync(plan([op]), h.deps);

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
		expect(readNcMeta(await h.vault.read(PATH))?.emoji).toBe('🎯');
		expect(stateOf(h, s.page)).toMatchObject({ status: 'synced', metaHash: remoteHash });
		expect(result.conflicts).toBe(0);
	});

	it('preferLocal: the emoji of the note goes to the server', async () => {
		const h = harness();
		h.deps.strategy = 'preferLocal';
		const { s, op } = await bothChanged(h);

		const result = await executeSync(plan([op]), h.deps);

		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} 🚀`);
		expect(stateOf(h, s.page)).toMatchObject({ status: 'synced', metaHash: await metaHash('🚀', []) });
		expect(result).toMatchObject({ metaPushed: 1, conflicts: 0 });
	});

	it('both sides made the same change: no conflict', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { emoji: '🎯' });
		const remoteHash = await metaHash('🎯', []);

		const result = await executeSync(plan([{ kind: 'push', page: s.page, path: PATH, meta: metaOf(s.page, { emoji: '🎯' }), metaHash: remoteHash, metaChanged: true }]), h.deps);

		expect(result.conflicts).toBe(0);
		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
		expect(stateOf(h, s.page)).toMatchObject({ status: 'synced', metaHash: remoteHash });
	});

	it('a page that waits as a conflict is not touched again', async () => {
		const h = harness();
		const { s, op } = await bothChanged(h);
		await executeSync(plan([op]), h.deps);
		const copies = h.vault.listFiles().length;

		const again = await executeSync(plan([{ ...op, metaHash: await metaHash('🎯', ['x']), metaChanged: true } as SyncOp]), h.deps);

		expect(h.vault.listFiles().length).toBe(copies);
		expect(again.conflicts).toBe(0);
		expect(stateOf(h, s.page).status).toBe('conflict');
	});

	/** Resolves the conflict like the dialog does, then runs the next sync with the server's metadata. */
	async function resolved(choice: 'keepLocal' | 'takeRemote'): Promise<{ h: H; s: Synced }> {
		const h = harness();
		const { s, op } = await bothChanged(h);
		await executeSync(plan([op]), h.deps);
		const ok = await applyResolution({ vault: { read: (p) => h.vault.read(p), process: (p, f) => h.vault.process(p, f), exists: (p) => h.vault.exists(p), trash: (p) => h.vault.trash(p) }, state: h.state, log: new Logger() }, s.page.id, choice);
		expect(ok).toBe(true);
		h.api.calls.length = 0;
		const next: SyncOp = { kind: 'push', page: { ...s.page, emoji: '🎯' }, path: PATH, meta: metaOf(s.page, { emoji: '🎯' }), metaHash: await metaHash('🎯', []), metaChanged: false };
		await executeSync(plan([next]), h.deps);
		return { h, s };
	}

	it('resolving with "keep local" sends the note\'s emoji', async () => {
		const { h, s } = await resolved('keepLocal');

		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} 🚀`);
		expect(stateOf(h, s.page)).toMatchObject({ status: 'synced', metaHash: await metaHash('🚀', []) });
	});

	it('resolving with "take remote" writes the server\'s emoji into the note', async () => {
		const { h, s } = await resolved('takeRemote');

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
		expect(readNcMeta(await h.vault.read(PATH))?.emoji).toBe('🎯');
		expect(stateOf(h, s.page)).toMatchObject({ status: 'synced', metaHash: await metaHash('🎯', []) });
	});
});

describe('remote text pulled while the note has own metadata changes', () => {
	it('sends the changes first and keeps them in the file that takes the remote text', async () => {
		const h = harness();
		const s = await synced(h);
		userSetsFields(h, s.page, { emoji: '🚀' });
		const newer: PageInfo = { ...s.page, timestamp: 2000, size: 40 };
		h.dav.serve(newer, 'Remote neu', '"e2"');

		const result = await executeSync(plan([{ kind: 'update', page: newer, path: PATH, meta: s.meta, metaHash: s.hash, metaChanged: false }]), h.deps);

		expect(h.api.calls).toContain(`setPageEmoji 1 ${s.page.id} 🚀`);
		const text = await h.vault.read(PATH);
		expect(readNcMeta(text)?.emoji).toBe('🚀');
		expect(toRemote(text)).toBe('Remote neu');
		expect(result).toMatchObject({ updated: 1, metaPushed: 1 });
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash('🚀', []));
	});
});

describe('tagsProperty = tags', () => {
	it('reads the Obsidian tags, maps dashes back to the server names and writes both properties', async () => {
		const h = harness('tags');
		const tagId = serverTag(h, 1, 'Mein Tag');
		const s = await synced(h, { tagsProperty: 'tags' });
		h.vault.userEdit(PATH, `---\nnc_page_id: ${s.page.id}\nnc_collective_id: 1\ntags: [mein-tag, neu]\n---\n${TEXT}`);

		await executeSync(plan([{ kind: 'push', page: s.page, path: PATH, meta: s.meta, metaHash: s.hash, metaChanged: false }]), h.deps);

		const neu = h.state.tags['1']?.find((tag) => tag.name === 'neu');
		expect(h.api.calls.filter((c) => c.startsWith('createTag'))).toEqual(['createTag 1 neu 0082c9']);
		expect(h.api.entries.get(s.page.id)?.page.tags).toEqual([tagId, neu?.id]);
		const text = await h.vault.read(PATH);
		expect(text).toContain('tags: ["Mein-Tag","neu"]');
		expect(text).toContain('nc_tags: ["Mein Tag","neu"]');
	});

	it('does not touch the tags of the server for a note that has only the old nc_tags', async () => {
		const h = harness('tags');
		const tagId = serverTag(h, 1, 'A');
		const s = await synced(h, { tagNames: ['A'], tagIds: [tagId], tagsProperty: 'tags' });
		h.vault.userEdit(PATH, `---\nnc_page_id: ${s.page.id}\nnc_collective_id: 1\nnc_tags: ["A"]\n---\n${TEXT}`);

		await executeSync(plan([{ kind: 'push', page: s.page, path: PATH, meta: s.meta, metaHash: s.hash, metaChanged: false }]), h.deps);

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
	});
});

describe('a new local note with tags becomes a page with these tags', () => {
	const create: SyncOp = { kind: 'createRemote', path: 'Coll/Neu.md', title: 'Neu', collectiveId: COLL, parent: { kind: 'page', pageId: LANDING }, fileExists: true, order: 2 };

	it('creates the tags of the note on the server (tags property) and keeps them in the file', async () => {
		const h = harness('tags');
		serverTag(h, 1, 'Vorhanden');
		h.vault.seed('Coll/Neu.md', '---\ntags: [vorhanden, frisch]\n---\n\nText\n');

		const result = await executeSync(plan([create]), h.deps);

		expect(result.uploaded).toBe(1);
		const page = [...h.api.entries.values()].find((e) => e.page.title === 'Neu')?.page as PageInfo;
		expect(page.tags).toHaveLength(2);
		expect(h.api.calls.filter((c) => c.startsWith('createTag'))).toEqual(['createTag 1 frisch 0082c9']);
		const text = await h.vault.read('Coll/Neu.md');
		expect(readLocalFields(text, 'tags')?.tags).toEqual(['Vorhanden', 'frisch']);
		expect(h.state.pages[String(page.id)]?.metaHash).toBe(await metaHash(null, ['Vorhanden', 'frisch']));
		expect(h.dav.content(page)).toBe('---\ntags: ["Vorhanden","frisch"]\n---\n\nText');
	});

	it('ignores a plain tags property with nc_tags', async () => {
		const h = harness();
		h.vault.seed('Coll/Neu.md', '---\ntags: [privat]\n---\n\nText\n');

		await executeSync(plan([create]), h.deps);

		expect(h.api.calls.filter((c) => /Emoji|Tag/.test(c))).toEqual([]);
		expect(await h.vault.read('Coll/Neu.md')).toContain('tags: [privat]');
	});
});

describe('page moved into another collective', () => {
	it('assigns the tags of the note again in the target collective and creates those it lacks', async () => {
		const h = harness();
		const a = serverTag(h, 1, 'A');
		const s = await synced(h, { tagNames: ['A', 'B'], tagIds: [a] });
		const targetA = serverTag(h, 2, 'a');
		h.vault.seed('Zwei/Notiz.md', await h.vault.read(PATH));
		await h.vault.trash(PATH);
		h.state.pages[String(s.page.id)] = { ...stateOf(h, s.page), localPath: 'Zwei/Notiz.md' };
		h.dav.serve(s.page, TEXT, '"e1"');

		await executeSync(plan([{
			kind: 'moveRemote', pageId: s.page.id, fromCollectiveId: COLL, collectiveId: OTHER, path: 'Zwei/Notiz.md', title: null, parent: null, tidyTo: null, order: 1,
		}]), h.deps);

		const moved = h.api.entries.get(s.page.id);
		expect(moved?.collectiveId).toBe(OTHER);
		const b = h.state.tags['2']?.find((tag) => tag.name === 'B');
		expect(b).toBeDefined();
		expect(moved?.page.tags).toEqual([targetA, b?.id]);
		expect(h.api.calls.filter((c) => c.startsWith('createTag'))).toEqual(['createTag 2 B 0082c9']);
		expect(stateOf(h, s.page).metaHash).toBe(await metaHash(null, ['a', 'B']));
	});
});
