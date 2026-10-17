// M6 (PLAN §7.5): names of tags between the server and a note.
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
		expect(findTagByName(tags, 'projekt', 'nc_tags')).toBe(tags[1]);
		expect(findTagByName(tags, 'Projekt', 'nc_tags')).toBe(tags[0]);
	});

	it('finds a name regardless of case', () => {
		expect(findTagByName(tags, 'PROJEKT', 'nc_tags')).toBe(tags[0]);
	});

	it('does not match a dashed name with nc_tags, but maps it back to the spaced name with tags', () => {
		expect(findTagByName(tags, 'Mein-Tag', 'nc_tags')).toBeUndefined();
		expect(findTagByName(tags, 'mein-tag', 'tags')).toBe(tags[2]);
	});

	it('finds nothing for an empty name', () => {
		expect(findTagByName(tags, '  ', 'nc_tags')).toBeUndefined();
	});
});

describe('resolveTagNames', () => {
	it('takes the server spelling of known tags and keeps unknown ones as written', () => {
		expect(resolveTagNames(['projekt', 'Neu'], ['Projekt'], 'nc_tags')).toEqual(['Projekt', 'Neu']);
	});

	it('drops empty names and repeats, also across spellings', () => {
		expect(resolveTagNames(['a', ' ', 'A', 'b'], [], 'nc_tags')).toEqual(['a', 'b']);
	});

	it('maps dashed Obsidian tags to the server names and writes unknown ones in Obsidian form', () => {
		expect(resolveTagNames(['mein-tag', '#neu tag'], ['Mein Tag'], 'tags')).toEqual(['Mein Tag', 'neu-tag']);
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
