// M6 (PLAN §7.5): emoji and tags in both directions against the local Docker Nextcloud, with an in-memory vault.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Collective, PageInfo } from '../../src/api/types';
import { readLocalFields, readNcMeta, replaceNcMeta, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { remotePagePath } from '../../src/mapping/paths';
import { CollectiveFixture, Harness, required, waitPastSecondBoundary } from './harness';

const fixtures: CollectiveFixture[] = [];

afterAll(async () => {
	for (const fx of fixtures) await fx.cleanup();
});

interface Ctx {
	h: Harness;
	fx: CollectiveFixture;
	collective: Collective;
	name: string;
	page: PageInfo;
	path: string;
}

/** A harness with a collective and one note below the landing page, already pulled into the vault. */
async function setup(prefix: string): Promise<Ctx> {
	const h = await Harness.create();
	const fx = new CollectiveFixture(h.clients);
	fixtures.push(fx);
	const { collective, landing, name } = await fx.collective(prefix);
	const page = await fx.page(collective, landing, 'Notiz', 'Inhalt');
	const outcome = await h.sync();
	expect(outcome.result.failed).toBe(0);
	return { h, fx, collective, name, page, path: `${name}/Notiz.md` };
}

async function current(ctx: Ctx): Promise<PageInfo> {
	return ctx.h.clients.collectives.getPage(ctx.collective.id, ctx.page.id);
}

async function tagNames(ctx: Ctx, page: PageInfo): Promise<string[]> {
	const tags = await ctx.h.clients.collectives.listTags(ctx.collective.id);
	return page.tags.map((id) => required(tags.find((tag) => tag.id === id), `tag ${id}`).name).sort();
}

/** The user changes the nc fields of the note in the vault. */
async function userSets(ctx: Ctx, over: Partial<NcMeta>): Promise<void> {
	const text = await ctx.h.vault.read(ctx.path);
	ctx.h.edit(ctx.path, replaceNcMeta(text, { ...required(readNcMeta(text), 'nc fields'), ...over }));
}

describe('server to vault', () => {
	let ctx: Ctx;
	beforeAll(async () => {
		ctx = await setup('ONC M6 pull');
	}, 60_000);

	it('writes emoji and tags set on the server into the nc fields', async () => {
		const { h, collective, page, path } = ctx;
		const tag = await h.clients.collectives.createTag(collective.id, 'Wichtig', '0082c9');
		await h.clients.collectives.setPageEmoji(collective.id, page.id, '📘');
		await h.clients.collectives.addPageTag(collective.id, page.id, tag.id);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ metaUpdated: 1, metaPushed: 0, failed: 0 });
		expect(readLocalFields(await h.vault.read(path))).toEqual({ emoji: '📘', emojiInvalid: false, tags: ['Wichtig'] });
	}, 60_000);

	it('removes them from the note when the server removes them', async () => {
		const { h, collective, page, path } = ctx;
		await h.clients.collectives.setPageEmoji(collective.id, page.id, null);
		const tag = required((await h.clients.collectives.listTags(collective.id)).find((t) => t.name === 'Wichtig'), 'tag');
		await h.clients.collectives.removePageTag(collective.id, page.id, tag.id);

		await h.sync();

		expect(readLocalFields(await h.vault.read(path))).toEqual({ emoji: null, emojiInvalid: false, tags: [] });
	}, 60_000);
});

describe('vault to server', () => {
	let ctx: Ctx;
	beforeAll(async () => {
		ctx = await setup('ONC M6 push');
	}, 60_000);

	it('sets the emoji and creates and assigns tags from the nc fields, without uploading the text', async () => {
		const { h, page } = ctx;
		await waitPastSecondBoundary();
		await userSets(ctx, { emoji: '🚀', tags: ['Projekt', 'Neu'] });
		const since = h.requests.length;

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ metaPushed: 1, pushed: 0, failed: 0 });
		const now = await current(ctx);
		expect(now.emoji).toBe('🚀');
		expect(await tagNames(ctx, now)).toEqual(['Neu', 'Projekt']);
		expect(h.count('PUT', remotePagePath(page), since)).toBe(0);
		expect(h.count('POST', '/tags', since)).toBe(2);
	}, 60_000);

	it('is idle afterwards: no write, no tag call, no upload', async () => {
		const { h } = ctx;
		await waitPastSecondBoundary();
		const since = h.requests.length;
		const writes = h.vault.writes;

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ metaPushed: 0, metaUpdated: 0, pushed: 0, updated: 0, failed: 0 });
		expect(h.vault.writes).toBe(writes);
		expect(h.requests.slice(since).filter((req) => req.method !== 'GET' && req.method !== 'PROPFIND')).toEqual([]);
	}, 60_000);

	it('creates no duplicate tag for a name that differs in case, and uses the server spelling', async () => {
		const { h, collective } = ctx;
		await waitPastSecondBoundary();
		await userSets(ctx, { tags: ['projekt', 'NEU', 'Dritte'] });

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ metaPushed: 1, failed: 0 });
		const tags = await h.clients.collectives.listTags(collective.id);
		expect(tags.map((tag) => tag.name).sort()).toEqual(['Dritte', 'Neu', 'Projekt']);
		expect(await tagNames(ctx, await current(ctx))).toEqual(['Dritte', 'Neu', 'Projekt']);
		expect(readLocalFields(await h.vault.read(ctx.path))?.tags).toEqual(['Projekt', 'Neu', 'Dritte']);
	}, 60_000);

	it('removes a tag the user took out and the emoji the user deleted', async () => {
		const { h } = ctx;
		await waitPastSecondBoundary();
		await userSets(ctx, { emoji: null, tags: ['Neu'] });

		await h.sync();

		const now = await current(ctx);
		expect(now.emoji).toBeNull();
		expect(await tagNames(ctx, now)).toEqual(['Neu']);
	}, 60_000);

	it('treats an emoji changed on both sides like a changed text: conflict copy, the note stays, the text change is still sent', async () => {
		const { h, collective, page, path } = ctx;
		await waitPastSecondBoundary();
		await userSets(ctx, { emoji: '🅰️' });
		await h.clients.collectives.setPageEmoji(collective.id, page.id, '🅱️');
		const text = await h.vault.read(path);
		h.edit(path, `${text}\nZusatz`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ conflicts: 1, failed: 0 });
		expect(outcome.openConflicts).toBe(1);
		expect((await current(ctx)).emoji).toBe('🅱️');
		expect(readLocalFields(await h.vault.read(path))?.emoji).toBe('🅰️');
		expect(await remoteTextOf(ctx)).toContain('Zusatz');
		const copy = required(h.paths(`${ctx.name}/`).find((p) => p.includes('Konflikt') || p.includes('Conflict')), 'conflict copy');
		expect(await h.vault.read(copy)).toContain('nc_emoji: "🅱️"');
	}, 60_000);
});

async function remoteTextOf(ctx: Ctx): Promise<string> {
	return (await ctx.h.clients.webdav.get(remotePagePath(await current(ctx)))).content;
}

describe('tags as the tags property', () => {
	let ctx: Ctx;
	beforeAll(async () => {
		ctx = await setup('ONC M6 tags');
	}, 60_000);

	it('sends Obsidian tags to the server as tags of the collective, and the tags property stays out of the page text', async () => {
		const { h, path } = ctx;
		await waitPastSecondBoundary();
		const text = await h.vault.read(path);
		h.edit(path, text.replace('---\n', '---\ntags: [mein-tag, zweiter]\n'));

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ metaPushed: 1, failed: 0 });
		expect(await tagNames(ctx, await current(ctx))).toEqual(['mein-tag', 'zweiter']);
		const local = await h.vault.read(path);
		expect(readLocalFields(local)?.tags).toEqual(['mein-tag', 'zweiter']);
		// With the tags property the tags are Collectives tags, not page text.
		expect(toRemote(local)).toBe('Inhalt');
		expect(await remoteTextOf(ctx)).toBe('Inhalt');
		expect(local).not.toContain('nc_tags');
	}, 60_000);

	it('maps a tag with a space on the server to a dashed Obsidian tag and back without creating a duplicate', async () => {
		const { h, collective, page, path } = ctx;
		await h.sync(); // settle the content push of the tags property
		await waitPastSecondBoundary();
		const tag = await h.clients.collectives.createTag(collective.id, 'Mein Tag', '0082c9');
		await h.clients.collectives.addPageTag(collective.id, page.id, tag.id);

		await h.sync();

		expect(readLocalFields(await h.vault.read(path))?.tags).toEqual(expect.arrayContaining(['Mein-Tag']));
		await waitPastSecondBoundary();
		const before = (await h.clients.collectives.listTags(collective.id)).length;
		await h.sync();
		expect((await h.clients.collectives.listTags(collective.id)).length).toBe(before);
	}, 90_000);

	it('keeps a dash typed in Obsidian as a dash on the server, and shows a space of the server as a dash', async () => {
		const { h, collective, path } = ctx;
		await h.sync();
		await waitPastSecondBoundary();
		const text = await h.vault.read(path);
		h.edit(path, text.replace(/tags: \[/, 'tags: ["mit-strich", '));

		const outcome = await h.sync();

		expect(outcome.result.failed).toBe(0);
		const names = (await h.clients.collectives.listTags(collective.id)).map((tag) => tag.name);
		expect(names).toContain('mit-strich');
		expect(names).not.toContain('mit strich');
	}, 90_000);

	it('takes a #tag in the text as a tag of the page and keeps it in the property', async () => {
		const { h, path } = ctx;
		await h.sync();
		await waitPastSecondBoundary();
		h.edit(path, `${await h.vault.read(path)}\n\nNoch ein #Inline-Tag im Text\n`);

		const outcome = await h.sync();

		expect(outcome.result).toMatchObject({ failed: 0 });
		expect(await tagNames(ctx, await current(ctx))).toContain('Inline-Tag');
		expect(readLocalFields(await h.vault.read(path))?.tags).toContain('Inline-Tag');
	}, 90_000);
});

describe('notes from before the tags property', () => {
	it('keeps the tags of a note that still has nc_tags, and moves them into the tags property when the server changes them', async () => {
		const ctx = await setup('ONC M6 legacy');
		const { h, collective, page, path } = ctx;
		const tag = await h.clients.collectives.createTag(collective.id, 'Alt', '0082c9');
		await h.clients.collectives.addPageTag(collective.id, page.id, tag.id);
		await h.sync();
		// The note as the plugin wrote it before: tags in nc_tags, no tags property.
		await waitPastSecondBoundary();
		const text = await h.vault.read(path);
		h.edit(path, text.replace(/tags: .*\n/, 'nc_tags: ["Alt"]\n'));

		const first = await h.sync();

		expect(first.result.failed).toBe(0);
		expect(await tagNames(ctx, await current(ctx))).toEqual(['Alt']);

		await waitPastSecondBoundary();
		const other = await h.clients.collectives.createTag(collective.id, 'Neu', '0082c9');
		await h.clients.collectives.addPageTag(collective.id, page.id, other.id);
		await h.sync();
		const now = await h.vault.read(path);
		expect(readLocalFields(now)?.tags).toEqual(['Alt', 'Neu']);
		expect(now).not.toContain('nc_tags');
	}, 120_000);
});

describe('emoji as typed in the properties view', () => {
	it('sends an unquoted nc_emoji and a hand-made Emoji property, and refuses text', async () => {
		const ctx = await setup('ONC M6 emoji');
		const { h, path, page } = ctx;
		const frontmatter = (yaml: string, text: string): string => `---\nnc_page_id: ${page.id}\nnc_collective_id: ${ctx.collective.id}\n${yaml}---\n${text}`;

		await waitPastSecondBoundary();
		h.edit(path, frontmatter('nc_emoji: 🚀\n', 'Inhalt'));
		expect((await h.sync()).result).toMatchObject({ metaPushed: 1, failed: 0 });
		expect((await current(ctx)).emoji).toBe('🚀');

		await waitPastSecondBoundary();
		h.edit(path, frontmatter('Emoji: 🎯\n', 'Inhalt'));
		expect((await h.sync()).result).toMatchObject({ metaPushed: 1, failed: 0 });
		expect((await current(ctx)).emoji).toBe('🎯');
		const text = await h.vault.read(path);
		expect(text).toContain('nc_emoji: "🎯"');
		expect(text).not.toContain('Emoji:');

		await waitPastSecondBoundary();
		h.edit(path, frontmatter('nc_emoji: Hallo Welt\n', 'Inhalt'));
		const refused = await h.sync();
		expect(refused.result).toMatchObject({ metaInvalid: 1, metaPushed: 0, failed: 0 });
		expect((await current(ctx)).emoji).toBe('🎯');
	}, 120_000);
});
