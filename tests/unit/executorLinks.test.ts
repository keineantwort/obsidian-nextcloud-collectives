// M7 (PLAN §9): the executor converts page links on pull and push and hashes the remote format.
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import type { PageInfo } from '../../src/api/types';
import { canonicalRemote, replaceNcMeta } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { LinkIndex } from '../../src/mapping/links';
import { executeSync } from '../../src/sync/executor';
import type { ExecutorDeps } from '../../src/sync/executor';
import type { SyncOp, SyncPlan } from '../../src/sync/planner';
import { emptyState } from '../../src/sync/state';
import { sha256Hex } from '../../src/util/hash';
import { Logger } from '../../src/util/logger';
import { FakeDav } from '../fakes/fakeDav';
import { MemoryVault } from '../fakes/memoryVault';

const META_HASH = '97294f05c3603881a6466e787eb8726dde04588d242bea02914b0f0a8e12bdb2';
const SRC_PATH = 'Coll/Start.md';
const DST_PATH = 'Coll/Ziel.md';

function page(id: number, title: string): PageInfo {
	return {
		id: asPageId(id), slug: title, title, emoji: null, tags: [], timestamp: 1000, size: 20, fileName: `${title}.md`, filePath: '',
		collectivePath: '.Collectives/Coll', parentId: asPageId(1), subpageOrder: [], lastUserId: null, linkedPageIds: [], trashTimestamp: null,
	};
}

const SRC = page(10, 'Start');
const DST = page(11, 'Ziel');
const index = new LinkIndex([SRC, DST].map((p) => ({
	pageId: p.id, collectiveId: asCollectiveId(1), collectiveSlug: 'coll', slug: p.slug, landing: false, title: p.title,
	remotePath: p.fileName, localPath: `Coll/${p.fileName}`,
})));
const meta = (id: number): NcMeta => ({ pageId: asPageId(id), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] });

function harness(): { vault: MemoryVault; dav: FakeDav; deps: ExecutorDeps } {
	const vault = new MemoryVault();
	const dav = new FakeDav();
	vault.seedFolder('Coll');
	const deps: ExecutorDeps = {
		vault, webdav: dav.webdav, links: index, state: emptyState('https://cloud.example.com', 'alice'), persist: async () => undefined,
		now: () => new Date(2026, 9, 17, 12, 0), conflictLabel: 'Konflikt', strategy: 'conflictFile', sleep: async () => undefined,
		log: new Logger(), occupied: new Set<string>(),
	};
	return { vault, dav, deps };
}

const plan = (ops: SyncOp[]): SyncPlan => ({ ops, skips: [], proposals: [], followUp: false });
const REMOTE = 'Siehe [Ziel](Ziel.md?fileId=11) und [Doku](/index.php/apps/collectives/coll-1/Ziel-11#abschnitt).\n';

describe('executor: links', () => {
	it('pull writes wikilinks and records the remote format as base', async () => {
		const { vault, dav, deps } = harness();
		dav.serve(SRC, REMOTE, '"e1"');

		await executeSync(plan([{ kind: 'create', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);

		const body = (await vault.read(SRC_PATH)).split('\n---\n')[1];
		expect(body).toBe('Siehe [[Coll/Ziel]] und [[Coll/Ziel#abschnitt|Doku]].\n');
		expect(deps.state.pages['10']?.baseHash).toBe(await sha256Hex(canonicalRemote(REMOTE, { index, sourceId: SRC.id })));
	});

	it('push sends the remote format', async () => {
		const { vault, dav, deps } = harness();
		dav.serve(SRC, 'Alt\n', '"e1"');
		await executeSync(plan([{ kind: 'create', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);
		const written = await vault.read(SRC_PATH);
		await vault.process(SRC_PATH, () => replaceNcMeta('Neu: [[Coll/Ziel|das Ziel]] und [[Tagebuch]]\n', meta(10)));
		expect(written).not.toBe(await vault.read(SRC_PATH));

		const state = deps.state.pages['10'];
		if (state === undefined) throw new Error('no state');
		const result = await executeSync(plan([{ kind: 'push', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);

		expect(result.pushed).toBe(1);
		expect(dav.files.get('.Collectives/Coll/Start.md')?.content).toBe('Neu: [das Ziel](Ziel.md?fileId=11) und [[Tagebuch]]');
	});

	it('a second run on the pulled file finds nothing to push', async () => {
		const { dav, deps } = harness();
		dav.serve(SRC, REMOTE, '"e1"');
		await executeSync(plan([{ kind: 'create', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);

		const result = await executeSync(plan([{ kind: 'push', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);

		expect(result.pushed).toBe(0);
		expect(dav.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
	});

	it('writes a conflict copy with wikilinks', async () => {
		const { vault, dav, deps } = harness();
		vault.seed(SRC_PATH, 'Mein Text\n');
		dav.serve(SRC, REMOTE, '"e1"');

		await executeSync(plan([{ kind: 'createConflict', page: SRC, path: SRC_PATH, meta: meta(10), metaHash: META_HASH }]), deps);

		const copy = deps.state.pages['10']?.conflictPath;
		expect(await vault.read(copy ?? '')).toBe('Siehe [[Coll/Ziel]] und [[Coll/Ziel#abschnitt|Doku]].');
	});
});
