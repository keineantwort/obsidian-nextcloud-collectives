// M7 (PLAN §9): page links in both directions against the local Docker Nextcloud, with an in-memory vault.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Collective, PageInfo } from '../../src/api/types';
import { remotePagePath } from '../../src/mapping/paths';
import { CollectiveFixture, Harness, required, waitPastSecondBoundary } from './harness';

const fixtures: CollectiveFixture[] = [];

afterAll(async () => {
	for (const fx of fixtures) await fx.cleanup();
});

describe('links', () => {
	let h: Harness;
	let collective: Collective;
	let name: string;
	let source: PageInfo;
	let target: PageInfo;

	async function remoteText(page: PageInfo): Promise<string> {
		const current = await h.clients.collectives.getPage(collective.id, page.id);
		return (await h.clients.webdav.get(remotePagePath(current))).content;
	}

	async function setRemote(page: PageInfo, text: string): Promise<void> {
		const current = await h.clients.collectives.getPage(collective.id, page.id);
		const path = remotePagePath(current);
		await waitPastSecondBoundary();
		await h.clients.webdav.put(path, text, { ifMatch: (await h.clients.webdav.get(path)).etag });
	}

	beforeAll(async () => {
		h = await Harness.create();
		const fx = new CollectiveFixture(h.clients);
		fixtures.push(fx);
		const made = await fx.collective('ONC M7');
		collective = made.collective;
		name = made.name;
		target = await fx.page(collective, made.landing, 'Ziel', 'Zielseite');
		source = await fx.page(collective, made.landing, 'Quelle', 'Noch ohne Link');
		expect((await h.sync()).result.failed).toBe(0);
	}, 60_000);

	it('turns a link set in Collectives (picker format) into a wikilink and does not push it back', async () => {
		const url = `${h.env.baseUrl}/index.php/apps/collectives/${collective.slug}-${collective.id}/${target.slug}-${target.id}`;
		await setRemote(source, `Siehe [Ziel](${url}) und [Anderer Text](${url}).\n`);

		const pulled = await h.sync();

		expect(pulled.result).toMatchObject({ updated: 1, pushed: 0, conflicts: 0, failed: 0 });
		const text = await h.vault.read(`${name}/Quelle.md`);
		expect(text).toContain(`Siehe [[${name}/Ziel]] und [[${name}/Ziel|Anderer Text]].`);

		const again = await h.sync();
		expect(again.result).toMatchObject({ pushed: 0, updated: 0, conflicts: 0, failed: 0 });
	}, 60_000);

	it('writes a wikilink set in Obsidian as a link Collectives recognizes as a page link', async () => {
		const path = `${name}/Quelle.md`;
		const text = await h.vault.read(path);
		h.edit(path, `${text.trimEnd()}\nNeu: [[${name}/Ziel#Abschnitt|mit Text]] und [[Tagebuch]].\n`);

		const pushed = await h.sync();

		expect(pushed.result).toMatchObject({ pushed: 1, conflicts: 0, failed: 0 });
		const remote = await remoteText(source);
		expect(remote).toContain(`[Ziel](Ziel.md?fileId=${target.id})`);
		expect(remote).toContain(`[mit Text](Ziel.md?fileId=${target.id}#Abschnitt)`);
		expect(remote).toContain('[[Tagebuch]]');
		const page = await h.clients.collectives.getPage(collective.id, source.id);
		expect(page.linkedPageIds).toContain(target.id);

		const again = await h.sync();
		expect(again.result).toMatchObject({ pushed: 0, updated: 0, conflicts: 0, failed: 0 });
		expect(await h.vault.read(path)).toContain(`[[${name}/Ziel#Abschnitt|mit Text]]`);
	}, 60_000);

	it('keeps the link working after the target is renamed in Obsidian', async () => {
		await h.rename(`${name}/Ziel.md`, `${name}/Ziel neu.md`);
		const renamed = await h.sync();
		expect(renamed.result.failed).toBe(0);

		const remote = await remoteText(source);
		expect(remote).toContain(`fileId=${target.id}`);
		const page = await h.clients.collectives.getPage(collective.id, source.id);
		expect(page.linkedPageIds).toContain(required(target, 'target').id);
	}, 60_000);
});
