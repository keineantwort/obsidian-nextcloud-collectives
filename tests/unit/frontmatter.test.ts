import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { canonicalRemote, readPageId, replaceNcMeta, toLocal, toRemote } from '../../src/mapping/frontmatter';
import type { NcMeta } from '../../src/mapping/frontmatter';

function meta(over: Partial<NcMeta> = {}): NcMeta {
	return { pageId: asPageId(1), collectiveId: asCollectiveId(2), title: null, emoji: null, tags: [], ...over };
}

const CONTENT_LINKS = readFileSync(new URL('../fixtures/m0/content-links.md', import.meta.url), 'utf8').replace(/\n+$/, '');

/** Remote texts in various shapes: plain, user YAML, odd line endings, unclosed block, fixture. */
const REMOTE_SAMPLES: string[] = [
	'Hallo',
	'',
	'Zeile 1\n\nZeile 2\n',
	'# Überschrift\n\n- Liste\n- Punkt 📘',
	'---\ntitle: Foo\n---\n\nText',
	'---\ntitle: Foo\n---\nOhne Leerzeile',
	'---\ntitle:   Foo  \nliste:\n  - a\n  - b\n---\n\nText\n',
	'---\ntags: [a, b]\n---\n\n',
	'Mit Link [x](Prozesse/Urlaub.md?fileId=100)\n\n\n',
	'---\nnicht geschlossen',
	'---\ntitle: Foo\n---\n\nText\n---\nHR nach dem Block',
	CONTENT_LINKS,
];

/** Texts already in canonical remote form (end without newline, blank line after user YAML). */
const NORMAL_FORM_SAMPLES: string[] = [
	'Hallo',
	'Zeile 1\n\nZeile 2',
	'# Überschrift\n\n- Liste\n- Punkt 📘',
	'---\ntitle: Foo\n---\n\nText',
	CONTENT_LINKS,
];

describe('toLocal', () => {
	it('writes the mandatory nc fields before content without frontmatter', () => {
		expect(toLocal('Hallo', meta())).toBe('---\nnc_page_id: 1\nnc_collective_id: 2\n---\nHallo');
	});

	it('writes title, emoji and tags after the ids in fixed order, with JSON string values', () => {
		const text = toLocal('Hallo', meta({ title: 'A#B', emoji: '📘', tags: ['Projekt', 'Wichtig'] }));
		expect(text).toBe(
			'---\nnc_page_id: 1\nnc_collective_id: 2\nnc_title: "A#B"\nnc_emoji: "📘"\nnc_tags: ["Projekt","Wichtig"]\n---\nHallo',
		);
	});

	it('keeps the user YAML of the remote text after the nc fields', () => {
		expect(toLocal('---\ntitle: Foo\n---\n\nText', meta())).toBe(
			'---\nnc_page_id: 1\nnc_collective_id: 2\ntitle: Foo\n---\n\nText',
		);
	});
});

describe('toRemote', () => {
	it('removes the whole block when only nc fields remain', () => {
		expect(toRemote('---\nnc_page_id: 1\nnc_collective_id: 2\n---\nHallo')).toBe('Hallo');
	});

	it('restores the user YAML and the blank line after it', () => {
		expect(toRemote('---\nnc_page_id: 1\nnc_collective_id: 2\ntitle: Foo\n---\n\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('removes indented block-list continuation lines of nc_tags', () => {
		expect(toRemote('---\nnc_page_id: 1\nnc_tags:\n  - a\n  - b\ntitle: Foo\n---\n\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('removes block-list continuation lines of nc_tags that start in column 0', () => {
		expect(toRemote('---\nnc_page_id: 1\nnc_tags:\n- a\ntitle: Foo\n---\n\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('removes the block when only nc_tags with block-list continuation lines remain', () => {
		expect(toRemote('---\nnc_page_id: 1\nnc_tags:\n  - a\n  - b\n---\n\nText')).toBe('Text');
	});

	it('keeps user fields byte-identical, including extra whitespace', () => {
		expect(toRemote('---\ntitle:   Foo  \nnc_page_id: 1\n---\n\nText')).toBe('---\ntitle:   Foo  \n---\n\nText');
	});

	it('normalizes a user block without blank line to the blank-line form', () => {
		expect(toRemote('---\ntitle: Foo\n---\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('returns text without a block unchanged except for trailing newlines', () => {
		expect(toRemote('Hallo\n\nWelt\n\n')).toBe('Hallo\n\nWelt');
	});

	it('does not treat an unclosed frontmatter start as a block', () => {
		expect(toRemote('---\nnicht geschlossen')).toBe('---\nnicht geschlossen');
	});
});

describe('canonicalRemote', () => {
	it('leaves a text in canonical form unchanged', () => {
		expect(canonicalRemote('---\ntitle: Foo\n---\n\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('adds the blank line after user YAML and drops trailing newlines', () => {
		expect(canonicalRemote('---\ntitle: Foo\n---\nText\n\n')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it.each(NORMAL_FORM_SAMPLES)('keeps normal-form sample #%# unchanged', (remote) => {
		expect(canonicalRemote(remote)).toBe(remote);
	});

	it.each(REMOTE_SAMPLES)('is idempotent for sample #%#', (remote) => {
		const once = canonicalRemote(remote);
		expect(canonicalRemote(once)).toBe(once);
	});
});

describe('round trip toRemote(toLocal(remote, meta))', () => {
	const metas: NcMeta[] = [
		meta(),
		meta({ pageId: asPageId(97), title: 'A#B', emoji: '📘', tags: ['x', 'y'] }),
	];

	it.each(REMOTE_SAMPLES)('equals canonicalRemote for sample #%#, for every meta', (remote) => {
		for (const m of metas) {
			expect(toRemote(toLocal(remote, m))).toBe(canonicalRemote(remote));
		}
	});
});

describe('replaceNcMeta', () => {
	it('rewrites only the nc lines and keeps user YAML and body byte-identical', () => {
		const local = '---\nnc_page_id: 1\nnc_collective_id: 2\ntitle:   Foo  \n---\n\nText  \n\n';
		const result = replaceNcMeta(local, meta({ tags: ['a'] }));
		expect(result.split('\n')).toContain('nc_tags: ["a"]');
		expect(result.split('\n')).toContain('title:   Foo  ');
		expect(result.endsWith('\n---\n\nText  \n\n')).toBe(true);
	});

	it('removes an nc_emoji line when the emoji is null', () => {
		const local = '---\nnc_page_id: 1\nnc_collective_id: 2\nnc_emoji: "📘"\n---\nText';
		expect(replaceNcMeta(local, meta())).toBe('---\nnc_page_id: 1\nnc_collective_id: 2\n---\nText');
	});

	it('prepends a block when the text has none', () => {
		expect(replaceNcMeta('Hallo', meta())).toBe('---\nnc_page_id: 1\nnc_collective_id: 2\n---\nHallo');
	});

	it('returns identical text when the meta is already current', () => {
		const local = toLocal('---\ntitle: Foo\n---\n\nText', meta({ title: 'A#B', tags: ['x'] }));
		expect(replaceNcMeta(local, meta({ title: 'A#B', tags: ['x'] }))).toBe(local);
	});

	it('is idempotent when applied twice with the same meta', () => {
		const once = replaceNcMeta('---\ntitle: Foo\n---\n\nText', meta({ emoji: '📘' }));
		expect(replaceNcMeta(once, meta({ emoji: '📘' }))).toBe(once);
	});
});

describe('readPageId', () => {
	it('reads an unquoted nc_page_id', () => {
		expect(readPageId('---\nnc_page_id: 97\nnc_collective_id: 1\n---\nX')).toBe(97);
	});

	it('reads a quoted nc_page_id', () => {
		expect(readPageId('---\nnc_page_id: "97"\n---\nX')).toBe(97);
	});

	it('returns null when nc_page_id is missing', () => {
		expect(readPageId('---\ntitle: Foo\n---\nX')).toBeNull();
	});

	it('returns null when the text has no frontmatter block', () => {
		expect(readPageId('Text\nnc_page_id: 97')).toBeNull();
	});

	it('ignores nc_page_id that appears after the closing delimiter', () => {
		expect(readPageId('---\ntitle: Foo\n---\nnc_page_id: 97')).toBeNull();
	});

	it('returns null when the value is not a number', () => {
		expect(readPageId('---\nnc_page_id: abc\n---\nX')).toBeNull();
	});
});
