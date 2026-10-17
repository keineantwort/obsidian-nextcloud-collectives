// M8 (PLAN §9.4, ADR 0021): attachment paths, embeds in note text and their conversion.
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import {
	AttachmentIndex, attachmentFolderFor, attachmentUrl, isAttachmentFile, mimeTypeOf, parseAttachmentUrl,
} from '../../src/mapping/attachments';
import { canonicalRemote, toLocal, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';
import { LinkIndex, attachmentRefs, embeddedFiles } from '../../src/mapping/links';

const PAGE = asPageId(10);
const NOTE = 'Coll/Start.md';
const MB = 1024 * 1024;

describe('isAttachmentFile', () => {
	it('is true for files that are no notes', () => {
		expect(isAttachmentFile('Coll/bild.PNG')).toBe(true);
		expect(isAttachmentFile('Coll/doc.pdf')).toBe(true);
		expect(isAttachmentFile('Coll/Notiz.md')).toBe(false);
		expect(isAttachmentFile('Coll/Skizze.canvas')).toBe(false);
		expect(isAttachmentFile('Coll/ohne-endung')).toBe(false);
		expect(isAttachmentFile('Coll/.hidden')).toBe(false);
	});
});

describe('attachmentFolderFor', () => {
	it('puts the pattern next to the note, with the note name for {title}', () => {
		expect(attachmentFolderFor('Coll/Prozesse/Urlaub.md', '_attachments/{title}')).toBe('Coll/Prozesse/_attachments/Urlaub');
		expect(attachmentFolderFor('Coll/Coll.md', 'Anhänge')).toBe('Coll/Anhänge');
		expect(attachmentFolderFor('Top.md', '/files/{title}/')).toBe('files/Top');
	});
});

describe('attachment URLs', () => {
	it('encodes the name and reads it back', () => {
		const url = attachmentUrl(PAGE, 'Bild (1) ä.png');
		expect(url).toBe('.attachments.10/Bild%20%281%29%20%C3%A4.png');
		expect(parseAttachmentUrl(url)).toEqual({ pageId: PAGE, name: 'Bild (1) ä.png' });
		expect(parseAttachmentUrl('./.attachments.10/x.png')).toEqual({ pageId: PAGE, name: 'x.png' });
	});

	it('refuses other URLs', () => {
		expect(parseAttachmentUrl('Ziel.md?fileId=3')).toBeNull();
		expect(parseAttachmentUrl('.attachments.10/sub/x.png')).toBeNull();
		expect(parseAttachmentUrl('https://x/.attachments.10/x.png')).toBeNull();
	});
});

describe('mimeTypeOf', () => {
	it('knows common types and falls back to octet-stream', () => {
		expect(mimeTypeOf('a.PNG')).toBe('image/png');
		expect(mimeTypeOf('a.pdf')).toBe('application/pdf');
		expect(mimeTypeOf('a.xyz')).toBe('application/octet-stream');
		expect(mimeTypeOf('noext')).toBe('application/octet-stream');
	});
});

function attachmentIndex(files: { path: string; size: number }[] = [], known: { name: string; localPath: string }[] = []): AttachmentIndex {
	return new AttachmentIndex({
		files,
		folders: new Map([[PAGE, 'Coll/_attachments/Start']]),
		known: new Map([[PAGE, known]]),
		maxBytes: 20 * MB,
	});
}

describe('AttachmentIndex.resolve', () => {
	it('finds a file by path, relative path and unique name', () => {
		const index = attachmentIndex([{ path: 'Coll/bilder/a.png', size: 5 }, { path: 'Coll/b.png', size: 5 }, { path: 'x/b.png', size: 5 }]);
		expect(index.resolve('Coll/bilder/a.png', NOTE, PAGE)).toEqual({ name: 'a.png', path: 'Coll/bilder/a.png' });
		expect(index.resolve('bilder/a.png', NOTE, PAGE)).toEqual({ name: 'a.png', path: 'Coll/bilder/a.png' });
		expect(index.resolve('a.png', NOTE, PAGE)).toEqual({ name: 'a.png', path: 'Coll/bilder/a.png' });
		expect(index.resolve('b.png', NOTE, PAGE)?.path).toBe('Coll/b.png');
		expect(index.resolve('B.PNG', NOTE, PAGE)?.path).toBe('Coll/b.png');
	});

	it('does not resolve a name two files share, a missing file, or a file above the limit', () => {
		const index = attachmentIndex([{ path: 'a/b.png', size: 5 }, { path: 'c/b.png', size: 5 }, { path: 'Coll/big.zip', size: 21 * MB }]);
		expect(index.resolve('b.png', 'Top.md', PAGE)).toBeUndefined();
		expect(index.resolve('gone.png', NOTE, PAGE)).toBeUndefined();
		expect(index.resolve('Coll/big.zip', NOTE, PAGE)).toBeUndefined();
	});

	it('knows the path an attachment is or will be synced to, although the file is not there', () => {
		const index = attachmentIndex([], [{ name: 'alt.png', localPath: 'Coll/anders/alt.png' }]);
		expect(index.resolve('Coll/_attachments/Start/neu.png', NOTE, PAGE)).toEqual({ name: 'neu.png', path: null });
		expect(index.resolve('coll/anders/alt.png', NOTE, PAGE)).toEqual({ name: 'alt.png', path: null });
		expect(index.resolve('Coll/_attachments/Start/sub/neu.png', NOTE, PAGE)).toBeUndefined();
	});

	it('gives the synced path before the default one', () => {
		const index = attachmentIndex([], [{ name: 'alt.png', localPath: 'Coll/anders/alt.png' }]);
		expect(index.localPath(PAGE, 'alt.png')).toBe('Coll/anders/alt.png');
		expect(index.localPath(PAGE, 'neu.png')).toBe('Coll/_attachments/Start/neu.png');
		expect(index.localPath(asPageId(99), 'x.png')).toBeUndefined();
	});
});

function linkIndex(att: AttachmentIndex | undefined): LinkIndex {
	return new LinkIndex([{
		pageId: PAGE, collectiveId: asCollectiveId(1), collectiveSlug: 'coll', slug: 'Start', landing: false, title: 'Start',
		remotePath: 'Start.md', localPath: NOTE,
	}], undefined, att);
}

const meta: NcMeta = { pageId: PAGE, collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [] };

describe('embeds in note text', () => {
	const files = [{ path: 'Coll/_attachments/Start/bild.png', size: 5 }, { path: 'Coll/Pasted image 1.png', size: 5 }];

	it('turns an embed of the server format into a wikilink to the vault file', () => {
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		const local = toLocal('Vorher ![bild.png](.attachments.10/bild.png) nachher\n', meta, ctx);
		expect(local).toContain('Vorher ![[Coll/_attachments/Start/bild.png]] nachher');
	});

	it('keeps an alt text different from the file name as alias, and the name with special characters decoded', () => {
		const ctx = { index: linkIndex(attachmentIndex([])), sourceId: PAGE };
		const local = toLocal('![Mein Bild](.attachments.10/a%20b.png)\n', meta, ctx);
		expect(local).toContain('![[Coll/_attachments/Start/a b.png|Mein Bild]]');
		expect(toRemote(local, ctx)).toBe('![Mein Bild](.attachments.10/a%20b.png)\n'.trimEnd());
	});

	it('turns a wikilink embed of a pasted file into the server format', () => {
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		expect(toRemote('![[Pasted image 1.png]]\n', ctx)).toBe('![Pasted image 1.png](.attachments.10/Pasted%20image%201.png)');
		expect(toRemote('![[Pasted image 1.png|300]]\n', ctx)).toBe('![300](.attachments.10/Pasted%20image%201.png)');
	});

	it('turns a Markdown embed of a vault file into the server format', () => {
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		expect(toRemote('![Foto](Pasted%20image%201.png)\n', ctx)).toBe('![Foto](.attachments.10/Pasted%20image%201.png)');
		expect(toRemote('![Foto](https://x.example/a.png)\n', ctx)).toBe('![Foto](https://x.example/a.png)');
	});

	it('leaves embeds of notes, missing files, oversized files, code and headings alone', () => {
		const big = attachmentIndex([{ path: 'Coll/big.zip', size: 21 * MB }, ...files]);
		const ctx = { index: linkIndex(big), sourceId: PAGE };
		const text = '![[Andere Notiz]] ![[fehlt.png]] ![[big.zip]] `![[Pasted image 1.png]]` ![[Pasted image 1.png#x]]\n';
		expect(toRemote(text, ctx)).toBe(text.trimEnd());
	});

	it('does nothing without an attachment index', () => {
		const ctx = { index: linkIndex(undefined), sourceId: PAGE };
		expect(toRemote('![[Pasted image 1.png]]\n', ctx)).toBe('![[Pasted image 1.png]]');
		expect(toLocal('![](.attachments.10/x.png)\n', meta, ctx)).toContain('![](.attachments.10/x.png)');
	});

	it('round-trips: toRemote(toLocal(x)) is the canonical remote text, for every spelling of an embed', () => {
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		for (const remote of ['![bild.png](.attachments.10/bild.png)', '![](.attachments.10/bild.png)', '![Titel](.attachments.10/bild.png)', '![x](.attachments.10/a%20(1).png)']) {
			const canonical = canonicalRemote(remote, ctx);
			expect(canonical).not.toContain('![[');
			expect(canonicalRemote(canonical, ctx)).toBe(canonical);
			expect(toRemote(toLocal(canonical, meta, ctx), ctx)).toBe(canonical);
		}
		expect(canonicalRemote('![](.attachments.10/bild.png)', ctx)).toBe('![bild.png](.attachments.10/bild.png)');
	});

	it('leaves the embed of another page alone', () => {
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		expect(toLocal('![x](.attachments.99/x.png)\n', meta, ctx)).toContain('![x](.attachments.99/x.png)');
	});
});

describe('attachmentRefs and embeddedFiles', () => {
	it('lists the files a page embeds, once each, outside code', () => {
		const text = '![a](.attachments.10/a.png) ![a](.attachments.10/a.png) ![b](.attachments.11/b.png) [l](.attachments.10/l.pdf) `![c](.attachments.10/c.png)`\n';
		expect(attachmentRefs(text, PAGE)).toEqual(['a.png']);
	});

	it('lists the vault files a note embeds, and null for planned paths without a file', () => {
		const files = [{ path: 'Coll/Pasted image 1.png', size: 5 }];
		const ctx = { index: linkIndex(attachmentIndex(files)), sourceId: PAGE };
		const found = embeddedFiles('![[Pasted image 1.png]] ![](Pasted%20image%201.png) ![[Coll/_attachments/Start/neu.png]] ![[Notiz]]\n', ctx);
		expect([...found]).toEqual([['Pasted image 1.png', 'Coll/Pasted image 1.png'], ['neu.png', null]]);
	});
});

describe('attachment scope (security)', () => {
	it('does not resolve files outside the collective folder of the note, so server text cannot make them upload', () => {
		const index = attachmentIndex([{ path: 'Privat/steuer.pdf', size: 5 }, { path: 'Coll/ok.png', size: 5 }]);
		expect(index.resolve('Privat/steuer.pdf', NOTE, PAGE)).toBeUndefined();
		expect(index.resolve('steuer.pdf', NOTE, PAGE)).toBeUndefined();
		expect(index.resolve('../Privat/steuer.pdf', NOTE, PAGE)).toBeUndefined();
		expect(index.resolve('ok.png', NOTE, PAGE)?.path).toBe('Coll/ok.png');
	});

	it('rejects unsafe attachment names', () => {
		for (const name of ['..%2Fx.png', 'a%5Cb.png', '.hidden.png', 'a%00b.png', 'a%3Fb.png']) {
			expect(parseAttachmentUrl(`.attachments.10/${name}`)).toBeNull();
		}
	});
});
