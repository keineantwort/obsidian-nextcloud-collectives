// Display-only helpers: page emoji in titles, labels of the plugin's properties.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { clearEmoji, decorateExplorer, decorateView, emojiFromFrontmatter } from '../../src/ui/emojiTitles';
import { applyPropertyLabels, cssString } from '../../src/ui/propertyLabels';

function dom(html: string): ParentNode {
	return new JSDOM(`<body>${html}</body>`).window.document.body;
}

const EXPLORER = `
<div class="nav-file-title" data-path="Coll/A.md"><div class="nav-file-title-content">A</div></div>
<div class="nav-file-title" data-path="Coll/B.md"><div class="nav-file-title-content">B</div></div>`;

describe('emojiFromFrontmatter', () => {
	it('takes a short non-empty string, trimmed', () => {
		expect(emojiFromFrontmatter(' 📘 ')).toBe('📘');
		expect(emojiFromFrontmatter('')).toBeNull();
		expect(emojiFromFrontmatter(5)).toBeNull();
		expect(emojiFromFrontmatter(undefined)).toBeNull();
		expect(emojiFromFrontmatter('x'.repeat(40))).toBeNull();
	});
});

describe('decorateExplorer', () => {
	it('marks the titles of notes with an emoji, leaves the others, and removes a mark that is no longer valid', () => {
		const root = dom(EXPLORER);
		const emojis: Record<string, string | null> = { 'Coll/A.md': '📘', 'Coll/B.md': null };

		decorateExplorer(root, (path) => emojis[path] ?? null);
		const contents = Array.from(root.querySelectorAll('.nav-file-title-content'));
		expect(contents.map((el) => el.getAttribute('data-nc-emoji'))).toEqual(['📘', null]);

		emojis['Coll/A.md'] = null;
		decorateExplorer(root, (path) => emojis[path] ?? null);
		expect(contents[0]?.hasAttribute('data-nc-emoji')).toBe(false);
	});

	it('never changes the visible title text', () => {
		const root = dom(EXPLORER);
		decorateExplorer(root, () => '📘');
		expect(Array.from(root.querySelectorAll('.nav-file-title-content')).map((el) => el.textContent)).toEqual(['A', 'B']);
	});
});

describe('decorateView and clearEmoji', () => {
	it('marks the inline title and the header title, and clearEmoji removes every mark', () => {
		const root = dom('<div class="view-header-title">T</div><div class="inline-title">T</div>');

		decorateView(root, '🚀');
		expect(root.querySelector('.inline-title')?.getAttribute('data-nc-emoji')).toBe('🚀');
		expect(root.querySelector('.view-header-title')?.getAttribute('data-nc-emoji')).toBe('🚀');

		clearEmoji(root);
		expect(root.querySelectorAll('[data-nc-emoji]')).toHaveLength(0);
	});
});

describe('applyPropertyLabels', () => {
	it('sets a quoted label per property in the language and removes them again', () => {
		const set: Record<string, string> = {};
		const removed: string[] = [];
		const body = { setCssProps: (props: Record<string, string>) => Object.assign(set, props), style: { removeProperty: (name: string) => { removed.push(name); return ''; } } };

		const undo = applyPropertyLabels(body, createTranslator('de'));

		expect(set['--nc-label-nc-page-id']).toBe('"Seiten-ID"');
		expect(set['--nc-label-nc-emoji']).toBe('"Emoji"');
		expect(Object.keys(set)).toHaveLength(5);
		undo();
		expect(removed.sort()).toEqual(Object.keys(set).sort());
	});

	it('quotes and escapes the text for a CSS string', () => {
		expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
	});
});
