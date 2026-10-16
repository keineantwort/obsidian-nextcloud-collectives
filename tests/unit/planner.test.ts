import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import type { Collective, CollectiveId, PageId, PageInfo, Tag } from '../../src/api/types';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { pathKey, planLocalPaths } from '../../src/mapping/paths';
import type { CollectiveTree, PathPlan } from '../../src/mapping/paths';
import type { LocalFile, LocalSnapshot } from '../../src/sync/localScanner';
import { planPull } from '../../src/sync/planner';
import type { PlannerInput, PullOp, PullPlan } from '../../src/sync/planner';
import type { RemoteCollective, RemoteSnapshot } from '../../src/sync/remoteScanner';
import type { CollectiveState, PageState, SyncState } from '../../src/sync/state';

const SERVER = 'https://cloud.example.com';

// ---------------------------------------------------------------------------
// Builders. Remote hashes are 'm<id>'; state metaHash defaults to the same, so
// an unchanged page produces no operation.
// ---------------------------------------------------------------------------

function collective(id: number, name: string): Collective {
	return {
		id: asCollectiveId(id),
		circleId: `circle-${id}`,
		name,
		slug: name.toLowerCase(),
		emoji: null,
		level: 8,
		canEdit: true,
		trashTimestamp: null,
	};
}

/** Remote page with all required fields; defaults match pageState() so unchanged pages stay unchanged. */
function page(id: number, over: Partial<PageInfo> = {}): PageInfo {
	return {
		id: asPageId(id),
		slug: `seite-${id}`,
		title: `Seite ${id}`,
		emoji: null,
		tags: [],
		timestamp: 1,
		size: 0,
		fileName: `Seite ${id}.md`,
		filePath: '',
		collectivePath: '.Collectives/Coll',
		parentId: asPageId(0),
		subpageOrder: [],
		lastUserId: null,
		linkedPageIds: [],
		trashTimestamp: null,
		...over,
	};
}

/** Start page of collective 1 ("Coll"). */
function startPage(over: Partial<PageInfo> = {}): PageInfo {
	return page(1, { title: 'Coll', fileName: 'Readme.md', ...over });
}

/** Leaf page 10 "Seite" below the start page. */
function seitePage(over: Partial<PageInfo> = {}): PageInfo {
	return page(10, { title: 'Seite', fileName: 'Seite.md', parentId: asPageId(1), ...over });
}

function remoteCollective(id: number, name: string, pages: PageInfo[], tags: Tag[] = []): RemoteCollective {
	return { collective: collective(id, name), pages, tags };
}

function remote(collectives: RemoteCollective[], failed: RemoteSnapshot['failed'] = []): RemoteSnapshot {
	return { collectives, failed };
}

function tag(id: number, name: string, collectiveId: number, color = '#000000'): Tag {
	return { id: asTagId(id), collectiveId: asCollectiveId(collectiveId), name, color };
}

function pageState(p: PageInfo, collectiveId: number, localPath: string, over: Partial<PageState> = {}): PageState {
	return {
		pageId: p.id,
		collectiveId: asCollectiveId(collectiveId),
		localPath,
		localMtime: 500,
		remoteFilePath: p.filePath,
		remoteFileName: p.fileName,
		parentId: p.parentId,
		remoteEtag: `etag-${p.id}`,
		remoteMtime: p.timestamp,
		remoteSize: p.size,
		baseHash: `base-${p.id}`,
		metaHash: `m${p.id}`,
		status: 'synced',
		conflictPath: null,
		attachments: [],
		lastSyncedAt: 1,
		...over,
	};
}

function localFile(path: string, pageId: number | null, mtime = 500): LocalFile {
	return { path, mtime, pageId: pageId === null ? null : asPageId(pageId) };
}

/** Occupied set and path spellings as the scanner builds them: keys of all files and all ancestor folders. */
function localSnapshot(files: LocalFile[]): LocalSnapshot {
	const occupied = new Set<string>();
	const paths = new Map<string, string>();
	for (const file of files) {
		const parts = file.path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const path = parts.slice(0, i).join('/');
			occupied.add(pathKey(path));
			paths.set(pathKey(path), path);
		}
	}
	return { files, occupied, paths, nonEmpty: files.length > 0 };
}

function syncState(parts: { collectives?: CollectiveState[]; pages?: PageState[]; tags?: SyncState['tags'] }): SyncState {
	const collectives: Record<string, CollectiveState> = {};
	for (const c of parts.collectives ?? []) collectives[String(c.collectiveId)] = c;
	const pages: Record<string, PageState> = {};
	for (const p of parts.pages ?? []) pages[String(p.pageId)] = p;
	return { schemaVersion: 1, serverUrl: SERVER, user: 'alice', collectives, pages, tags: parts.tags ?? {} };
}

/** Remote: collective 1 "Coll" with start page 1 and leaf 10. */
function baseRemote(): RemoteSnapshot {
	return remote([remoteCollective(1, 'Coll', [startPage(), seitePage()])]);
}

/** State: everything from baseRemote() is synced at Coll/Coll.md and Coll/Seite.md. */
function baseState(): SyncState {
	return syncState({
		collectives: [{ collectiveId: asCollectiveId(1), name: 'Coll', localFolder: 'Coll' }],
		pages: [pageState(startPage(), 1, 'Coll/Coll.md'), pageState(seitePage(), 1, 'Coll/Seite.md')],
		tags: { '1': [] },
	});
}

/** Local files matching baseState(). */
function baseFiles(): LocalFile[] {
	return [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10)];
}

interface Parts {
	remote?: RemoteSnapshot;
	state?: SyncState;
	files?: LocalFile[];
}

/** Builds the planner input the way the runner does: planLocalPaths over the remote trees, state folders as known folders. */
function inputFor(parts: Parts = {}): PlannerInput {
	const remoteSnap = parts.remote ?? baseRemote();
	const state = parts.state ?? baseState();
	const files = parts.files ?? baseFiles();
	const trees: CollectiveTree[] = remoteSnap.collectives.map((rc) => ({
		collectiveId: rc.collective.id,
		name: rc.collective.name,
		pages: rc.pages,
	}));
	const knownFolders = new Map<CollectiveId, string>();
	for (const c of Object.values(state.collectives)) knownFolders.set(c.collectiveId, c.localFolder);
	const paths: PathPlan = planLocalPaths(trees, knownFolders);
	const remoteMeta = new Map<PageId, { meta: NcMeta; hash: string }>();
	for (const rc of remoteSnap.collectives) {
		for (const p of rc.pages) {
			const meta: NcMeta = {
				pageId: p.id,
				collectiveId: rc.collective.id,
				// Remote title as the runner passes it; the executor derives nc_title from the file name it writes to.
				title: p.title,
				emoji: p.emoji,
				tags: [],
			};
			remoteMeta.set(p.id, { meta, hash: `m${p.id}` });
		}
	}
	return { state, remote: remoteSnap, local: localSnapshot(files), remoteMeta, paths };
}

function planFor(parts: Parts = {}): PullPlan {
	return planPull(inputFor(parts));
}

function opsOf<K extends PullOp['kind']>(plan: PullPlan, kind: K): Extract<PullOp, { kind: K }>[] {
	return plan.ops.filter((op): op is Extract<PullOp, { kind: K }> => op.kind === kind);
}

function skipReasons(plan: PullPlan): string[] {
	return plan.skips.map((s) => s.reason);
}

function findSkip(plan: PullPlan, reason: string): PullPlan['skips'][number] | undefined {
	return plan.skips.find((s) => s.reason === reason);
}

// ---------------------------------------------------------------------------

describe('planPull: new and known pages', () => {
	it('creates a new remote page at its free target path', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
		});
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Neu.md', metaHash: 'm11' })]);
	});

	it('writes a new remote page as a conflict copy when the target path is occupied by another file', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([expect.objectContaining({ path: 'Coll/Neu.md' })]);
	});

	it('does not create a page whose target path is occupied', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', null)],
		});
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('adopts a local file with the matching nc_page_id when the state does not know the page', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Umzug.md', 11)],
		});
		expect(opsOf(plan, 'adopt')).toEqual([expect.objectContaining({ path: 'Coll/Umzug.md', metaHash: 'm11' })]);
	});

	it('updates a known page when its remote timestamp changed, with no localChanged field in the op', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md', metaChanged: false })]);
		expect(opsOf(plan, 'update')[0]).not.toHaveProperty('localChanged');
	});

	it('updates a known page whose local mtime differs from the state, with no localChanged field in the op', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10, 600)],
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
		expect(opsOf(plan, 'update')[0]).not.toHaveProperty('localChanged');
	});

	it('updates a known page when only the remote size changed', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ size: 5 })])]),
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('emits only updateMeta when only the metadata hash differs from the state', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, metaHash: 'alt' };
		const plan = planFor({ state });
		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'updateMeta', path: 'Coll/Seite.md' })]);
	});

	it('emits no operations and no skips when nothing changed, so a second run writes nothing', () => {
		const plan = planFor();
		expect(plan.ops).toEqual([]);
		expect(plan.skips).toEqual([]);
	});
});

describe('planPull: skips for moved, deleted and inconsistent pages', () => {
	it('skips remoteMoved and still updates the page at its current local path', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ fileName: 'Anders.md', timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Umzug/Seite.md', 10)],
		});
		expect(findSkip(plan, 'remoteMoved')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Umzug/Seite.md' })]);
	});

	it('skips localDeleted and does not recreate a page whose local file is gone', () => {
		const plan = planFor({ files: [localFile('Coll/Coll.md', 1)] });
		expect(findSkip(plan, 'localDeleted')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('skips remoteDeleted for a state page that is missing in a successfully scanned collective', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])]),
		});
		expect(findSkip(plan, 'remoteDeleted')).toMatchObject({ pageId: 10 });
	});

	it('does not emit operations for a page missing remotely', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage()])]),
		});
		expect(plan.ops).toEqual([]);
	});

	it('does not touch any page of a collective that failed to scan', () => {
		const plan = planFor({
			remote: remote([], [{ collective: collective(1, 'Coll'), error: new Error('timeout') }]),
		});
		expect(plan.ops).toEqual([]);
		expect(plan.skips).toEqual([]);
	});

	it('skips an orphan page and creates nothing for it', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(30, { title: 'Waise', parentId: asPageId(999) })])]),
		});
		expect(findSkip(plan, 'orphan')).toMatchObject({ pageId: 30 });
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('skips a page whose nc_page_id occurs in two local files and does not update it', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', 10), localFile('Coll/Kopie.md', 10)],
		});
		expect(findSkip(plan, 'duplicateId')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'update')).toEqual([]);
	});

	it('handles a state page with status collision via its localPath, even without nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Seite.md', null)],
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Seite.md' })]);
	});

	it('skips localDeleted for a collision page whose file at localPath is missing', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({ state, files: [localFile('Coll/Coll.md', 1)] });
		expect(findSkip(plan, 'localDeleted')).toMatchObject({ pageId: 10 });
	});
});

describe('planPull: collisions, case and foreign files', () => {
	it('finds a collision page by its localPath case-insensitively when the file carries no nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('coll/seite.md', null)],
		});
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'coll/seite.md' })]);
		expect(skipReasons(plan)).not.toContain('localDeleted');
	});

	it('ignores a file with an nc_page_id at the collision path and skips the page as localDeleted', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'collision', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('coll/seite.md', 10)],
		});
		expect(findSkip(plan, 'localDeleted')).toMatchObject({ pageId: 10 });
		expect(opsOf(plan, 'update')).toEqual([]);
	});

	it('finds a conflict page after its file was renamed by the user, via its nc_page_id', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, status: 'conflict', baseHash: '', localPath: 'Coll/Seite.md' };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage({ timestamp: 2 })])]),
			files: [localFile('Coll/Coll.md', 1), localFile('Coll/Umbenannt.md', 10)],
		});
		expect(plan.skips).toEqual([]);
		expect(opsOf(plan, 'update')).toEqual([expect.objectContaining({ path: 'Coll/Umbenannt.md' })]);
	});

	it('creates a new page at a free suffix in the same folder when the target holds a file with another nc_page_id', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('Coll/Neu.md', 99)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([]);
		expect(opsOf(plan, 'create')).toEqual([expect.objectContaining({ path: 'Coll/Neu (2).md', metaHash: 'm11' })]);
	});

	it('plans no two creates for the same path and no conflict copy when a suffixed name is claimed in the plan', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [
					startPage(),
					seitePage(),
					page(11, { title: 'Neu', fileName: 'Neu.md', parentId: asPageId(1) }),
					page(12, { title: 'Neu', fileName: 'Neu (2).md', parentId: asPageId(1) }),
				]),
			]),
			files: [...baseFiles(), localFile('Coll/Neu.md', 99)],
		});
		const creates = opsOf(plan, 'create').map((op) => op.path);
		expect(opsOf(plan, 'createConflict')).toEqual([]);
		expect(new Set(creates).size).toBe(creates.length);
	});

	it('writes a new page as conflict copy at the path of a user file that differs from the target only in case', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), page(11, { title: 'Neu', parentId: asPageId(1) })])]),
			files: [...baseFiles(), localFile('coll/neu.md', null)],
		});
		expect(opsOf(plan, 'createConflict')).toEqual([expect.objectContaining({ path: 'coll/neu.md' })]);
		expect(opsOf(plan, 'create')).toEqual([]);
	});

	it('uses the spelling on disk for the folder of a new collective and for the paths below it', () => {
		const plan = planFor({
			state: syncState({}),
			remote: remote([
				remoteCollective(2, 'Coll', [startPage({ id: asPageId(20) }), page(21, { title: 'Neu', parentId: asPageId(20) })]),
			]),
			files: [localFile('coll/Altes.md', null)],
		});
		expect(opsOf(plan, 'saveCollective')).toEqual([
			expect.objectContaining({ collective: { collectiveId: 2, name: 'Coll', localFolder: 'coll' } }),
		]);
		expect(opsOf(plan, 'ensureFolder').map((op) => op.path)).not.toContain('Coll');
		expect(opsOf(plan, 'create').map((op) => op.path).sort()).toEqual(['coll/Coll.md', 'coll/Neu.md']);
	});
});

describe('planPull: collectives', () => {
	it('emits ensureFolder and saveCollective before any page operation for a new collective', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), seitePage()]),
				remoteCollective(2, 'Neu', [startPage({ id: asPageId(20), title: 'Neu' })]),
			]),
		});
		const saveIndex = plan.ops.findIndex((op) => op.kind === 'saveCollective');
		const folderIndex = plan.ops.findIndex((op) => op.kind === 'ensureFolder' && op.path === 'Neu');
		const createIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Neu/Neu.md');
		expect(folderIndex).toBeGreaterThanOrEqual(0);
		expect(saveIndex).toBeGreaterThan(folderIndex);
		expect(createIndex).toBeGreaterThan(saveIndex);
	});

	it('saves the new collective with its folder and name in the state', () => {
		const plan = planFor({
			remote: remote([
				remoteCollective(1, 'Coll', [startPage(), seitePage()]),
				remoteCollective(2, 'Neu', [startPage({ id: asPageId(20), title: 'Neu' })]),
			]),
		});
		expect(opsOf(plan, 'saveCollective')).toEqual([
			expect.objectContaining({ collective: { collectiveId: 2, name: 'Neu', localFolder: 'Neu' } }),
		]);
	});

	it('skips collectiveRenamed and keeps the state folder when the remote name differs', () => {
		const state = baseState();
		state.collectives['1'] = { collectiveId: asCollectiveId(1), name: 'Alt', localFolder: 'Coll' };
		const plan = planFor({ state });
		expect(findSkip(plan, 'collectiveRenamed')).toMatchObject({ collectiveId: 1 });
		expect(opsOf(plan, 'saveCollective')).toEqual([]);
	});

	it('skips collectiveRemoved for a state collective that is neither listed nor failed', () => {
		const state = baseState();
		const alt = page(50, { title: 'Alt', parentId: asPageId(0), fileName: 'Readme.md' });
		state.collectives['2'] = { collectiveId: asCollectiveId(2), name: 'Alt', localFolder: 'Alt' };
		state.pages['50'] = pageState(alt, 2, 'Alt/Alt.md');
		const plan = planFor({ state });
		expect(skipReasons(plan)).toEqual(['collectiveRemoved']);
		expect(findSkip(plan, 'collectiveRemoved')).toMatchObject({ collectiveId: 2 });
	});

	it('saves tags when the remote tag list differs from the cache', () => {
		const plan = planFor({
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage()], [tag(3, 'Projekt', 1, '#ff0000')])]),
		});
		expect(opsOf(plan, 'saveTags')).toEqual([
			expect.objectContaining({ collectiveId: 1, tags: [{ id: asTagId(3), name: 'Projekt', color: '#ff0000' }] }),
		]);
	});

	it('does not save tags when the cache already matches the remote tag list', () => {
		const state = baseState();
		state.tags = { '1': [{ id: asTagId(3), name: 'Projekt', color: '#ff0000' }] };
		const plan = planFor({
			state,
			remote: remote([remoteCollective(1, 'Coll', [startPage(), seitePage()], [tag(3, 'Projekt', 1, '#ff0000')])]),
		});
		expect(opsOf(plan, 'saveTags')).toEqual([]);
	});
});

describe('planPull: order of operations', () => {
	/** New collective-1 folder page "A" (id 3) with leaf "C" (id 4) below it, plus flat leaf "Flach" (id 5). */
	function nestedRemote(): RemoteSnapshot {
		const folder = page(3, { title: 'A', fileName: 'Readme.md', parentId: asPageId(1) });
		const deep = page(4, { title: 'C', fileName: 'C.md', parentId: asPageId(3), filePath: 'A' });
		const flat = page(5, { title: 'Flach', fileName: 'Flach.md', parentId: asPageId(1) });
		return remote([remoteCollective(1, 'Coll', [startPage(), seitePage(), folder, deep, flat])]);
	}

	it('emits ensureFolder for a missing parent folder before the create of a file inside it', () => {
		const plan = planFor({ remote: nestedRemote() });
		const folderIndex = plan.ops.findIndex((op) => op.kind === 'ensureFolder' && op.path === 'Coll/A');
		const createIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/A/A.md');
		expect(folderIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(folderIndex);
	});

	it('orders page operations by target depth, so the flat file comes before the nested one', () => {
		const plan = planFor({ remote: nestedRemote() });
		const flatIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/Flach.md');
		const deepIndex = plan.ops.findIndex((op) => op.kind === 'create' && op.path === 'Coll/A/C.md');
		expect(flatIndex).toBeGreaterThanOrEqual(0);
		expect(deepIndex).toBeGreaterThan(flatIndex);
	});
});
