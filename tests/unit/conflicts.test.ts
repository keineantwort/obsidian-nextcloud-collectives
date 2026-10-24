import { describe, expect, it } from 'vitest';
import { asAttachmentId, asCollectiveId, asPageId } from '../../src/api/types';
import type { PageId } from '../../src/api/types';
import { readPageId, replaceNcMeta, toRemote } from '../../src/mapping/frontmatter';
import { LinkIndex } from '../../src/mapping/links';
import { pathKey } from '../../src/mapping/paths';
import { applyResolution, countConflicts, listConflicts, resolveConflict, withCurrentPaths } from '../../src/sync/conflicts';
import type { ConflictEntry, ResolutionVault } from '../../src/sync/conflicts';
import { emptyState } from '../../src/sync/state';
import type { PageState, SyncState } from '../../src/sync/state';
import { sha256Hex } from '../../src/util/hash';
import { Logger } from '../../src/util/logger';
import { MemoryVault } from '../fakes/memoryVault';

const SERVER = 'https://cloud.example.com';
const COLLECTIVE = asCollectiveId(1);
const PAGE_ID = asPageId(10);
const NOTE_PATH = 'Coll/Notiz.md';
const NOTE_CONFLICT = 'Coll/Notiz (Konflikt 2026-10-16 1430).md';
const LOCAL_TEXT = '# Notiz\n\nMein Text\n';
const REMOTE_TEXT = '# Notiz\n\nText vom Server\n';

/** Complete PageState with every field set; override what a test needs. */
function pageState(id: number, over: Partial<PageState> = {}): PageState {
	return {
		pageId: asPageId(id),
		collectiveId: COLLECTIVE,
		localPath: `Coll/Seite ${id}.md`,
		localMtime: 1700,
		remoteFilePath: '',
		remoteFileName: `Seite ${id}.md`,
		parentId: asPageId(1),
		remoteEtag: `etag-${id}`,
		remoteMtime: 1792138978,
		remoteSize: 324,
		baseHash: `base-${id}`,
		metaHash: `meta-${id}`,
		status: 'synced',
		conflictPath: null,
		attachments: [{ id: asAttachmentId(7), name: 'bild.png', etag: 'a-etag', localPath: 'Coll/.attachments.10/bild.png', hash: 'h' }],
		lastSyncedAt: 1792138999000,
		...over,
	};
}

/** State with the given pages keyed by their ids. */
function stateWith(...pages: PageState[]): SyncState {
	const state = emptyState(SERVER, 'alice');
	state.collectives['1'] = { collectiveId: COLLECTIVE, name: 'Coll', localFolder: 'Coll' };
	for (const page of pages) state.pages[String(page.pageId)] = page;
	return state;
}

/** Vault fake: MemoryVault plus a trash that removes the file and records the path. */
class RecordingVault extends MemoryVault {
	readonly trashed: string[] = [];
	trashError: Error | null = null;

	/** Removes a file from the in-memory vault (test-only helper, not part of MemoryVault). */
	remove(path: string): void {
		this['files'].delete(pathKey(path));
	}
}

function resolutionVault(vault: RecordingVault): ResolutionVault {
	return {
		read: (path) => vault.read(path),
		process: (path, fn) => vault.process(path, fn),
		exists: (path) => vault.exists(path),
		trash: async (path) => {
			if (vault.trashError) throw vault.trashError;
			vault.remove(path);
			vault.trashed.push(path);
		},
	};
}

/** Fresh deps and a helper to run applyResolution against them. */
function setup(state: SyncState, vault: RecordingVault = new RecordingVault()) {
	const log = new Logger();
	const deps = { vault: resolutionVault(vault), state, log };
	return { vault, log, state, deps, resolve: (id: PageId, choice: 'keepLocal' | 'takeRemote') => applyResolution(deps, id, choice) };
}

describe('listConflicts', () => {
	it('lists only conflict and collision pages, sorted by local path', () => {
		const state = stateWith(
			pageState(1, { status: 'conflict', localPath: 'Coll/Zeta.md', conflictPath: 'Coll/Zeta (Konflikt 2026-10-16 1430).md' }),
			pageState(2, { status: 'synced', localPath: 'Coll/Mitte.md' }),
			pageState(3, { status: 'collision', localPath: 'Coll/Alpha.md', baseHash: '' }),
		);

		expect(listConflicts(state)).toEqual([
			{
				pageId: asPageId(3),
				collectiveId: COLLECTIVE,
				status: 'collision',
				localPath: 'Coll/Alpha.md',
				conflictPath: null,
				baseHash: '',
			},
			{
				pageId: asPageId(1),
				collectiveId: COLLECTIVE,
				status: 'conflict',
				localPath: 'Coll/Zeta.md',
				conflictPath: 'Coll/Zeta (Konflikt 2026-10-16 1430).md',
				baseHash: 'base-1',
			},
		]);
	});

	it('returns an empty list when no page is in conflict', () => {
		expect(listConflicts(stateWith(pageState(1), pageState(2)))).toEqual([]);
	});
});

/** Conflict or collision entry as listConflicts returns it. */
function conflictEntry(id: number, over: Partial<ConflictEntry> = {}): ConflictEntry {
	return {
		pageId: asPageId(id),
		collectiveId: COLLECTIVE,
		status: 'conflict',
		localPath: `Coll/Seite ${id}.md`,
		conflictPath: `Coll/Seite ${id} (Konflikt 2026-10-16 1430).md`,
		...over,
	};
}

describe('applyResolution: links', () => {
	it('takeRemote hashes the note in the remote format when it has the page index', async () => {
		const vault = new RecordingVault();
		const text = 'Siehe [[Coll/Ziel]]\n';
		vault.seed(NOTE_PATH, text);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const index = new LinkIndex([
			{ pageId: PAGE_ID, collectiveId: COLLECTIVE, collectiveSlug: 'coll', slug: 'notiz', landing: false, title: 'Notiz', remotePath: 'Notiz.md', localPath: NOTE_PATH },
			{ pageId: asPageId(11), collectiveId: COLLECTIVE, collectiveSlug: 'coll', slug: 'ziel', landing: false, title: 'Ziel', remotePath: 'Ziel.md', localPath: 'Coll/Ziel.md' },
		]);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT })), vault);

		await applyResolution({ ...ctx.deps, links: index }, PAGE_ID, 'takeRemote');

		const expected = await sha256Hex('Siehe [Ziel](Ziel.md?fileId=11)');
		expect(ctx.state.pages['10']?.baseHash).toBe(expected);
	});
});

describe('withCurrentPaths', () => {
	it('gives a conflict the path of the only file that carries its nc_page_id', () => {
		const entries = [conflictEntry(10, { localPath: 'Coll/Neue Seite.md' })];

		expect(withCurrentPaths(entries, [{ path: 'Coll/Neuer Titel.md', pageId: asPageId(10) }])).toEqual([
			{ ...entries[0], localPath: 'Coll/Neuer Titel.md' },
		]);
	});

	it('keeps the localPath of a conflict when no file carries its nc_page_id', () => {
		const entries = [conflictEntry(10, { localPath: 'Coll/Neue Seite.md' })];

		expect(withCurrentPaths(entries, [{ path: 'Coll/Andere.md', pageId: asPageId(11) }, { path: 'Coll/Ohne.md', pageId: null }])).toEqual(entries);
	});

	it('keeps the localPath of a conflict when two files carry its nc_page_id', () => {
		const entries = [conflictEntry(10, { localPath: 'Coll/Neue Seite.md' })];
		const files = [
			{ path: 'Coll/Kopie A.md', pageId: asPageId(10) },
			{ path: 'Coll/Kopie B.md', pageId: asPageId(10) },
		];

		expect(withCurrentPaths(entries, files)).toEqual(entries);
	});

	it('ignores files with the nc_page_id for a collision and keeps its localPath', () => {
		const entries = [conflictEntry(10, { status: 'collision', localPath: 'Coll/Alt.md', conflictPath: null })];

		expect(withCurrentPaths(entries, [{ path: 'Coll/Neu.md', pageId: asPageId(10) }])).toEqual(entries);
	});

	it('sorts the result by the current local path', () => {
		const entries = [
			conflictEntry(1, { localPath: 'Coll/Zeta.md' }),
			conflictEntry(2, { status: 'collision', localPath: 'Coll/Mitte.md', conflictPath: null }),
		];

		const result = withCurrentPaths(entries, [{ path: 'Coll/Alpha.md', pageId: asPageId(1) }]);

		expect(result.map((entry) => entry.localPath)).toEqual(['Coll/Alpha.md', 'Coll/Mitte.md']);
		expect(result.map((entry) => entry.pageId)).toEqual([asPageId(1), asPageId(2)]);
	});

	it('does not change the entries it is given', () => {
		const entries = [conflictEntry(10, { localPath: 'Coll/Neue Seite.md' })];

		withCurrentPaths(entries, [{ path: 'Coll/Neuer Titel.md', pageId: asPageId(10) }]);

		expect(entries[0]?.localPath).toBe('Coll/Neue Seite.md');
	});
});

describe('applyResolution with a renamed local file', () => {
	const OLD_PATH = 'Coll/Alt.md';
	const NEW_PATH = 'Coll/Neu.md';
	const NEW_CONFLICT = 'Coll/Neu (Konflikt 2026-10-16 1430).md';
	const NEW_TEXT = replaceNcMeta('# Neu\n\nUmbenannt vom Nutzer\n', {
		pageId: PAGE_ID,
		collectiveId: COLLECTIVE,
		title: null,
		emoji: null,
		tags: [],
	});

	/** The state still has the old path; the file was renamed to NEW_PATH and keeps its nc_page_id. */
	function renamedSetup() {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NEW_PATH, NEW_TEXT);
		vault.seed(NEW_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: OLD_PATH, conflictPath: NEW_CONFLICT })), vault);
		return { vault, ctx };
	}

	it('takeRemote reads the renamed file, hashes its text and trashes the conflict copy', async () => {
		const { vault, ctx } = renamedSetup();

		expect(await applyResolution(ctx.deps, PAGE_ID, 'takeRemote', { localPath: NEW_PATH })).toBe(true);

		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null, baseHash: await sha256Hex(toRemote(NEW_TEXT)) });
		expect(vault.trashed).toEqual([NEW_CONFLICT]);
	});

	it('keepLocal succeeds for the renamed file and trashes the conflict copy', async () => {
		const { vault, ctx } = renamedSetup();

		expect(await applyResolution(ctx.deps, PAGE_ID, 'keepLocal', { localPath: NEW_PATH })).toBe(true);

		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null, baseHash: 'base-10' });
		expect(vault.trashed).toEqual([NEW_CONFLICT]);
	});

	it('keeps the old localPath in the state', async () => {
		const { ctx } = renamedSetup();

		await applyResolution(ctx.deps, PAGE_ID, 'takeRemote', { localPath: NEW_PATH });

		expect(ctx.state.pages['10']?.localPath).toBe(OLD_PATH);
	});

	it('without the path it fails on the old path, which is gone', async () => {
		const { ctx } = renamedSetup();

		await expect(applyResolution(ctx.deps, PAGE_ID, 'keepLocal')).rejects.toThrow();
	});
});

describe('countConflicts', () => {
	it('counts conflict and collision pages together', () => {
		const state = stateWith(
			pageState(1, { status: 'conflict' }),
			pageState(2, { status: 'collision' }),
			pageState(3, { status: 'synced' }),
		);

		expect(countConflicts(state)).toBe(2);
	});

	it('is 0 when all pages are synced', () => {
		expect(countConflicts(stateWith(pageState(1)))).toBe(0);
	});
});

describe('resolveConflict', () => {
	it('keepLocal sets status synced, clears the conflict copy, keeps the base of the conflict and marks the local mtime unchecked', () => {
		const prev = pageState(10, { status: 'conflict', conflictPath: NOTE_CONFLICT, baseHash: 'old-base', localMtime: 1700 });

		expect(resolveConflict(prev, 'keepLocal', 'local-hash')).toEqual({
			...prev,
			status: 'synced',
			conflictPath: null,
			baseHash: 'old-base',
			localMtime: -1,
		});
	});

	it('keepLocal keeps the base hash of the remote text the conflict was recorded against, so the next run sees the remote as unchanged', () => {
		const prev = pageState(10, { status: 'conflict', conflictPath: NOTE_CONFLICT, baseHash: 'hash-of-remote-text' });

		expect(resolveConflict(prev, 'keepLocal', 'local-hash').baseHash).toBe('hash-of-remote-text');
	});

	it('keepLocal leaves the remote fields untouched', () => {
		const prev = pageState(10, { status: 'conflict', conflictPath: NOTE_CONFLICT, remoteEtag: '"remote-etag"', remoteMtime: 1792138978, remoteSize: 99 });

		const next = resolveConflict(prev, 'keepLocal', 'local-hash');

		expect(next).toMatchObject({ remoteEtag: '"remote-etag"', remoteMtime: 1792138978, remoteSize: 99 });
	});

	it('takeRemote sets the base to the given local hash, forgets the metadata base, marks the remote mtime unconfirmed and keeps the local mtime', () => {
		const prev = pageState(10, { status: 'conflict', conflictPath: NOTE_CONFLICT, baseHash: '', localMtime: 1700 });

		expect(resolveConflict(prev, 'takeRemote', 'local-hash')).toEqual({
			...prev,
			status: 'synced',
			conflictPath: null,
			baseHash: 'local-hash',
			remoteMtime: -1,
			localMtime: 1700,
			metaHash: '',
		});
	});

	it('takeRemote keeps the remote etag, which the next run uses to detect a remote change', () => {
		const prev = pageState(10, { status: 'collision', remoteEtag: '"remote-etag"' });

		expect(resolveConflict(prev, 'takeRemote', 'local-hash').remoteEtag).toBe('"remote-etag"');
	});

	it('does not mutate the previous page state', () => {
		const prev = pageState(10, { status: 'conflict', conflictPath: NOTE_CONFLICT, baseHash: 'old-base' });
		const snapshot = structuredClone(prev);

		resolveConflict(prev, 'keepLocal', 'local-hash');

		expect(prev).toEqual(snapshot);
	});
});

describe('applyResolution', () => {
	it('keepLocal leaves the local file unchanged and trashes the conflict copy', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT })), vault);

		await ctx.resolve(PAGE_ID, 'keepLocal');

		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(vault.exists(NOTE_CONFLICT)).toBe(false);
		expect(vault.trashed).toEqual([NOTE_CONFLICT]);
	});

	it('keepLocal returns true and stores the page as synced without conflict copy', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, localMtime: 1700 })), vault);

		expect(await ctx.resolve(PAGE_ID, 'keepLocal')).toBe(true);

		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null, baseHash: 'base-10', localMtime: -1 });
	});

	it('takeRemote keeps the local text, sets the base to its hash and trashes the conflict copy', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, localMtime: 1700 })), vault);

		expect(await ctx.resolve(PAGE_ID, 'takeRemote')).toBe(true);

		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(vault.trashed).toEqual([NOTE_CONFLICT]);
		expect(ctx.state.pages['10']).toMatchObject({
			status: 'synced',
			conflictPath: null,
			baseHash: await sha256Hex(toRemote(LOCAL_TEXT)),
			remoteMtime: -1,
			localMtime: 1700,
		});
	});

	it('collision + takeRemote writes nc_page_id into the user file', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'collision', localPath: NOTE_PATH, baseHash: '', metaHash: 'old-meta' })), vault);

		await ctx.resolve(PAGE_ID, 'takeRemote');

		expect(readPageId(await vault.read(NOTE_PATH))).toBe(PAGE_ID);
	});

	it('collision + takeRemote writes exactly the minimal nc fields in front of the user text', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'collision', localPath: NOTE_PATH, baseHash: '' })), vault);

		await ctx.resolve(PAGE_ID, 'takeRemote');

		expect(await vault.read(NOTE_PATH)).toBe(
			replaceNcMeta(LOCAL_TEXT, { pageId: PAGE_ID, collectiveId: COLLECTIVE, title: null, emoji: null, tags: [] }),
		);
	});

	it('collision + takeRemote resets metaHash and sets baseHash to the hash of the text with nc fields', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'collision', localPath: NOTE_PATH, baseHash: '', metaHash: 'old-meta' })), vault);

		await ctx.resolve(PAGE_ID, 'takeRemote');

		const written = await vault.read(NOTE_PATH);
		expect(ctx.state.pages['10']).toMatchObject({
			status: 'synced',
			metaHash: '',
			baseHash: await sha256Hex(toRemote(written)),
		});
	});

	it('collision + keepLocal also links the user file by writing nc_page_id', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'collision', localPath: NOTE_PATH, baseHash: '' })), vault);

		await ctx.resolve(PAGE_ID, 'keepLocal');

		expect(readPageId(await vault.read(NOTE_PATH))).toBe(PAGE_ID);
		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', baseHash: '', localMtime: -1 });
	});

	it('returns false and leaves the state unchanged for a page id that is not in the state', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT })), vault);
		const before = structuredClone(ctx.state);

		expect(await ctx.resolve(asPageId(99), 'keepLocal')).toBe(false);

		expect(ctx.state).toEqual(before);
		expect(vault.trashed).toEqual([]);
	});

	it('returns false and leaves a synced page and its file unchanged', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'synced', localPath: NOTE_PATH })), vault);
		const before = structuredClone(ctx.state);

		expect(await ctx.resolve(PAGE_ID, 'takeRemote')).toBe(false);

		expect(ctx.state).toEqual(before);
		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(vault.trashed).toEqual([]);
	});

	it('resolves a conflict whose conflict copy is already gone without trashing anything', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT })), vault);

		expect(await ctx.resolve(PAGE_ID, 'keepLocal')).toBe(true);

		expect(vault.trashed).toEqual([]);
		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null });
	});

	it('still resolves the conflict when trashing the conflict copy throws, and logs the failure', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		vault.trashError = new Error('trash is not available');
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT })), vault);

		expect(await ctx.resolve(PAGE_ID, 'keepLocal')).toBe(true);

		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null, baseHash: 'base-10' });
		expect(ctx.log.entries().some((entry) => entry.level === 'warn' || entry.level === 'error')).toBe(true);
	});
});

describe('applyResolution with the conflict copy the dialog shows', () => {
	const OLDER_COPY = 'Coll/Notiz (Konflikt 2026-10-16 1200).md';

	/** The page's current conflict is NOTE_CONFLICT; the dialog may still show an older copy. */
	function currentConflict() {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, baseHash: 'base-hash' })), vault);
		return { vault, ctx };
	}

	it('refuses a choice made on a conflict copy that is no longer the page conflict, and changes neither state nor files', async () => {
		const { vault, ctx } = currentConflict();
		const before = structuredClone(ctx.state);

		const applied = await applyResolution(ctx.deps, PAGE_ID, 'keepLocal', { localPath: NOTE_PATH, expectedConflictPath: OLDER_COPY });

		expect(applied).toBe(false);
		expect(ctx.state).toEqual(before);
		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(await vault.read(NOTE_CONFLICT)).toBe(REMOTE_TEXT);
		expect(vault.trashed).toEqual([]);
	});

	it('resolves when the copy the dialog shows is the current conflict copy of the page', async () => {
		const { vault, ctx } = currentConflict();

		const applied = await applyResolution(ctx.deps, PAGE_ID, 'takeRemote', { localPath: NOTE_PATH, expectedConflictPath: NOTE_CONFLICT });

		expect(applied).toBe(true);
		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null });
		expect(vault.trashed).toEqual([NOTE_CONFLICT]);
	});
});

describe('applyResolution keepLocal on a state written before M4', () => {
	it('sets the base to the hash of the conflict copy text, so the next run compares against the remote text the user saw', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, baseHash: '' })), vault);

		await ctx.resolve(PAGE_ID, 'keepLocal');

		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null, baseHash: await sha256Hex(toRemote(REMOTE_TEXT)) });
		expect(vault.trashed).toEqual([NOTE_CONFLICT]);
	});
});

describe('applyResolution with expectedBaseHash', () => {
	it('refuses a choice made on a conflict copy that was updated since, and changes neither state nor files', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, baseHash: 'base-new' })), vault);
		const before = structuredClone(ctx.state);

		const applied = await applyResolution(ctx.deps, PAGE_ID, 'keepLocal', {
			localPath: NOTE_PATH,
			expectedConflictPath: NOTE_CONFLICT,
			expectedBaseHash: 'base-old',
		});

		expect(applied).toBe(false);
		expect(ctx.state).toEqual(before);
		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(await vault.read(NOTE_CONFLICT)).toBe(REMOTE_TEXT);
		expect(vault.trashed).toEqual([]);
	});

	it('resolves as before when the expected base hash equals the page base hash', async () => {
		const vault = new RecordingVault();
		vault.seedFolder('Coll');
		vault.seed(NOTE_PATH, LOCAL_TEXT);
		vault.seed(NOTE_CONFLICT, REMOTE_TEXT);
		const ctx = setup(stateWith(pageState(10, { status: 'conflict', localPath: NOTE_PATH, conflictPath: NOTE_CONFLICT, baseHash: 'base-now' })), vault);

		const applied = await applyResolution(ctx.deps, PAGE_ID, 'keepLocal', {
			localPath: NOTE_PATH,
			expectedConflictPath: NOTE_CONFLICT,
			expectedBaseHash: 'base-now',
		});

		expect(applied).toBe(true);
		expect(ctx.state.pages['10']).toMatchObject({ status: 'synced', conflictPath: null });
		expect(await vault.read(NOTE_PATH)).toBe(LOCAL_TEXT);
		expect(vault.trashed).toEqual([NOTE_CONFLICT]);
	});
});
