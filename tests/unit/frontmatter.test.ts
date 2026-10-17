import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { canonicalRemote, pageIdFromFrontmatterValue, readLocalFields, readNcMeta, readPageId, replaceNcMeta, stripNcMeta, toLocal, toRemote } from '../../src/mapping/frontmatter';
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

	it.each([
		{ name: 'a double-quoted key', text: '---\n"nc_page_id": 9\n---\nX' },
		{ name: 'a single-quoted key with a space before the colon', text: "---\n'nc_page_id' : 9\n---\nX" },
	])('reads nc_page_id written with $name', ({ text }) => {
		expect(readPageId(text)).toBe(9);
	});

	it('takes the first nc_page_id line when the block contains two', () => {
		expect(readPageId('---\nnc_page_id: 5\n"nc_page_id": 9\n---\nX')).toBe(5);
	});
});

describe('CRLF texts', () => {
	const CRLF_TEXT = '---\r\ntitle: Foo\r\n---\r\n\r\nText';

	it('writes the nc fields and the user YAML with CRLF line endings and keeps the body bytes', () => {
		expect(toLocal(CRLF_TEXT, meta())).toBe('---\r\nnc_page_id: 1\r\nnc_collective_id: 2\r\ntitle: Foo\r\n---\r\n\r\nText');
	});

	it('removes the nc lines of a CRLF local text and keeps the user YAML with CRLF', () => {
		expect(toRemote('---\r\nnc_page_id: 1\r\nnc_collective_id: 2\r\ntitle: Foo\r\n---\r\n\r\nText')).toBe(CRLF_TEXT);
	});

	it('removes the whole CRLF block when only nc fields remain', () => {
		expect(toRemote('---\r\nnc_page_id: 1\r\nnc_collective_id: 2\r\n---\r\n\r\nText')).toBe('Text');
	});

	it('adds the CRLF blank line after the user YAML and drops trailing CRLF line breaks', () => {
		expect(canonicalRemote('---\r\ntitle: Foo\r\n---\r\nText\r\n')).toBe(CRLF_TEXT);
	});

	it.each([CRLF_TEXT, '---\r\ntitle: Foo\r\n---\r\nText\r\n'])('round-trips the CRLF sample %j to its canonical form', (remote) => {
		const canonical = canonicalRemote(remote);
		expect(toRemote(toLocal(remote, meta({ title: 'A#B', tags: ['x'] })))).toBe(canonical);
		expect(canonicalRemote(canonical)).toBe(canonical);
	});
});

describe('BOM at the start of a text', () => {
	const BOM = '﻿';

	it('keeps the BOM in front of a block that is written for a text without frontmatter', () => {
		expect(toLocal(`${BOM}Hallo`, meta())).toBe(`${BOM}---\nnc_page_id: 1\nnc_collective_id: 2\n---\nHallo`);
	});

	it('finds the frontmatter block behind the BOM and keeps the BOM in front of it', () => {
		expect(toLocal(`${BOM}---\ntitle: Foo\n---\n\nText`, meta())).toBe(
			`${BOM}---\nnc_page_id: 1\nnc_collective_id: 2\ntitle: Foo\n---\n\nText`,
		);
	});

	it('keeps the BOM when the nc fields are removed in toRemote', () => {
		expect(toRemote(`${BOM}---\nnc_page_id: 1\nnc_collective_id: 2\ntitle: Foo\n---\n\nText`)).toBe(`${BOM}---\ntitle: Foo\n---\n\nText`);
	});

	it('round-trips a BOM text without nc fields to itself', () => {
		expect(toRemote(toLocal(`${BOM}Hallo`, meta()))).toBe(`${BOM}Hallo`);
	});

	it('replaces the nc lines behind the BOM and keeps the BOM', () => {
		expect(replaceNcMeta(`${BOM}---\nnc_page_id: 1\nnc_collective_id: 2\n---\nText`, meta({ tags: ['a'] }))).toBe(
			`${BOM}---\nnc_page_id: 1\nnc_collective_id: 2\nnc_tags: ["a"]\n---\nText`,
		);
	});

	it('reads nc_page_id behind the BOM', () => {
		expect(readPageId(`${BOM}---\nnc_page_id: 97\n---\nX`)).toBe(97);
	});
});

describe('quoted nc keys', () => {
	it('removes a double-quoted nc key line and its value in toRemote', () => {
		expect(toRemote('---\n"nc_page_id": 1\n"nc_collective_id": 2\ntitle: Foo\n---\n\nText')).toBe('---\ntitle: Foo\n---\n\nText');
	});

	it('replaces a quoted nc_emoji line in replaceNcMeta', () => {
		const local = '---\nnc_page_id: 1\nnc_collective_id: 2\n"nc_emoji": "📘"\n---\nText';
		expect(replaceNcMeta(local, meta())).toBe('---\nnc_page_id: 1\nnc_collective_id: 2\n---\nText');
	});
});

describe('pageIdFromFrontmatterValue', () => {
	it.each<{ name: string; value: unknown; expected: number | undefined }>([
		{ name: 'maps an integer to its page id', value: 97, expected: 97 },
		{ name: 'maps zero to page id 0', value: 0, expected: 0 },
		{ name: 'maps a string of digits to its page id', value: '97', expected: 97 },
		{ name: 'maps the string "0" to page id 0', value: '0', expected: 0 },
		{ name: 'rejects a fraction', value: 1.5, expected: undefined },
		{ name: 'rejects a negative number', value: -1, expected: undefined },
		{ name: 'rejects NaN', value: Number.NaN, expected: undefined },
		{ name: 'rejects a non-numeric string', value: 'abc', expected: undefined },
		{ name: 'rejects an empty string', value: '', expected: undefined },
		{ name: 'rejects a string with surrounding whitespace', value: ' 9', expected: undefined },
		{ name: 'rejects a string with a trailing letter', value: '9x', expected: undefined },
		{ name: 'rejects an exponent string', value: '1e3', expected: undefined },
		{ name: 'rejects null', value: null, expected: undefined },
		{ name: 'rejects a missing value', value: undefined, expected: undefined },
		{ name: 'rejects a boolean', value: true, expected: undefined },
		{ name: 'rejects an object', value: {}, expected: undefined },
	])('$name', ({ value, expected }) => {
		expect(pageIdFromFrontmatterValue(value)).toBe(expected);
	});
});

describe('readNcMeta and stripNcMeta', () => {
	const meta: NcMeta = { pageId: asPageId(12), collectiveId: asCollectiveId(3), title: 'Alt/Titel', emoji: '📘', tags: ['a', 'b c'] };

	it('reads back what replaceNcMeta wrote', () => {
		expect(readNcMeta(replaceNcMeta('Text', meta))).toEqual(meta);
	});

	it('reads the required fields only and treats the optional ones as absent', () => {
		const text = '---\nnc_page_id: 5\nnc_collective_id: 2\nnc_tags: nope\n---\nText';

		expect(readNcMeta(text)).toEqual({ pageId: 5, collectiveId: 2, title: null, emoji: null, tags: [] });
	});

	it('returns null without nc_page_id or nc_collective_id', () => {
		expect(readNcMeta('Text')).toBeNull();
		expect(readNcMeta('---\nnc_page_id: 5\n---\nText')).toBeNull();
	});

	it('removes the nc fields and drops an empty block', () => {
		expect(stripNcMeta(replaceNcMeta('Text', meta))).toBe('Text');
	});

	it('keeps the user YAML and the body byte-identical', () => {
		const text = replaceNcMeta('---\nauthor: "Ann"\n---\n\nText\n', meta);

		expect(stripNcMeta(text)).toBe('---\nauthor: "Ann"\n---\n\nText\n');
	});

	it('leaves a text without frontmatter alone', () => {
		expect(stripNcMeta('Nur Text\n')).toBe('Nur Text\n');
	});
});

describe('tags in the frontmatter (M6, PLAN §6.2, §7.5)', () => {
	const meta = (over: Partial<NcMeta> = {}): NcMeta => ({ pageId: asPageId(7), collectiveId: asCollectiveId(1), title: null, emoji: null, tags: [], ...over });

	describe('readLocalFields', () => {
		it('reads nc_emoji and nc_tags', () => {
			const text = '---\nnc_page_id: 7\nnc_collective_id: 1\nnc_emoji: "📘"\nnc_tags: ["A","B C"]\n---\nText';
			expect(readLocalFields(text)).toEqual({ emoji: '📘', tags: ['A', 'B C'] });
		});

		it('returns null without a frontmatter block, and ignores a plain tags property with nc_tags', () => {
			expect(readLocalFields('Text')).toBeNull();
			expect(readLocalFields('---\ntags: [x]\n---\nText')).toEqual({ emoji: null, tags: [] });
		});

		it('reads a flow list, a block list and a scalar from the tags property', () => {
			expect(readLocalFields('---\ntags: [a, "b-c", \'#d\']\n---\n', 'tags')?.tags).toEqual(['a', 'b-c', 'd']);
			expect(readLocalFields('---\ntags:\n  - a\n  - "#b-c"\nother: 1\n---\n', 'tags')?.tags).toEqual(['a', 'b-c']);
			expect(readLocalFields('---\ntags: a, b\n---\n', 'tags')?.tags).toEqual(['a', 'b']);
			expect(readLocalFields('---\ntags: []\nnc_tags: ["x"]\n---\n', 'tags')?.tags).toEqual([]);
		});

		it('adds the #tags of the text with tagsProperty = tags, also for a note without frontmatter, but not with nc_tags', () => {
			const text = '---\ntags: [a]\n---\nText #B und #a und `#c`\n';
			expect(readLocalFields(text, 'tags')?.tags).toEqual(['a', 'B']);
			expect(readLocalFields(text)?.tags).toEqual([]);
			expect(readLocalFields('Nur #Text', 'tags')).toEqual({ emoji: null, tags: ['Text'] });
			expect(readLocalFields('Nur #Text')).toBeNull();
		});

		it('falls back to nc_tags while the note has no tags property', () => {
			expect(readLocalFields('---\nnc_tags: ["x"]\n---\n', 'tags')?.tags).toEqual(['x']);
		});

		it('falls back to nc_tags for a flow list over several lines it cannot read', () => {
			expect(readLocalFields('---\ntags: [a,\n  b]\nnc_tags: ["x"]\n---\n', 'tags')?.tags).toEqual(['x']);
		});
	});

	describe('toLocal with tagsProperty = tags', () => {
		it('writes nc_tags and the tags property in Obsidian form, and replaces the tags the remote text carried', () => {
			const local = toLocal('---\ntags: [alt]\nautor: Ich\n---\n\nText', meta({ tags: ['Mein Tag'], tagsProperty: 'tags' }));
			expect(local).toBe('---\nnc_page_id: 7\nnc_collective_id: 1\nnc_tags: ["Mein Tag"]\ntags: ["Mein-Tag"]\nautor: Ich\n---\n\nText');
		});

		it('removes the tags property when the page has no tags', () => {
			const local = toLocal('---\ntags:\n  - alt\n---\n\nText', meta({ tagsProperty: 'tags' }));
			expect(local).toBe('---\nnc_page_id: 7\nnc_collective_id: 1\n---\n\nText');
		});

		it('leaves the tags property of the user alone with nc_tags', () => {
			const local = replaceNcMeta('---\ntags: [privat]\n---\nText', meta({ tags: ['A'] }));
			expect(local).toBe('---\nnc_page_id: 7\nnc_collective_id: 1\nnc_tags: ["A"]\ntags: [privat]\n---\nText');
		});

		it('keeps the tags property in the remote format: it is page content', () => {
			const local = toLocal('Text', meta({ tags: ['A'], tagsProperty: 'tags' }));
			expect(toRemote(local)).toBe('---\ntags: ["A"]\n---\n\nText');
		});
	});

	it('readNcMeta reads the tags property with tagsProperty = tags', () => {
		const text = '---\nnc_page_id: 7\nnc_collective_id: 1\nnc_tags: ["Alt"]\ntags: [neu]\n---\nText';
		expect(readNcMeta(text)?.tags).toEqual(['Alt']);
		expect(readNcMeta(text, 'tags')).toMatchObject({ tags: ['neu'], tagsProperty: 'tags' });
	});
});
