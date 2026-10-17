// M8 (PLAN §9.4): attachments in both directions against the local Docker Nextcloud, with an in-memory vault.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Collective, PageInfo } from '../../src/api/types';
import { remotePagePath } from '../../src/mapping/paths';
import { bytes, textOf } from '../fakes/fakeAttachments';
import { CollectiveFixture, Harness, required, waitPastSecondBoundary } from './harness';

const fixtures: CollectiveFixture[] = [];

afterAll(async () => {
	for (const fx of fixtures) await fx.cleanup();
});

// A real PNG header, so Collectives treats the file as an image.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).buffer;

describe('attachments', () => {
	let h: Harness;
	let collective: Collective;
	let name: string;
	let page: PageInfo;
	let folder: string;

	async function remotePage(): Promise<PageInfo> {
		return h.clients.collectives.getPage(collective.id, page.id);
	}

	async function remoteText(): Promise<string> {
		return (await h.clients.webdav.get(remotePagePath(await remotePage()))).content;
	}

	async function setRemoteText(text: string): Promise<void> {
		const path = remotePagePath(await remotePage());
		await waitPastSecondBoundary();
		await h.clients.webdav.put(path, text, { ifMatch: (await h.clients.webdav.get(path)).etag });
	}

	async function attachmentFolder(): Promise<string> {
		const current = await remotePage();
		return `${current.collectivePath}/${current.filePath === '' ? '' : current.filePath + '/'}.attachments.${page.id}`;
	}

	/** The server's file list of the page, as Collectives itself reports it. */
	async function listed(): Promise<string[]> {
		return (await h.clients.collectives.listAttachments(collective.id, page.id)).map((a) => a.name).sort();
	}

	/** Puts a file into the page's attachment folder like another client would (the folder is created if needed). */
	async function serverUpload(file: string, data: ArrayBuffer): Promise<void> {
		const dir = await attachmentFolder();
		try {
			await h.clients.webdav.mkcol(dir);
		} catch {
			// The folder exists already.
		}
		const path = `${dir}/${file}`;
		const existing = await h.clients.webdav.propfind(dir, 1);
		const current = existing.find((entry) => entry.path === path);
		await h.clients.webdav.putBinary(path, data, 'image/png', current?.etag ? { ifMatch: current.etag } : { ifNoneMatch: '*' });
	}

	beforeAll(async () => {
		h = await Harness.create();
		const fx = new CollectiveFixture(h.clients);
		fixtures.push(fx);
		const made = await fx.collective('ONC M8');
		collective = made.collective;
		name = made.name;
		page = await fx.page(collective, made.landing, 'Bilder', 'Noch ohne Bild');
		folder = `${name}/_attachments/Bilder`;
		expect((await h.sync()).result.failed).toBe(0);
	}, 60_000);

	it('turns an image uploaded in Collectives into a file in the vault and a wikilink, once', async () => {
		await serverUpload('server.png', PNG);
		await setRemoteText('Bild: ![server.png](.attachments.' + page.id + '/server.png)\n');

		const pulled = await h.sync();

		expect(pulled.result).toMatchObject({ updated: 1, attachments: 1, pushed: 0, conflicts: 0, failed: 0 });
		expect(await h.vault.readBinary(`${folder}/server.png`)).toEqual(PNG);
		expect(await h.vault.read(`${name}/Bilder.md`)).toContain(`Bild: ![[${folder}/server.png]]`);

		const since = h.requests.length;
		const again = await h.sync();
		expect(again.result).toMatchObject({ attachments: 0, pushed: 0, updated: 0, conflicts: 0, failed: 0 });
		expect(h.count('GET', '.attachments.', since)).toBe(0);
		expect(h.count('PUT', '.attachments.', since)).toBe(0);
	}, 60_000);

	it('uploads an image pasted in Obsidian, and Collectives lists it and links it as an image', async () => {
		h.vault.seedBinary('Pasted image 1.png', PNG);
		const path = `${name}/Bilder.md`;
		const text = await h.vault.read(path);
		h.edit(path, `${text.trimEnd()}\nNeu: ![[Pasted image 1.png]]\n`);

		const pushed = await h.sync();

		expect(pushed.result).toMatchObject({ pushed: 1, attachments: 1, conflicts: 0, failed: 0 });
		expect(await remoteText()).toContain(`![Pasted image 1.png](.attachments.${page.id}/Pasted%20image%201.png)`);
		expect(await listed()).toEqual(['Pasted image 1.png', 'server.png']);
		const stored = await h.clients.webdav.getBinary(`${await attachmentFolder()}/Pasted image 1.png`);
		expect(stored.data).toEqual(PNG);

		const since = h.requests.length;
		const again = await h.sync();
		expect(again.result).toMatchObject({ attachments: 0, pushed: 0, updated: 0, conflicts: 0, failed: 0 });
		expect(h.count('PUT', '.attachments.', since)).toBe(0);
		expect(h.count('GET', '.attachments.', since)).toBe(0);
		expect(h.vault.exists('Pasted image 1.png')).toBe(true);
	}, 60_000);

	it('knows the attachment ids that Collectives uses (PROPFIND file id = OCS attachment id)', async () => {
		const listing = await h.clients.collectives.listAttachments(collective.id, page.id);
		const state = required(h.state().pages[String(page.id)], 'page state');
		for (const entry of state.attachments) {
			expect(listing.find((a) => a.name === entry.name)?.id).toBe(entry.id);
		}
	}, 60_000);

	it('takes over a changed server file and keeps a file the user changed', async () => {
		await waitPastSecondBoundary();
		await serverUpload('server.png', bytes('NEU-VOM-SERVER'));

		const pulled = await h.sync();
		expect(pulled.result).toMatchObject({ attachments: 1, conflicts: 0, failed: 0 });
		expect(textOf(await h.vault.readBinary(`${folder}/server.png`))).toBe('NEU-VOM-SERVER');

		h.vault.userEditBinary(`${folder}/server.png`, bytes('MEINE-FASSUNG'));
		await waitPastSecondBoundary();
		await serverUpload('server.png', bytes('NOCHMAL-NEU'));

		const conflict = await h.sync();
		expect(conflict.result).toMatchObject({ conflicts: 1, failed: 0 });
		expect(textOf(await h.vault.readBinary(`${folder}/server.png`))).toBe('MEINE-FASSUNG');
		const copies = h.paths(folder).filter((p) => p.includes('Konflikt') || p.includes('Conflict'));
		expect(copies).toHaveLength(1);
		expect(textOf(await h.vault.readBinary(copies[0] ?? ''))).toBe('NOCHMAL-NEU');
	}, 90_000);

	it('removes a file from the vault that was deleted in Collectives', async () => {
		const target = (await h.clients.collectives.listAttachments(collective.id, page.id)).find((a) => a.name === 'Pasted image 1.png');
		await h.clients.collectives.deleteAttachment(collective.id, page.id, required(target, 'attachment').id);

		const synced = await h.sync();

		expect(synced.result).toMatchObject({ attachments: 1, failed: 0 });
		expect(h.vault.exists('Pasted image 1.png')).toBe(false);
	}, 60_000);

	it('deletes the server file of an attachment the user deleted and no longer uses', async () => {
		const path = `${name}/Bilder.md`;
		await h.vault.remove(`${folder}/server.png`);
		h.edit(path, (await h.vault.read(path)).replace(/!\[\[[^\]]*server\.png\]\]/, 'kein Bild'));

		const synced = await h.sync();

		expect(synced.result).toMatchObject({ pushed: 1, attachments: 1, failed: 0 });
		expect(await listed()).toEqual([]);
		expect(await remoteText()).not.toContain('server.png');
	}, 60_000);
});
