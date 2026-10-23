// M8 (architecture §9.4, ADR 0021): the executor transfers, compares and deletes attachments after the content step of a page.
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import type { PageInfo } from '../../src/api/types';
import { AttachmentIndex, attachmentFolderFor, isAttachmentFile } from '../../src/mapping/attachments';
import { replaceNcMeta } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { LinkIndex } from '../../src/mapping/links';
import { executeSync } from '../../src/sync/executor';
import type { ExecutorDeps } from '../../src/sync/executor';
import type { SyncOp, SyncPlan } from '../../src/sync/planner';
import { emptyState } from '../../src/sync/state';
import { ServerError } from '../../src/util/errors';
import { sha256HexBytes } from '../../src/util/hash';
import { Logger } from '../../src/util/logger';
import { FakeAttachmentDav, bytes, textOf } from '../fakes/fakeAttachments';
import { FakeDav } from '../fakes/fakeDav';
import { MemoryVault } from '../fakes/memoryVault';

const META_HASH = '97294f05c3603881a6466e787eb8726dde04588d242bea02914b0f0a8e12bdb2';
const NOTE = 'Coll/Start.md';
const FOLDER = 'Coll/_attachments/Start';
const REMOTE_FOLDER = '.Collectives/Coll/.attachments.10';
const MB = 1024 * 1024;

const PAGE: PageInfo = {
	id: asPageId(10), slug: 'Start', title: 'Start', emoji: null, tags: [], timestamp: 1000, size: 20, fileName: 'Start.md', filePath: '',
	collectivePath: '.Collectives/Coll', parentId: asPageId(1), subpageOrder: [], lastUserId: null, linkedPageIds: [], trashTimestamp: null,
};
const meta: NcMeta = { pageId: asPageId(10), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] };

interface Options { maxBytes?: number; deleteRemote?: boolean; remoteDelete?: 'obsidianTrash' | 'keepUnlinked' }

class Harness {
	readonly vault = new MemoryVault();
	readonly dav = new FakeDav();
	readonly att = new FakeAttachmentDav();
	readonly deps: ExecutorDeps;

	constructor(readonly options: Options = {}) {
		this.vault.seedFolder('Coll');
		this.deps = {
			vault: this.vault,
			webdav: this.dav.webdav,
			attachments: undefined,
			state: emptyState('https://cloud.example.com', 'alice'),
			persist: async () => undefined,
			now: () => new Date(2026, 9, 17, 12, 0),
			conflictLabel: 'Konflikt',
			strategy: 'conflictFile',
			sleep: async () => undefined,
			log: new Logger(),
			occupied: new Set<string>(),
		};
	}

	/** One sync pass: the index is built from the vault and the state like the runner does at the start of a pass. */
	async run(ops: SyncOp[]): ReturnType<typeof executeSync> {
		const maxBytes = this.options.maxBytes ?? 20 * MB;
		const known = new Map(Object.values(this.deps.state.pages).map((s) => [s.pageId, s.attachments.map((a) => ({ name: a.name, localPath: a.localPath }))]));
		const files = this.vault.listFiles().filter((f) => isAttachmentFile(f.path)).map((f) => ({ path: f.path, size: f.size }));
		const attachments = new AttachmentIndex({ files, folders: new Map([[PAGE.id, attachmentFolderFor(NOTE, '_attachments/{title}')]]), known, maxBytes });
		this.deps.links = new LinkIndex([{
			pageId: PAGE.id, collectiveId: asCollectiveId(1), collectiveSlug: 'coll', slug: 'Start', landing: false, title: 'Start',
			remotePath: 'Start.md', localPath: NOTE,
		}], undefined, attachments);
		this.deps.attachments = {
			options: { pattern: '_attachments/{title}', maxBytes },
			deleteRemote: this.options.deleteRemote ?? true,
			remoteDelete: this.options.remoteDelete ?? 'obsidianTrash',
			webdav: this.att.webdav,
			api: this.att.api,
		};
		const plan: SyncPlan = { ops, skips: [], proposals: [], followUp: false };
		return executeSync(plan, this.deps);
	}

	create(): Promise<Awaited<ReturnType<typeof executeSync>>> {
		return this.run([{ kind: 'create', page: PAGE, path: NOTE, meta, metaHash: META_HASH }]);
	}

	push(): Promise<Awaited<ReturnType<typeof executeSync>>> {
		return this.run([{ kind: 'push', page: PAGE, path: NOTE, meta, metaHash: META_HASH, metaChanged: false }]);
	}

	idle(): Promise<Awaited<ReturnType<typeof executeSync>>> {
		return this.run([{ kind: 'attachments', page: PAGE, path: NOTE, meta, metaHash: META_HASH }]);
	}

	/** The user writes the note's body. */
	async edit(body: string): Promise<void> {
		this.vault.userEdit(NOTE, replaceNcMeta(body, meta));
	}

	state() {
		const s = this.deps.state.pages['10'];
		if (s === undefined) throw new Error('no page state');
		return s;
	}

	async text(path: string): Promise<string> {
		return textOf(await this.vault.readBinary(path));
	}
}

/** A page with one attachment on the server, pulled into the vault. */
async function pulledPage(options: Options = {}): Promise<Harness> {
	const h = new Harness(options);
	h.dav.serve(PAGE, 'Bild: ![bild.png](.attachments.10/bild.png)\n', '"e1"');
	h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');
	const result = await h.create();
	expect(result.failed).toBe(0);
	return h;
}

describe('attachments: pull', () => {
	it('downloads an embedded file into the folder of the note and links it as wikilink', async () => {
		const h = await pulledPage();

		expect(await h.text(`${FOLDER}/bild.png`)).toBe('PNG-1');
		expect(await h.vault.read(NOTE)).toContain('Bild: ![[Coll/_attachments/Start/bild.png]]');
		expect(h.state().attachments).toHaveLength(1);
		expect(h.state().attachments[0]).toMatchObject({ name: 'bild.png', localPath: `${FOLDER}/bild.png`, hash: await sha256HexBytes(bytes('PNG-1')) });
		expect(h.state().attachments[0]?.etag).toBe(h.att.files.get(`${REMOTE_FOLDER}/bild.png`)?.etag);
	});

	it('counts the transferred file', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');

		const result = await h.create();

		expect(result.attachments).toBe(1);
	});

	it('does not transfer an unchanged attachment again', async () => {
		const h = await pulledPage();
		h.att.calls.length = 0;

		const result = await h.idle();

		expect(result.attachments).toBe(0);
		expect(h.att.count('GET')).toBe(0);
		expect(h.att.count('PUT')).toBe(0);
		expect(h.att.count('PROPFIND')).toBe(1);
	});

	it('pushes nothing for the note it wrote: the page text still equals the server text', async () => {
		const h = await pulledPage();

		const result = await h.push();

		expect(result.pushed).toBe(0);
		expect(h.dav.puts()).toHaveLength(0);
		expect(h.att.count('PUT')).toBe(0);
	});

	it('downloads a changed server file and replaces the vault file the user did not touch', async () => {
		const h = await pulledPage();
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-2');

		const result = await h.idle();

		expect(result.failed).toBe(0);
		expect(await h.text(`${FOLDER}/bild.png`)).toBe('PNG-2');
		expect(h.state().attachments[0]?.hash).toBe(await sha256HexBytes(bytes('PNG-2')));
	});

	it('keeps a vault file the user changed and puts the server file next to it as conflict copy', async () => {
		const h = await pulledPage();
		h.vault.userEditBinary(`${FOLDER}/bild.png`, bytes('MEIN-PNG'));
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-2');

		const result = await h.idle();

		expect(result.conflicts).toBe(1);
		expect(await h.text(`${FOLDER}/bild.png`)).toBe('MEIN-PNG');
		expect(await h.text(`${FOLDER}/bild (Konflikt 2026-10-17 1200).png`)).toBe('PNG-2');
		h.att.calls.length = 0;
		expect((await h.idle()).conflicts).toBe(0);
		expect(h.att.count('GET')).toBe(0);
	});

	it('does not download a file above the size limit', async () => {
		const h = new Harness({ maxBytes: 4 });
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');

		const result = await h.create();

		expect(result.failed).toBe(0);
		expect(h.att.count('GET')).toBe(0);
		expect(h.vault.exists(`${FOLDER}/bild.png`)).toBe(false);
	});

	it('records a failed download as pending and tries again in the next run', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');
		h.att.getErrors.set(`${REMOTE_FOLDER}/bild.png`, new ServerError(500));

		const first = await h.create();

		expect(first.failed).toBe(1);
		expect(h.state().attachments).toEqual([{ id: 0, name: 'bild.png', etag: '', localPath: `${FOLDER}/bild.png`, hash: '' }]);
		h.att.getErrors.clear();

		const second = await h.idle();

		expect(second.failed).toBe(0);
		expect(await h.text(`${FOLDER}/bild.png`)).toBe('PNG-1');
		expect(h.state().attachments[0]?.etag).not.toBe('');
	});
});

describe('attachments: push', () => {
	async function pageWithoutAttachments(options: Options = {}): Promise<Harness> {
		const h = new Harness(options);
		h.dav.serve(PAGE, 'Text\n', '"e1"');
		await h.create();
		return h;
	}

	it('uploads a pasted file the note embeds and links it in the page text', async () => {
		const h = await pageWithoutAttachments();
		h.vault.seedBinary('Coll/Pasted image 1.png', bytes('PNG-9'));
		await h.edit('Text ![[Pasted image 1.png]]\n');

		const result = await h.push();

		expect(result.failed).toBe(0);
		expect(h.dav.content(PAGE)).toBe('Text ![Pasted image 1.png](.attachments.10/Pasted%20image%201.png)');
		expect(h.att.calls).toContain(`MKCOL ${REMOTE_FOLDER}`);
		expect(h.att.calls).toContain(`PUT ${REMOTE_FOLDER}/Pasted image 1.png new`);
		expect(textOf(h.att.files.get(`${REMOTE_FOLDER}/Pasted image 1.png`)?.data ?? new ArrayBuffer(0))).toBe('PNG-9');
		expect(h.state().attachments).toEqual([
			expect.objectContaining({ name: 'Pasted image 1.png', localPath: 'Coll/Pasted image 1.png', hash: await sha256HexBytes(bytes('PNG-9')) }),
		]);
		expect(h.state().attachments[0]?.etag).toBe(h.att.files.get(`${REMOTE_FOLDER}/Pasted image 1.png`)?.etag);
	});

	it('leaves the file where the user has it and does not upload it again', async () => {
		const h = await pageWithoutAttachments();
		h.vault.seedBinary('Coll/Pasted image 1.png', bytes('PNG-9'));
		await h.edit('Text ![[Pasted image 1.png]]\n');
		await h.push();
		h.att.calls.length = 0;

		const again = await h.idle();

		expect(again.attachments).toBe(0);
		expect(h.att.count('PUT')).toBe(0);
		expect(h.att.count('GET')).toBe(0);
		expect(h.vault.exists('Coll/Pasted image 1.png')).toBe(true);
	});

	it('does not create the folder again when it exists, and never overwrites a file of the same name on the server', async () => {
		const h = await pageWithoutAttachments();
		h.att.serve(REMOTE_FOLDER, 'a.png', 'SERVER');
		h.vault.seedBinary('Coll/a.png', bytes('LOKAL'));
		await h.edit('![[a.png]]\n');

		await h.push();

		expect(h.att.count('MKCOL')).toBe(0);
		// The file exists on both sides with different bytes and nothing is known about it: the server file is kept as conflict copy.
		expect(textOf(h.att.files.get(`${REMOTE_FOLDER}/a.png`)?.data ?? new ArrayBuffer(0))).toBe('SERVER');
		expect(await h.text('Coll/a.png')).toBe('LOKAL');
		expect(await h.text('Coll/a (Konflikt 2026-10-17 1200).png')).toBe('SERVER');
	});

	it('records a name taken on the server during the upload as pending and does not overwrite it', async () => {
		const h = await pageWithoutAttachments();
		h.vault.seedBinary('Coll/a.png', bytes('LOKAL'));
		await h.edit('![[a.png]]\n');
		const original = h.att.webdav.propfind.bind(h.att.webdav);
		// The file appears on the server between the listing and the upload.
		h.att.webdav.propfind = async (path, depth) => {
			const entries = await original(path, depth);
			h.att.serve(REMOTE_FOLDER, 'a.png', 'SERVER');
			return entries;
		};
		h.att.folders.add(REMOTE_FOLDER);

		await h.push();

		expect(textOf(h.att.files.get(`${REMOTE_FOLDER}/a.png`)?.data ?? new ArrayBuffer(0))).toBe('SERVER');
		expect(h.state().attachments[0]).toMatchObject({ name: 'a.png', etag: '', hash: '' });
	});

	it('does not upload a file above the size limit and leaves the embed as it is', async () => {
		const h = await pageWithoutAttachments({ maxBytes: 4 });
		h.vault.seedBinary('Coll/big.png', bytes('0123456789'));
		await h.edit('![[big.png]]\n');

		const result = await h.push();

		expect(result.failed).toBe(0);
		expect(h.att.count('PUT')).toBe(0);
		expect(h.dav.content(PAGE)).toBe('![[big.png]]');
	});
});

describe('attachments: deletion', () => {
	it('moves the vault file to the trash when the server deleted the attachment', async () => {
		const h = await pulledPage();
		h.att.remove(REMOTE_FOLDER, 'bild.png');

		const result = await h.idle();

		expect(result.attachments).toBe(1);
		expect(h.vault.exists(`${FOLDER}/bild.png`)).toBe(false);
		expect(h.state().attachments).toEqual([]);
	});

	it('keeps the vault file with the setting keepUnlinked, and when the user changed it', async () => {
		const kept = await pulledPage({ remoteDelete: 'keepUnlinked' });
		kept.att.remove(REMOTE_FOLDER, 'bild.png');
		await kept.idle();
		expect(kept.vault.exists(`${FOLDER}/bild.png`)).toBe(true);
		expect(kept.state().attachments).toEqual([]);

		const changed = await pulledPage();
		changed.vault.userEditBinary(`${FOLDER}/bild.png`, bytes('MEIN-PNG'));
		changed.att.remove(REMOTE_FOLDER, 'bild.png');
		await changed.idle();
		expect(await changed.text(`${FOLDER}/bild.png`)).toBe('MEIN-PNG');
	});

	it('deletes the server file when the user deleted the vault file and removed the embed', async () => {
		const h = await pulledPage();
		await h.vault.remove(`${FOLDER}/bild.png`);
		await h.edit('Kein Bild mehr\n');
		await h.push();

		expect(h.att.deleted).toHaveLength(1);
		expect(h.att.files.has(`${REMOTE_FOLDER}/bild.png`)).toBe(false);
		expect(h.state().attachments).toEqual([]);
	});

	it('does not delete on the server with the setting off', async () => {
		const h = await pulledPage({ deleteRemote: false });
		await h.vault.remove(`${FOLDER}/bild.png`);
		await h.edit('Kein Bild mehr\n');
		await h.push();

		expect(h.att.deleted).toHaveLength(0);
		expect(h.att.files.has(`${REMOTE_FOLDER}/bild.png`)).toBe(true);
		expect(h.state().attachments).toEqual([]);
	});

	it('downloads a vault file that is gone again while the note still embeds it', async () => {
		const h = await pulledPage();
		await h.vault.remove(`${FOLDER}/bild.png`);

		const result = await h.idle();

		expect(h.att.deleted).toHaveLength(0);
		expect(result.attachments).toBe(1);
		expect(await h.text(`${FOLDER}/bild.png`)).toBe('PNG-1');
	});

	it('follows a file the user moved: no deletion, no transfer', async () => {
		const h = await pulledPage();
		h.vault.seedFolder('Coll/Bilder');
		await h.vault.rename(`${FOLDER}/bild.png`, 'Coll/Bilder/bild.png');
		await h.edit('Bild: ![[Coll/Bilder/bild.png]]\n');
		h.att.calls.length = 0;

		const result = await h.push();

		expect(result.failed).toBe(0);
		expect(h.att.deleted).toHaveLength(0);
		expect(h.att.count('GET')).toBe(0);
		expect(h.att.count('PUT')).toBe(0);
		expect(h.state().attachments[0]?.localPath).toBe('Coll/Bilder/bild.png');
	});

	it('leaves everything alone when the attachment folder has vanished from the server', async () => {
		const h = await pulledPage();
		h.att.folders.delete(REMOTE_FOLDER);

		const result = await h.idle();

		expect(result.failed).toBe(0);
		expect(h.vault.exists(`${FOLDER}/bild.png`)).toBe(true);
		expect(h.state().attachments).toHaveLength(1);
	});
});

describe('attachments: scope and limits (security)', () => {
	it('never uploads a file outside the collective folder that server text embeds', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, 'Text\n', '"e1"');
		await h.create();
		h.vault.seedBinary('Privat/steuer.pdf', bytes('GEHEIM'));
		await h.edit('![](Privat/steuer.pdf) ![[steuer.pdf]]\n');

		await h.push();

		expect(h.att.count('PUT')).toBe(0);
		expect(h.att.files.size).toBe(0);
	});

	it('does not trash or overwrite a vault file outside the collective folder named by the state', async () => {
		const h = await pulledPage();
		h.vault.seedBinary('Privat/x.png', bytes('MEIN'));
		const rec = h.state().attachments[0];
		if (rec === undefined) throw new Error('no attachment');
		h.deps.state.pages['10'] = { ...h.state(), attachments: [{ ...rec, localPath: 'Privat/x.png', hash: await sha256HexBytes(bytes('MEIN')) }] };
		h.att.remove(REMOTE_FOLDER, 'bild.png');

		await h.idle();

		expect(await h.text('Privat/x.png')).toBe('MEIN');
	});

	it('does not download a file when the server reports no size', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');
		const original = h.att.webdav.propfind.bind(h.att.webdav);
		h.att.webdav.propfind = async (path, depth) => (await original(path, depth)).map((e) => ({ ...e, contentLength: null }));

		await h.create();

		expect(h.att.count('GET')).toBe(0);
	});

	it('does not write a file that is larger than reported', async () => {
		const h = new Harness({ maxBytes: 8 });
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');
		const original = h.att.webdav.propfind.bind(h.att.webdav);
		h.att.webdav.propfind = async (path, depth) => (await original(path, depth)).map((e) => ({ ...e, contentLength: e.isCollection ? null : 1 }));
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'ZEHN-BYTES-UND-MEHR');

		await h.create();

		expect(h.vault.exists(`${FOLDER}/bild.png`)).toBe(false);
	});
});

describe('attachments: review findings', () => {
	it('uploads an image pasted into the vault root, but not other files there', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, 'Text\n', '"e1"');
		await h.create();
		h.vault.seedBinary('Pasted image 1.png', bytes('PNG'));
		h.vault.seedBinary('steuer.pdf', bytes('GEHEIM'));
		await h.edit('![[Pasted image 1.png]] ![[steuer.pdf]]\n');

		await h.push();

		expect([...h.att.files.keys()]).toEqual([`${REMOTE_FOLDER}/Pasted image 1.png`]);
	});

	it('never trashes a vault-root image because the server deleted it', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, 'Text\n', '"e1"');
		await h.create();
		h.vault.seedBinary('Pasted image 1.png', bytes('PNG'));
		await h.edit('![[Pasted image 1.png]]\n');
		await h.push();
		h.att.remove(REMOTE_FOLDER, 'Pasted image 1.png');

		await h.idle();

		expect(h.vault.exists('Pasted image 1.png')).toBe(true);
	});

	it('deletes nothing on either side for a page in conflict', async () => {
		const h = await pulledPage();
		h.deps.state.pages['10'] = { ...h.state(), status: 'conflict' };
		await h.vault.remove(`${FOLDER}/bild.png`);
		await h.edit('Kein Bild mehr\n');

		await h.idle();

		expect(h.att.deleted).toHaveLength(0);
		expect(h.state().attachments).toHaveLength(1);
		const gone = await pulledPage();
		gone.deps.state.pages['10'] = { ...gone.state(), status: 'conflict' };
		gone.att.remove(REMOTE_FOLDER, 'bild.png');
		await gone.idle();
		expect(gone.vault.exists(`${FOLDER}/bild.png`)).toBe(true);
	});

	it('keeps resolving a short embed name when a second file of that name appears', async () => {
		const h = await pulledPage();
		await h.edit('Bild: ![[bild.png]]\n');
		h.vault.seedBinary('Coll/Anderes/bild.png', bytes('ANDERS'));

		const result = await h.push();

		expect(result.pushed).toBe(0);
		expect(h.dav.puts()).toHaveLength(0);
	});
});

describe('attachments: not configured', () => {
	it('does nothing without attachment dependencies', async () => {
		const h = new Harness();
		h.dav.serve(PAGE, '![bild.png](.attachments.10/bild.png)\n', '"e1"');
		h.att.serve(REMOTE_FOLDER, 'bild.png', 'PNG-1');
		const plan: SyncPlan = { ops: [{ kind: 'create', page: PAGE, path: NOTE, meta, metaHash: META_HASH }], skips: [], proposals: [], followUp: false };

		await executeSync(plan, h.deps);

		expect(h.att.calls).toEqual([]);
		expect(h.state().attachments).toEqual([]);
	});
});
