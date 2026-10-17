// M5 (PLAN §7.4): every structure and lifecycle case against the local Docker Nextcloud, with an in-memory vault.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Collective, PageInfo } from '../../src/api/types';
import { readPageId, toRemote } from '../../src/mapping/frontmatter';
import { remotePagePath } from '../../src/mapping/paths';
import { CollectiveFixture, Harness, required, waitPastSecondBoundary } from './harness';

/** Every fixture of this file; all their collectives are trashed at the end. */
const allFixtures: CollectiveFixture[] = [];

function track(fx: CollectiveFixture): CollectiveFixture {
	allFixtures.push(fx);
	return fx;
}

afterAll(async () => {
	for (const fx of allFixtures) await fx.cleanup();
});

/** A harness with its own collective, already pulled into the vault. */
async function setup(prefix: string): Promise<{ h: Harness; fx: CollectiveFixture; collective: Collective; landing: PageInfo; name: string }> {
	const h = await Harness.create();
	const fx = track(new CollectiveFixture(h.clients));
	const made = await fx.collective(prefix);
	const outcome = await h.sync();
	expect(outcome.result.failed).toBe(0);
	return { h, fx, ...made };
}

async function pagesOf(h: Harness, collective: Collective): Promise<PageInfo[]> {
	return h.clients.collectives.listPages(collective.id);
}

function byTitle(pages: PageInfo[], title: string): PageInfo {
	return required(pages.find((page) => page.title === title), `page "${title}"`);
}

async function remoteText(h: Harness, page: PageInfo): Promise<string> {
	return (await h.clients.webdav.get(remotePagePath(page))).content;
}

describe('new local file (PLAN §7.4: neue lokale Datei)', () => {
	let ctx: Awaited<ReturnType<typeof setup>>;
	beforeAll(async () => {
		ctx = await setup('ONC M5 new');
	}, 60_000);
	afterAll(async () => {
		await ctx.fx.cleanup();
	});

	it('uploads a note without nc_page_id as a page below the landing page and writes its id into the file', async () => {
		const { h, collective, landing, name } = ctx;
		h.create(`${name}/Idee.md`, 'Meine Idee\n');

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ uploaded: 1, failed: 0 });
		const idee = byTitle(await pagesOf(h, collective), 'Idee');
		expect(idee.parentId).toBe(landing.id);
		expect(await remoteText(h, idee)).toBe('Meine Idee');
		expect(readPageId(await h.vault.read(`${name}/Idee.md`))).toBe(idee.id);
		expect(toRemote(await h.vault.read(`${name}/Idee.md`))).toBe('Meine Idee');
	}, 60_000);

	it('does nothing in the next runs (no second page, no upload, no write)', async () => {
		const { h, collective } = ctx;
		await waitPastSecondBoundary();
		await h.sync();
		const pagesBefore = (await pagesOf(h, collective)).length;
		const writes = h.vault.writes;
		const since = h.requests.length;

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ uploaded: 0, pushed: 0, moved: 0, failed: 0 });
		expect((await pagesOf(h, collective)).length).toBe(pagesBefore);
		expect(h.vault.writes).toBe(writes);
		expect(h.count('PUT', '/remote.php/dav/', since)).toBe(0);
	}, 60_000);
});

describe('new local files in folders (PLAN §7.4: Elternseite aus Ordner bestimmen)', () => {
	let ctx: Awaited<ReturnType<typeof setup>>;
	beforeAll(async () => {
		ctx = await setup('ONC M5 tree');
	}, 60_000);
	afterAll(async () => {
		await ctx.fx.cleanup();
	});

	it('creates a folder page for a folder without a note, and the note in the vault', async () => {
		const { h, collective, landing, name } = ctx;
		h.create(`${name}/Prozesse/Urlaub.md`, 'Urlaub beantragen\n');

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ uploaded: 2, failed: 0 });
		const pages = await pagesOf(h, collective);
		const prozesse = byTitle(pages, 'Prozesse');
		const urlaub = byTitle(pages, 'Urlaub');
		expect(prozesse.parentId).toBe(landing.id);
		expect(prozesse.fileName).toBe('Readme.md');
		expect(urlaub.parentId).toBe(prozesse.id);
		expect(readPageId(await h.vault.read(`${name}/Prozesse/Prozesse.md`))).toBe(prozesse.id);
		expect(readPageId(await h.vault.read(`${name}/Prozesse/Urlaub.md`))).toBe(urlaub.id);
		expect(await remoteText(h, urlaub)).toBe('Urlaub beantragen');
	}, 60_000);

	it('turns a leaf into a folder page when a new note is put into a folder of the same name, and moves the leaf into the folder', async () => {
		const { h, collective, name } = ctx;
		h.create(`${name}/Onboarding.md`, 'Willkommen\n');
		await h.sync();
		await waitPastSecondBoundary();
		h.create(`${name}/Onboarding/Checkliste.md`, 'Punkte\n');

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		const pages = await pagesOf(h, collective);
		const onboarding = byTitle(pages, 'Onboarding');
		const checkliste = byTitle(pages, 'Checkliste');
		expect(checkliste.parentId).toBe(onboarding.id);
		expect(onboarding.fileName).toBe('Readme.md');
		expect(h.vault.exists(`${name}/Onboarding.md`)).toBe(false);
		expect(readPageId(await h.vault.read(`${name}/Onboarding/Onboarding.md`))).toBe(onboarding.id);
		expect(await remoteText(h, onboarding)).toBe('Willkommen');
		// Nothing left to do afterwards.
		const again = await h.sync();
		expect(again.result).toMatchObject({ uploaded: 0, moved: 0, failed: 0 });
	}, 90_000);
});

describe('renamed and moved pages (PLAN §7.4: lokal / remote umbenannt oder verschoben)', () => {
	let ctx: Awaited<ReturnType<typeof setup>>;
	let alpha: PageInfo;
	let folder: PageInfo;
	let inner: PageInfo;
	beforeAll(async () => {
		const h = await Harness.create();
		const fx = track(new CollectiveFixture(h.clients));
		const made = await fx.collective('ONC M5 move');
		alpha = await fx.page(made.collective, made.landing, 'Alpha', 'Text Alpha');
		folder = await fx.page(made.collective, made.landing, 'Ordner', 'Text Ordner');
		inner = await fx.page(made.collective, folder, 'Innen', 'Text Innen');
		await h.sync();
		ctx = { h, fx, ...made };
	}, 90_000);
	afterAll(async () => {
		await ctx.fx.cleanup();
	});

	it('renames the page when the user renames the file, keeping its id', async () => {
		const { h, collective, name } = ctx;
		await h.rename(`${name}/Alpha.md`, `${name}/Beta.md`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, uploaded: 0, failed: 0 });
		const beta = byTitle(await pagesOf(h, collective), 'Beta');
		expect(beta.id).toBe(alpha.id);
		expect(readPageId(await h.vault.read(`${name}/Beta.md`))).toBe(alpha.id);
		expect(await remoteText(h, beta)).toBe('Text Alpha');
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, pushed: 0, failed: 0 });
	}, 60_000);

	it('moves the page below another page when the user moves the file into that page’s folder', async () => {
		const { h, collective, name } = ctx;
		await h.rename(`${name}/Beta.md`, `${name}/Ordner/Beta.md`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		const beta = byTitle(await pagesOf(h, collective), 'Beta');
		expect(beta.parentId).toBe(folder.id);
		expect(readPageId(await h.vault.read(`${name}/Ordner/Beta.md`))).toBe(alpha.id);
	}, 60_000);

	it('moves the page back to the top level when the file leaves the folder', async () => {
		const { h, collective, landing, name } = ctx;
		await h.rename(`${name}/Ordner/Innen.md`, `${name}/Innen.md`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		expect(byTitle(await pagesOf(h, collective), 'Innen').parentId).toBe(landing.id);
		expect(inner.id).toBe(byTitle(await pagesOf(h, collective), 'Innen').id);
	}, 60_000);

	it('renames the page and its folder when the user renames the folder of a folder page', async () => {
		const { h, collective, name } = ctx;
		await h.rename(`${name}/Ordner`, `${name}/Sammlung`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ failed: 0 });
		const pages = await pagesOf(h, collective);
		const sammlung = byTitle(pages, 'Sammlung');
		expect(sammlung.id).toBe(folder.id);
		expect(sammlung.filePath).toBe('Sammlung');
		expect(h.vault.exists(`${name}/Sammlung/Sammlung.md`)).toBe(true);
		expect(h.vault.exists(`${name}/Sammlung/Ordner.md`)).toBe(false);
		expect(byTitle(pages, 'Beta').parentId).toBe(folder.id);
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 90_000);

	it('renames the page and then its folder when the user renames only the note of a folder page', async () => {
		const { h, collective, name } = ctx;
		await h.rename(`${name}/Sammlung/Sammlung.md`, `${name}/Sammlung/Archiv.md`);

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		const archiv = byTitle(await pagesOf(h, collective), 'Archiv');
		expect(archiv.id).toBe(folder.id);
		expect(readPageId(await h.vault.read(`${name}/Archiv/Archiv.md`))).toBe(folder.id);
		expect(h.vault.exists(`${name}/Sammlung`)).toBe(false);
		expect(readPageId(await h.vault.read(`${name}/Archiv/Beta.md`))).toBe(alpha.id);
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 90_000);

	it('renames the file when the page was renamed on the server', async () => {
		const { h, collective, name } = ctx;
		const innen = byTitle(await pagesOf(h, collective), 'Innen');
		await h.clients.collectives.updatePage(collective.id, innen.id, { title: 'Drinnen' });

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		expect(readPageId(await h.vault.read(`${name}/Drinnen.md`))).toBe(innen.id);
		expect(h.vault.exists(`${name}/Innen.md`)).toBe(false);
	}, 60_000);

	it('moves the file when the page was moved to another parent on the server', async () => {
		const { h, collective, name } = ctx;
		const pages = await pagesOf(h, collective);
		const drinnen = byTitle(pages, 'Drinnen');
		await h.clients.collectives.updatePage(collective.id, drinnen.id, { parentId: folder.id });

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		expect(readPageId(await h.vault.read(`${name}/Archiv/Drinnen.md`))).toBe(drinnen.id);
		expect(h.vault.exists(`${name}/Drinnen.md`)).toBe(false);
	}, 60_000);

	it('lets the server win when both sides moved the page, and says so', async () => {
		const { h, collective, name } = ctx;
		const pages = await pagesOf(h, collective);
		const drinnen = byTitle(pages, 'Drinnen');
		await h.rename(`${name}/Archiv/Drinnen.md`, `${name}/Archiv/Lokal.md`);
		await h.clients.collectives.updatePage(collective.id, drinnen.id, { title: 'Remote' });

		const outcome = await h.sync();

		expect(outcome.skips).toContainEqual({ reason: 'remoteMoveWins', pageId: drinnen.id });
		expect(byTitle(await pagesOf(h, collective), 'Remote').id).toBe(drinnen.id);
		expect(readPageId(await h.vault.read(`${name}/Archiv/Remote.md`))).toBe(drinnen.id);
		expect(h.vault.exists(`${name}/Archiv/Lokal.md`)).toBe(false);
	}, 60_000);

	it('moves the file into the folder when a leaf page became a folder page on the server', async () => {
		const { h, collective, fx, name } = ctx;
		const pages = await pagesOf(h, collective);
		const remote = byTitle(pages, 'Remote');
		await fx.page(collective, remote, 'Kind', 'Text Kind');

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		expect(readPageId(await h.vault.read(`${name}/Archiv/Remote/Remote.md`))).toBe(remote.id);
		expect(h.vault.exists(`${name}/Archiv/Remote.md`)).toBe(false);
		expect(h.vault.exists(`${name}/Archiv/Remote/Kind.md`)).toBe(true);
	}, 90_000);
});

describe('pages deleted on the server (PLAN §7.4: Remote gelöscht, Gelöscht + gegenüber geändert)', () => {
	let ctx: Awaited<ReturnType<typeof setup>>;
	let a: PageInfo;
	let b: PageInfo;
	let c: PageInfo;
	beforeAll(async () => {
		const h = await Harness.create();
		const fx = track(new CollectiveFixture(h.clients));
		const made = await fx.collective('ONC M5 rdel');
		a = await fx.page(made.collective, made.landing, 'Eins', 'Text Eins');
		b = await fx.page(made.collective, made.landing, 'Zwei', 'Text Zwei');
		c = await fx.page(made.collective, made.landing, 'Drei', 'Text Drei');
		await h.sync();
		ctx = { h, fx, ...made };
	}, 90_000);
	afterAll(async () => {
		await ctx.fx.cleanup();
	});

	it('moves the unchanged file to the trash', async () => {
		const { h, collective, name } = ctx;
		await h.clients.collectives.trashPage(collective.id, a.id);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ removed: 1, failed: 0 });
		expect(h.vault.exists(`${name}/Eins.md`)).toBe(false);
		expect(h.state().pages[String(a.id)]).toBeUndefined();
	}, 60_000);

	it('restores the page and keeps the local text when the file was changed meanwhile', async () => {
		const { h, collective, name } = ctx;
		h.edit(`${name}/Zwei.md`, `${await h.vault.read(`${name}/Zwei.md`)}Lokal ergänzt\n`);
		await h.clients.collectives.trashPage(collective.id, b.id);
		await waitPastSecondBoundary();

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ restored: 1, failed: 0 });
		const zwei = byTitle(await pagesOf(h, collective), 'Zwei');
		expect(zwei.id).toBe(b.id);
		expect(await remoteText(h, zwei)).toBe('Text ZweiLokal ergänzt');
		expect(h.vault.exists(`${name}/Zwei.md`)).toBe(true);
	}, 90_000);

	it('keeps the file as a new page when the setting says keepUnlinked', async () => {
		const { h, collective, name } = ctx;
		h.settings = { ...h.settings, remoteDeleteBehaviour: 'keepUnlinked' };
		await h.clients.collectives.trashPage(collective.id, c.id);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ removed: 1, uploaded: 1, failed: 0 });
		const drei = byTitle(await pagesOf(h, collective), 'Drei');
		expect(drei.id).not.toBe(c.id);
		expect(readPageId(await h.vault.read(`${name}/Drei.md`))).toBe(drei.id);
		expect(await remoteText(h, drei)).toBe('Text Drei');
	}, 90_000);
});

describe('pages deleted in the vault (PLAN §7.4: Lokal gelöscht, Lokal wiederhergestellt)', () => {
	let ctx: Awaited<ReturnType<typeof setup>>;
	let pages: PageInfo[];
	beforeAll(async () => {
		const h = await Harness.create();
		const fx = track(new CollectiveFixture(h.clients));
		const made = await fx.collective('ONC M5 ldel');
		pages = [];
		for (const title of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12']) {
			pages.push(await fx.page(made.collective, made.landing, title, `Text ${title}`));
		}
		await h.sync();
		ctx = { h, fx, ...made };
	}, 180_000);
	afterAll(async () => {
		await ctx.fx.cleanup();
	});

	function page(title: string): PageInfo {
		return required(pages.find((p) => p.title === title), title);
	}

	it('asks before it deletes, and moves the page to the Collectives trash when the user agrees', async () => {
		const { h, collective, name } = ctx;
		h.answer = () => 'accept';
		await h.remove(`${name}/P1.md`);

		const outcome = await h.sync();

		expect(h.asked).toHaveLength(1);
		expect(h.asked[0]).toEqual([expect.objectContaining({ kind: 'deletePage', pageId: page('P1').id, title: 'P1' })]);
		expect(outcome.result).toMatchObject({ trashed: 1, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P1').id)).toBe(false);
		expect((await h.clients.collectives.listTrashedPages(collective.id)).some((p) => p.id === page('P1').id)).toBe(true);
		expect(h.vault.exists(`${name}/P1.md`)).toBe(false);
	}, 60_000);

	it('restores the file in the vault when the user refuses', async () => {
		const { h, collective, name } = ctx;
		h.asked.length = 0;
		h.answer = () => 'reject';
		await h.remove(`${name}/P2.md`);

		const outcome = await h.sync();

		expect(h.asked).toHaveLength(1);
		expect(outcome.result).toMatchObject({ trashed: 0, created: 1, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P2').id)).toBe(true);
		expect(readPageId(await h.vault.read(`${name}/P2.md`))).toBe(page('P2').id);
	}, 60_000);

	it('asks again in the next run when the user postpones, and changes nothing meanwhile', async () => {
		const { h, collective, name } = ctx;
		h.asked.length = 0;
		h.answer = () => 'defer';
		await h.remove(`${name}/P3.md`);

		const first = await h.sync();
		const second = await h.sync();

		expect(h.asked).toHaveLength(2);
		expect(first.result).toMatchObject({ trashed: 0, created: 0, failed: 0 });
		expect(second.result).toMatchObject({ trashed: 0, created: 0, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P3').id)).toBe(true);
		expect(h.vault.exists(`${name}/P3.md`)).toBe(false);
		h.answer = () => 'reject';
		await h.sync();
		expect(h.vault.exists(`${name}/P3.md`)).toBe(true);
	}, 90_000);

	it('restores a page from the Collectives trash when its file reappears', async () => {
		const { h, collective, name } = ctx;
		const text = await h.vault.read(`${name}/P2.md`);
		h.answer = () => 'accept';
		await h.remove(`${name}/P2.md`);
		await h.sync();
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P2').id)).toBe(false);

		h.create(`${name}/P2.md`, text);
		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ restored: 1, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P2').id)).toBe(true);
		expect(readPageId(await h.vault.read(`${name}/P2.md`))).toBe(page('P2').id);
		expect(await remoteText(h, page('P2'))).toBe('Text P2');
	}, 90_000);

	it('lets a change on the server win over the deletion: the page comes back without a question', async () => {
		const { h, collective, name } = ctx;
		h.asked.length = 0;
		h.answer = () => 'accept';
		const p4 = page('P4');
		await h.remove(`${name}/P4.md`);
		await waitPastSecondBoundary();
		const current = await h.clients.webdav.get(remotePagePath(p4));
		await h.clients.webdav.put(remotePagePath(p4), 'Neu auf dem Server', { ifMatch: current.etag });

		const outcome = await h.sync();

		expect(h.asked).toEqual([]);
		expect(outcome.result).toMatchObject({ trashed: 0, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === p4.id)).toBe(true);
		expect(toRemote(await h.vault.read(`${name}/P4.md`))).toBe('Neu auf dem Server');
	}, 90_000);

	it('collects many deletions in one question and flags a mass deletion', async () => {
		const { h, collective, name } = ctx;
		h.asked.length = 0;
		h.settings = { ...h.settings, localDeleteBehaviour: 'trashRemote' };
		h.answer = () => 'reject';
		for (const title of ['P5', 'P6', 'P7', 'P8']) await h.remove(`${name}/${title}.md`);

		const outcome = await h.sync();

		// trashRemote does not ask for a few pages, but a mass deletion is always asked.
		expect(h.asked).toHaveLength(1);
		const [asked] = h.asked;
		expect(required(asked, 'question')).toHaveLength(4);
		expect(required(asked, 'question')[0]).toMatchObject({ kind: 'deletePage', mass: { deleted: 4 } });
		expect(outcome.result.trashed).toBe(0);
		for (const title of ['P5', 'P6', 'P7', 'P8']) {
			expect((await pagesOf(h, collective)).some((p) => p.id === page(title).id)).toBe(true);
			expect(h.vault.exists(`${name}/${title}.md`)).toBe(true);
		}
	}, 90_000);

	it('trashes without a question when the setting says so and the deletion is small', async () => {
		const { h, collective, name } = ctx;
		h.asked.length = 0;
		h.settings = { ...h.settings, localDeleteBehaviour: 'trashRemote' };
		await h.remove(`${name}/P9.md`);

		const outcome = await h.sync();

		expect(h.asked).toEqual([]);
		expect(outcome.result).toMatchObject({ trashed: 1, failed: 0 });
		expect((await pagesOf(h, collective)).some((p) => p.id === page('P9').id)).toBe(false);
	}, 60_000);
});

describe('collectives (PLAN §7.4: neues Collective, Ordner umbenannt oder gelöscht)', () => {
	let h: Harness;
	let fx: CollectiveFixture;
	// A fresh vault and state per test, and only the collectives of that test on the server: every run scans them all.
	beforeEach(async () => {
		h = await Harness.create();
		fx = track(new CollectiveFixture(h.clients));
	});
	afterEach(async () => {
		await fx.cleanup();
	});

	it('pulls a collective that is new on the server into a new top-level folder', async () => {
		const { collective, name } = await fx.collective('ONC M5 newremote');

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		expect(h.state().collectives[String(collective.id)]).toMatchObject({ name, localFolder: name });
		expect(h.vault.exists(`${name}/${name}.md`)).toBe(true);
	}, 60_000);

	it('creates a collective for a new top-level folder; the note named like the folder becomes the landing page', async () => {
		const name = `ONC M5 newlocal ${Date.now().toString(36)}`;
		h.create(`${name}/${name}.md`, 'Startseite lokal\n');
		h.create(`${name}/Unterseite.md`, 'Unterseite lokal\n');
		h.create(`${name}/Ordner/Tief.md`, 'Tief lokal\n');

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		const collective = required((await h.clients.collectives.listCollectives()).find((c) => c.name === name), 'new collective');
		fx.created.push(collective);
		const pages = await pagesOf(h, collective);
		const landing = required(pages.find((p) => p.parentId === 0), 'landing');
		expect(await remoteText(h, landing)).toBe('Startseite lokal');
		expect(readPageId(await h.vault.read(`${name}/${name}.md`))).toBe(landing.id);
		const unterseite = byTitle(pages, 'Unterseite');
		expect(unterseite.parentId).toBe(landing.id);
		expect(await remoteText(h, unterseite)).toBe('Unterseite lokal');
		const ordner = byTitle(pages, 'Ordner');
		expect(byTitle(pages, 'Tief').parentId).toBe(ordner.id);
		expect(h.state().collectives[String(collective.id)]).toMatchObject({ name, localFolder: name });
		const again = await h.sync();
		expect(again.result).toMatchObject({ uploaded: 0, moved: 0, pushed: 0, failed: 0 });
	}, 120_000);

	it('ignores a top-level folder when the setting says so', async () => {
		const name = `ONC M5 ignored ${Date.now().toString(36)}`;
		h.settings = { ...h.settings, newFolderBehaviour: 'ignore' };
		h.create(`${name}/Notiz.md`, 'x\n');

		const outcome = await h.sync();

		expect(outcome.skips).toContainEqual({ reason: 'folderIgnored', path: name });
		expect((await h.clients.collectives.listCollectives()).some((c) => c.name === name)).toBe(false);
		h.settings = { ...h.settings, newFolderBehaviour: 'createCollective' };
		await h.remove(name);
	}, 60_000);

	it('asks first when the setting says ask, and creates the collective on agreement', async () => {
		const name = `ONC M5 asked ${Date.now().toString(36)}`;
		h.settings = { ...h.settings, newFolderBehaviour: 'ask' };
		h.answer = () => 'accept';
		h.asked.length = 0;
		h.create(`${name}/Notiz.md`, 'x\n');

		const outcome = await h.sync();

		expect(h.asked).toEqual([[{ id: `newCollective:${name}`, kind: 'newCollective', folder: name, files: 1 }]]);
		expect(outcome.result.failed).toBe(0);
		const collective = required((await h.clients.collectives.listCollectives()).find((c) => c.name === name), 'new collective');
		fx.created.push(collective);
		expect(byTitle(await pagesOf(h, collective), 'Notiz').parentId).not.toBe(0);
		h.settings = { ...h.settings, newFolderBehaviour: 'createCollective' };
	}, 90_000);

	it('ignores Markdown files directly in the vault root', async () => {
		h.create('Lose Notiz.md', 'x\n');
		const before = (await h.clients.collectives.listCollectives()).length;

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ uploaded: 0, failed: 0 });
		expect((await h.clients.collectives.listCollectives()).length).toBe(before);
		expect(h.vault.exists('Lose Notiz.md')).toBe(true);
	}, 60_000);

	it('renames the local folder when the collective is renamed on the server', async () => {
		const { collective, name } = await fx.collective('ONC M5 rename remote');
		await h.sync();
		const newName = `${name} neu`;
		await h.renameCollectiveOnServer(collective, newName);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		expect(h.vault.exists(`${name}/${name}.md`)).toBe(false);
		expect(h.vault.exists(`${newName}/${newName}.md`)).toBe(true);
		expect(h.state().collectives[String(collective.id)]).toMatchObject({ name: newName, localFolder: newName });
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 90_000);

	it('renames the collective on the server when the user renames its folder', async () => {
		const { collective, name } = await fx.collective('ONC M5 rename local');
		await h.sync();
		const newName = `${name} lokal`;
		await h.rename(name, newName);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		const renamed = required((await h.clients.collectives.listCollectives()).find((c) => c.id === collective.id), 'collective');
		expect(renamed.name).toBe(newName);
		expect(h.state().collectives[String(collective.id)]).toMatchObject({ name: newName, localFolder: newName });
		expect(h.vault.exists(`${newName}/${newName}.md`)).toBe(true);
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 90_000);

	it('asks before it deletes the collective of a deleted folder, and trashes it on agreement', async () => {
		const { collective, name } = await fx.collective('ONC M5 del local');
		await h.sync();
		h.asked.length = 0;
		h.answer = () => 'accept';
		await h.remove(name);

		const outcome = await h.sync();

		expect(h.asked).toEqual([[expect.objectContaining({ kind: 'deleteCollective', collectiveId: collective.id, name })]]);
		expect(outcome.result).toMatchObject({ trashed: 1, failed: 0 });
		expect((await h.clients.collectives.listCollectives()).some((c) => c.id === collective.id && c.trashTimestamp === null)).toBe(false);
		expect(h.state().collectives[String(collective.id)]).toBeUndefined();
	}, 90_000);

	it('restores the folder when the user refuses to delete the collective', async () => {
		const { collective, name } = await fx.collective('ONC M5 keep local');
		await h.sync();
		h.asked.length = 0;
		h.answer = () => 'reject';
		await h.remove(name);

		const outcome = await h.sync();

		expect(h.asked).toHaveLength(1);
		expect(outcome.result).toMatchObject({ trashed: 0, failed: 0 });
		expect((await h.clients.collectives.listCollectives()).some((c) => c.id === collective.id)).toBe(true);
		expect(h.vault.exists(`${name}/${name}.md`)).toBe(true);
	}, 90_000);

	it('asks before it removes the folder of a collective that is gone on the server', async () => {
		const { collective, name } = await fx.collective('ONC M5 del remote');
		await h.sync();
		h.asked.length = 0;
		h.answer = () => 'accept';
		await h.clients.collectives.trashCollective(collective.id);

		const outcome = await h.sync();

		expect(h.asked).toEqual([[expect.objectContaining({ kind: 'removeCollectiveLocal', collectiveId: collective.id, name })]]);
		expect(outcome.result).toMatchObject({ removed: 1, failed: 0 });
		expect(h.vault.exists(name)).toBe(false);
		expect(h.state().collectives[String(collective.id)]).toBeUndefined();
	}, 90_000);

	it('keeps the folder when the user refuses, and treats it as a new folder', async () => {
		const { collective, name } = await fx.collective('ONC M5 keep remote');
		await h.sync();
		h.asked.length = 0;
		h.answer = () => 'reject';
		await h.clients.collectives.trashCollective(collective.id);
		h.settings = { ...h.settings, newFolderBehaviour: 'ignore' };

		const outcome = await h.sync();

		expect(h.asked).toHaveLength(1);
		expect(outcome.result).toMatchObject({ removed: 0, failed: 0 });
		expect(h.vault.exists(`${name}/${name}.md`)).toBe(true);
		expect(h.state().collectives[String(collective.id)]).toBeUndefined();
		h.settings = { ...h.settings, newFolderBehaviour: 'createCollective' };
	}, 90_000);
});

describe('pages between collectives (PLAN §7.4: Collective-übergreifendes Verschieben)', () => {
	let h: Harness;
	let fx: CollectiveFixture;
	let one: Awaited<ReturnType<CollectiveFixture['collective']>>;
	let two: Awaited<ReturnType<CollectiveFixture['collective']>>;
	let wanderer: PageInfo;
	let reisender: PageInfo;
	let eltern: PageInfo;
	let kind: PageInfo;
	beforeAll(async () => {
		h = await Harness.create();
		fx = track(new CollectiveFixture(h.clients));
		one = await fx.collective('ONC M5 cross one');
		two = await fx.collective('ONC M5 cross two');
		wanderer = await fx.page(one.collective, one.landing, 'Wanderer', 'Text Wanderer');
		reisender = await fx.page(one.collective, one.landing, 'Reisender', 'Text Reisender');
		eltern = await fx.page(one.collective, one.landing, 'Eltern', 'Text Eltern');
		kind = await fx.page(one.collective, eltern, 'Kind', 'Text Kind');
		await h.sync();
	}, 120_000);
	afterAll(async () => {
		await fx.cleanup();
	});

	it('moves the page to the other collective when the user moves the file into its folder, keeping the id', async () => {
		await h.rename(`${one.name}/Wanderer.md`, `${two.name}/Wanderer.md`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, uploaded: 0, failed: 0 });
		expect((await pagesOf(h, one.collective)).some((p) => p.id === wanderer.id)).toBe(false);
		const moved = required((await pagesOf(h, two.collective)).find((p) => p.id === wanderer.id), 'moved page');
		expect(moved.parentId).toBe(two.landing.id);
		expect(h.state().pages[String(wanderer.id)]).toMatchObject({ collectiveId: two.collective.id });
		expect(readPageId(await h.vault.read(`${two.name}/Wanderer.md`))).toBe(wanderer.id);
		expect(await remoteText(h, moved)).toBe('Text Wanderer');
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, pushed: 0, failed: 0 });
	}, 90_000);

	it('moves the file to the other folder when the page was moved to another collective on the server', async () => {
		await h.clients.collectives.movePageToCollective(one.collective.id, reisender.id, two.collective.id, { parentId: two.landing.id });

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ moved: 1, failed: 0 });
		expect(h.vault.exists(`${one.name}/Reisender.md`)).toBe(false);
		expect(readPageId(await h.vault.read(`${two.name}/Reisender.md`))).toBe(reisender.id);
		expect(h.state().pages[String(reisender.id)]).toMatchObject({ collectiveId: two.collective.id });
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 90_000);

	it('moves a folder page with its sub-pages when the user moves the folder to the other collective', async () => {
		await h.rename(`${one.name}/Eltern`, `${two.name}/Eltern`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ uploaded: 0, failed: 0 });
		const pages = await pagesOf(h, two.collective);
		const movedParent = required(pages.find((p) => p.id === eltern.id), 'moved parent');
		const movedChild = required(pages.find((p) => p.id === kind.id), 'moved child');
		expect(movedParent.parentId).toBe(two.landing.id);
		expect(movedChild.parentId).toBe(eltern.id);
		expect((await pagesOf(h, one.collective)).some((p) => p.id === eltern.id || p.id === kind.id)).toBe(false);
		expect(h.state().pages[String(kind.id)]).toMatchObject({ collectiveId: two.collective.id });
		expect(readPageId(await h.vault.read(`${two.name}/Eltern/Kind.md`))).toBe(kind.id);
		const again = await h.sync();
		expect(again.result).toMatchObject({ moved: 0, uploaded: 0, failed: 0 });
	}, 120_000);
});
