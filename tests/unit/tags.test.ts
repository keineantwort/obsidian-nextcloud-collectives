// M6 (architecture §7.5): names of tags between the server and a note.
import { describe, expect, it } from 'vitest';
import { findTagByName, inlineTags, resolveTagNames, toObsidianTag } from '../../src/mapping/tags';

describe('toObsidianTag', () => {
	it('turns white space into dashes and drops a leading #', () => {
		expect(toObsidianTag('Mein  Projekt')).toBe('Mein-Projekt');
		expect(toObsidianTag(' #wichtig ')).toBe('wichtig');
		expect(toObsidianTag('a\tb')).toBe('a-b');
	});
});

describe('findTagByName', () => {
	const tags = [{ name: 'Projekt' }, { name: 'projekt' }, { name: 'Mein Tag' }];

	it('prefers the exact name over a name that differs in case', () => {
		expect(findTagByName(tags, 'projekt')).toBe(tags[1]);
		expect(findTagByName(tags, 'Projekt')).toBe(tags[0]);
	});

	it('finds a name regardless of case', () => {
		expect(findTagByName(tags, 'PROJEKT')).toBe(tags[0]);
	});

	it('maps a dashed name back to the tag with a space, but prefers a tag that is really named with the dash', () => {
		expect(findTagByName(tags, 'mein-tag')).toBe(tags[2]);
		const both = [{ name: 'a b' }, { name: 'a-b' }];
		expect(findTagByName(both, 'a-b')).toBe(both[1]);
		expect(findTagByName([{ name: 'a b' }], 'a-b')).toEqual({ name: 'a b' });
	});

	it('finds nothing for an empty name', () => {
		expect(findTagByName(tags, '  ')).toBeUndefined();
	});
});

describe('resolveTagNames', () => {
	it('takes the server spelling of known tags and keeps unknown ones as written', () => {
		expect(resolveTagNames(['projekt', 'Neu'], ['Projekt'])).toEqual(['Projekt', 'Neu']);
	});

	it('drops empty names and repeats, also across spellings', () => {
		expect(resolveTagNames(['a', ' ', 'A', 'b'], [])).toEqual(['a', 'b']);
	});

	it('maps dashed Obsidian tags to the server names and writes unknown ones in Obsidian form', () => {
		expect(resolveTagNames(['mein-tag', '#neu tag'], ['Mein Tag'])).toEqual(['Mein Tag', 'neu-tag']);
		expect(resolveTagNames(['x-y'], [])).toEqual(['x-y']);
	});
});

describe('inlineTags', () => {
	it('finds #tags in running text, with nesting and non-ASCII letters, without repeats', () => {
		expect(inlineTags('Text #Projekt und #a/b, dann #Ärger und #projekt.\n#zweite Zeile')).toEqual(['Projekt', 'a/b', 'Ärger', 'zweite']);
	});

	it('ignores headings, numbers, links, URLs and anchors', () => {
		expect(inlineTags('# Titel\n## Noch einer\n#123 [[Notiz#Abschnitt]] https://x.de/#frag a#b')).toEqual([]);
	});

	it('ignores fenced and inline code', () => {
		expect(inlineTags('```js\n#nope\n```\nText `#auch-nicht` #ja\n~~~\n#nein\n~~~\n#doch')).toEqual(['ja', 'doch']);
	});
});
