import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { canonicalRemote, toLocal, toRemote } from '../../src/mapping/frontmatter';
import { LinkIndex, linksToLocal, linksToRemote } from '../../src/mapping/links';
import type { LinkContext, LinkTarget } from '../../src/mapping/links';

function target(id: number, over: Partial<LinkTarget> & Pick<LinkTarget, 'title' | 'remotePath' | 'localPath'>): LinkTarget {
	return { pageId: asPageId(id), collectiveId: asCollectiveId(1), collectiveSlug: 'Handbuch', slug: over.title.replace(/ /g, '-'), landing: false, ...over };
}

const pages: LinkTarget[] = [
	target(97, { title: 'Handbuch', remotePath: 'Readme.md', localPath: 'Handbuch/Handbuch.md', landing: true }),
	target(98, { title: 'Prozesse', remotePath: 'Prozesse/Readme.md', localPath: 'Handbuch/Prozesse/Prozesse.md' }),
	target(100, { title: 'Urlaub', remotePath: 'Prozesse/Urlaub.md', localPath: 'Handbuch/Prozesse/Urlaub.md' }),
	target(101, { title: 'Onboarding', remotePath: 'Onboarding.md', localPath: 'Handbuch/Onboarding.md' }),
	target(102, { title: 'Reisen & Spesen (neu)', remotePath: 'Reisen & Spesen (neu).md', localPath: 'Handbuch/Reisen & Spesen (neu).md' }),
	target(200, { title: 'Wiki', remotePath: 'Readme.md', localPath: 'Wiki/Wiki.md', collectiveId: asCollectiveId(2), collectiveSlug: 'Team Wiki', landing: true, slug: 'Wiki' }),
	target(201, { title: 'Server', remotePath: 'Server.md', localPath: 'Wiki/Server.md', collectiveId: asCollectiveId(2), collectiveSlug: 'Team Wiki' }),
	target(300, { title: 'Ohne Datei', remotePath: 'Ohne Datei.md', localPath: null }),
];
const index = new LinkIndex(pages);
const from = (id: number): LinkContext => ({ index, sourceId: asPageId(id) });

describe('linksToLocal', () => {
	it('converts the relative form with fileId (Fixture content-links.md)', () => {
		expect(linksToLocal('[Urlaub](Prozesse/Urlaub.md?fileId=100)', from(101))).toBe('[[Handbuch/Prozesse/Urlaub]]');
	});

	it('keeps the link text as alias if it differs from the title', () => {
		expect(linksToLocal('[freie Tage](Prozesse/Urlaub.md?fileId=100)', from(101))).toBe('[[Handbuch/Prozesse/Urlaub|freie Tage]]');
	});

	it('converts the absolute form the Collectives link picker writes, with and without index.php', () => {
		expect(linksToLocal('[Onboarding](https://cloud.example.test/index.php/apps/collectives/Handbuch-1/Onboarding-101)', from(100))).toBe('[[Handbuch/Onboarding]]');
		expect(linksToLocal('[Onboarding](https://cloud.example.test/apps/collectives/Handbuch-1/Onboarding-101)', from(100))).toBe('[[Handbuch/Onboarding]]');
	});

	it('converts the root-relative form and takes the anchor over', () => {
		expect(linksToLocal('[Prozesse](/index.php/apps/collectives/Handbuch-1/Prozesse-98#abschnitt)', from(100))).toBe('[[Handbuch/Prozesse/Prozesse#abschnitt]]');
	});

	it('resolves a relative path without fileId against the source page', () => {
		expect(linksToLocal('[Urlaub](Urlaub.md)', from(98))).toBe('[[Handbuch/Prozesse/Urlaub]]');
		expect(linksToLocal('[Onboarding](../Onboarding.md)', from(100))).toBe('[[Handbuch/Onboarding]]');
	});

	it('converts the landing page URL of a collective', () => {
		expect(linksToLocal('[Wiki](/apps/collectives/Team%20Wiki-2)', from(100))).toBe('[[Wiki/Wiki]]');
	});

	it('leaves external, unknown, file-less and attachment links alone', () => {
		const text = [
			'[Nextcloud](https://nextcloud.com)',
			'[x](Prozesse/Unbekannt.md?fileId=999)',
			'[x](Ohne%20Datei.md?fileId=300)',
			'![bild.png](.attachments.97/bild.png)',
			'[Datei](.attachments.97/datei.pdf)',
			'[mail](mailto:a@b.de)',
		].join('\n');
		expect(linksToLocal(text, from(101))).toBe(text);
	});

	it('leaves code alone', () => {
		const text = 'Inline `[Urlaub](Prozesse/Urlaub.md?fileId=100)` und\n\n```\n[Urlaub](Prozesse/Urlaub.md?fileId=100)\n```\n\n~~~md\n[Urlaub](Prozesse/Urlaub.md?fileId=100)\n~~~\n';
		expect(linksToLocal(text, from(101))).toBe(text);
		expect(linksToLocal(`${text}[Urlaub](Prozesse/Urlaub.md?fileId=100)`, from(101))).toBe(`${text}[[Handbuch/Prozesse/Urlaub]]`);
	});

	it('does not reach other collectives with a bare fileId or a URL that does not name them', () => {
		const crafted = ['[x](Server.md?fileId=201)', '[x](/apps/collectives/q-7/Server-201)', '[x](/apps/collectives/q-2)', '[x](/apps/collectives/Team%20Wiki-9/Server-201)'].join('\n');
		expect(linksToLocal(crafted, from(101))).toBe(crafted);
		expect(linksToLocal('[x](/apps/collectives/Team%20Wiki-2/Server-201)', from(101))).toBe('[[Wiki/Server|x]]');
	});

	it('treats absolute URLs of another host as external', () => {
		const own = new LinkIndex(pages, 'https://cloud.example.test');
		const ctx = { index: own, sourceId: asPageId(101) };
		expect(linksToLocal('[a](https://evil.example/apps/collectives/Handbuch-1/Urlaub-100)', ctx)).toBe('[a](https://evil.example/apps/collectives/Handbuch-1/Urlaub-100)');
		expect(linksToLocal('[Urlaub](https://CLOUD.example.test/apps/collectives/Handbuch-1/Urlaub-100)', ctx)).toBe('[[Handbuch/Prozesse/Urlaub]]');
	});

	it('handles a long line of brackets in linear time', () => {
		const text = '['.repeat(200_000);
		const start = Date.now();
		expect(linksToLocal(text, from(101))).toBe(text);
		expect(Date.now() - start).toBeLessThan(1000);
	});

	it('does not put a line break from a decoded anchor into a wikilink', () => {
		const text = '[t](Prozesse/Urlaub.md?fileId=100#a%0Ab)';
		expect(linksToLocal(text, from(101))).toBe(text);
	});

	it('does nothing without a context', () => {
		expect(linksToLocal('[Urlaub](Prozesse/Urlaub.md?fileId=100)', undefined)).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
	});
});

describe('linksToRemote', () => {
	it('writes the relative form with fileId (ADR 0008)', () => {
		expect(linksToRemote('[[Handbuch/Prozesse/Urlaub]]', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
		expect(linksToRemote('[[Handbuch/Onboarding|Start]]', from(100))).toBe('[Start](../Onboarding.md?fileId=101)');
	});

	it('resolves a short name, relative to the note, and with .md', () => {
		expect(linksToRemote('[[Urlaub]]', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
		expect(linksToRemote('[[Urlaub.md]]', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
		expect(linksToRemote('[[Prozesse/Urlaub]]', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
	});

	it('takes the heading over', () => {
		expect(linksToRemote('[[Urlaub#Antrag stellen]]', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100#Antrag%20stellen)');
	});

	it('encodes characters a Markdown destination cannot hold', () => {
		expect(linksToRemote('[[Reisen & Spesen (neu)]]', from(101))).toBe('[Reisen & Spesen (neu)](Reisen%20%26%20Spesen%20%28neu%29.md?fileId=102)');
	});

	it('links into another collective with the root-relative URL', () => {
		expect(linksToRemote('[[Wiki/Server]]', from(101))).toBe('[Server](/apps/collectives/Team%20Wiki-2/Server-201)');
		expect(linksToRemote('[[Wiki/Wiki]]', from(101))).toBe('[Wiki](/apps/collectives/Team%20Wiki-2)');
	});

	it('treats Markdown links to notes like wikilinks', () => {
		expect(linksToRemote('[Urlaub](Prozesse/Urlaub.md)', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100)');
		expect(linksToRemote('[Urlaub](Handbuch/Prozesse/Urlaub.md#Antrag)', from(101))).toBe('[Urlaub](Prozesse/Urlaub.md?fileId=100#Antrag)');
	});

	it('leaves links outside the sync area, embeds, URLs and code alone', () => {
		const text = ['[[Tagebuch]]', '[[Ohne Datei]]', '![[bild.png]]', '![](bild.png)', '[x](https://example.test)', '`[[Urlaub]]`', '[[#Kopf]]'].join('\n');
		expect(linksToRemote(text, from(101))).toBe(text);
	});

	it('does not touch the frontmatter', () => {
		const text = '---\nverwandt: "[[Urlaub]]"\n---\n[[Urlaub]]';
		expect(linksToRemote(text, from(101))).toBe('---\nverwandt: "[[Urlaub]]"\n---\n[Urlaub](Prozesse/Urlaub.md?fileId=100)');
	});

	it('does not resolve an ambiguous short name', () => {
		const dup = new LinkIndex([
			target(1, { title: 'A', remotePath: 'A.md', localPath: 'C/A.md' }),
			target(2, { title: 'Notiz', remotePath: 'Notiz.md', localPath: 'C/x/Notiz.md' }),
			target(3, { title: 'Notiz', remotePath: 'y/Notiz.md', localPath: 'C/y/Notiz.md' }),
		]);
		expect(linksToRemote('[[Notiz]]', { index: dup, sourceId: asPageId(1) })).toBe('[[Notiz]]');
	});
});

describe('round trip (PLAN §9.3)', () => {
	const remoteFixtures = [
		'[Urlaub](Prozesse/Urlaub.md?fileId=100)',
		'[freie Tage](Prozesse/Urlaub.md?fileId=100#Antrag%20stellen)',
		'[Reisen & Spesen (neu)](Reisen%20%26%20Spesen%20%28neu%29.md?fileId=102)',
		'[Server](/apps/collectives/Team%20Wiki-2/Server-201)',
		'[Wiki](/apps/collectives/Team%20Wiki-2)',
		'Text [Urlaub](Prozesse/Urlaub.md?fileId=100) und [Nextcloud](https://nextcloud.com) und `[x](y.md)`.\n\n![bild.png](.attachments.101/bild.png)',
	];
	const localFixtures = [
		'[[Handbuch/Prozesse/Urlaub]]',
		'[[Handbuch/Prozesse/Urlaub#Antrag stellen|freie Tage]]',
		'[[Handbuch/Reisen & Spesen (neu)]]',
		'[[Wiki/Server]]',
		'[[Wiki/Wiki]]',
		'Text [[Handbuch/Prozesse/Urlaub]] und [[Tagebuch]] und ![[bild.png]] und `[[Urlaub]]`.',
	];

	it.each(remoteFixtures)('toRemote(toLocal(x)) == x: %s', (remote) => {
		const local = linksToLocal(remote, from(101));
		expect(linksToRemote(local, from(101))).toBe(remote);
	});

	it.each(localFixtures)('toLocal(toRemote(y)) == y: %s', (local) => {
		const remote = linksToRemote(local, from(101));
		expect(linksToLocal(remote, from(101))).toBe(local);
	});

	it('round-trips from a source page in a sub-folder', () => {
		const remote = '[Onboarding](../Onboarding.md?fileId=101) [Urlaub](Urlaub.md?fileId=100)';
		expect(linksToRemote(linksToLocal(remote, from(98)), from(98))).toBe(remote);
	});
});

describe('with frontmatter and canonical form', () => {
	const meta = { pageId: asPageId(101), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] };

	it('toLocal/toRemote convert only the body and the hash input is the remote format', () => {
		const remote = 'Siehe [Urlaub](Prozesse/Urlaub.md?fileId=100)';
		const local = toLocal(remote, meta, from(101));
		expect(local).toContain('Siehe [[Handbuch/Prozesse/Urlaub]]');
		expect(toRemote(local, from(101))).toBe(remote);
		expect(canonicalRemote(remote, from(101))).toBe(remote);
	});

	it('local and remote hash input agree for every remote form of the same link', () => {
		const forms = [
			'[Urlaub](Prozesse/Urlaub.md?fileId=100)',
			'[Urlaub](https://cloud.example.test/index.php/apps/collectives/Handbuch-1/Prozesse-98/Urlaub-100)',
			'[Urlaub](/apps/collectives/Handbuch-1/Prozesse-98/Urlaub-100)',
		];
		const canon = new Set(forms.map((form) => canonicalRemote(form, from(101))));
		expect(canon).toEqual(new Set(['[Urlaub](Prozesse/Urlaub.md?fileId=100)']));
	});

	it('follows a renamed target: the local link and the stale remote path give the same canonical text', () => {
		const renamed = new LinkIndex(pages.map((p) => (p.pageId === 100 ? { ...p, remotePath: 'Prozesse/Ferien.md', localPath: 'Handbuch/Prozesse/Ferien.md' } : p)));
		const ctx = { index: renamed, sourceId: asPageId(101) };
		expect(toRemote('[[Handbuch/Prozesse/Ferien]]', ctx)).toBe(canonicalRemote('[Urlaub](Prozesse/Urlaub.md?fileId=100)', ctx));
		expect(toRemote('[[Handbuch/Prozesse/Ferien]]', ctx)).toBe('[Urlaub](Prozesse/Ferien.md?fileId=100)');
	});
});

describe('server under a sub-path', () => {
	const sub = new LinkIndex(pages, 'https://host.example/nextcloud/');
	const ctx = { index: sub, sourceId: asPageId(101) };

	it('reads picker links with the sub-path and writes cross-collective links with it', () => {
		expect(linksToLocal('[Urlaub](https://host.example/nextcloud/index.php/apps/collectives/Handbuch-1/Prozesse-98/Urlaub-100)', ctx)).toBe('[[Handbuch/Prozesse/Urlaub]]');
		expect(linksToRemote('[[Wiki/Server]]', ctx)).toBe('[Server](/nextcloud/apps/collectives/Team%20Wiki-2/Server-201)');
		expect(linksToLocal('[Server](/nextcloud/apps/collectives/Team%20Wiki-2/Server-201)', ctx)).toBe('[[Wiki/Server]]');
	});

	it('ignores root-relative links outside the sub-path', () => {
		const text = '[Server](/apps/collectives/Team%20Wiki-2/Server-201)';
		expect(linksToLocal(text, ctx)).toBe(text);
	});
});
