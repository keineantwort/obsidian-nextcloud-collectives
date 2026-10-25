// Display-only helpers: page emoji in titles, labels of the plugin's properties.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { clearEmoji, decorateExplorer, decorateView, emojiFromFrontmatter, isFolderNotePath } from '../../src/ui/emojiTitles';
import { clearProperties, decorateProperties, propertyLabels } from '../../src/ui/propertyLabels';

function dom(html: string): ParentNode {
	const { window } = new JSDOM(`<body>${html}</body>`);
	// Obsidian adds createSpan to every element; jsdom does not have it.
	(window.Element.prototype as unknown as { createSpan: (o: { cls: string }) => Element }).createSpan = function (this: Element, o) {
		const span = this.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'span');
		span.className = o.cls;
		this.appendChild(span);
		return span;
	};
	return window.document.body;
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

describe('folders in the explorer', () => {
	const TREE = `
<div class="nav-folder"><div class="nav-folder-title" data-path="Coll/Ordner"><div class="nav-folder-title-content">Ordner</div></div>
<div class="nav-folder-children">
<div class="nav-file"><div class="nav-file-title" data-path="Coll/Ordner/Alpha.md"><div class="nav-file-title-content">Alpha</div></div></div>
<div class="nav-file"><div class="nav-file-title" data-path="Coll/Ordner/Ordner.md"><div class="nav-file-title-content">Ordner</div></div></div>
</div></div>`;

	it('shows the emoji of the folder note at the folder', () => {
		const root = dom(TREE);

		decorateExplorer(root, (path) => (path === 'Coll/Ordner/Ordner.md' ? '📘' : null));

		expect(root.querySelector('.nav-folder-title-content')?.getAttribute('data-nc-emoji')).toBe('📘');
		expect(root.querySelector('[data-path="Coll/Ordner/Ordner.md"] .nav-file-title-content')?.getAttribute('data-nc-emoji')).toBe('📘');
		expect(root.querySelector('[data-path="Coll/Ordner/Alpha.md"] .nav-file-title-content')?.hasAttribute('data-nc-emoji')).toBe(false);
	});

	it('flags only the note of a folder to be shown first, and not when the option is off', () => {
		const root = dom(TREE);

		decorateExplorer(root, () => null);
		const flagged = Array.from(root.querySelectorAll('.nav-file[data-nc-folder-note]')).map((el) => el.querySelector('.nav-file-title')?.getAttribute('data-path'));
		expect(flagged).toEqual(['Coll/Ordner/Ordner.md']);

		decorateExplorer(root, () => null, false);
		expect(root.querySelectorAll('[data-nc-folder-note]')).toHaveLength(0);
	});

	it('flags the list of a folder that holds its note, so the style sheet needs no :has, and unflags it with the note', () => {
		const root = dom(`${TREE}
<div class="nav-folder"><div class="nav-folder-title" data-path="Coll/Leer"><div class="nav-folder-title-content">Leer</div></div>
<div class="nav-folder-children">
<div class="nav-file"><div class="nav-file-title" data-path="Coll/Leer/Alpha.md"><div class="nav-file-title-content">Alpha</div></div></div>
</div></div>`);
		const lists = Array.from(root.querySelectorAll('.nav-folder-children'));

		decorateExplorer(root, () => null);
		expect(lists.map((el) => el.hasAttribute('data-nc-has-folder-note'))).toEqual([true, false]);

		decorateExplorer(root, () => null, false);
		expect(lists.map((el) => el.hasAttribute('data-nc-has-folder-note'))).toEqual([false, false]);

		decorateExplorer(root, () => null);
		root.querySelector('[data-path="Coll/Ordner/Ordner.md"]')?.closest('.nav-file')?.remove();
		decorateExplorer(root, () => null);
		expect(lists[0]?.hasAttribute('data-nc-has-folder-note')).toBe(false);
	});

	it('never moves or renames anything: the order of the items and the titles stay as they are', () => {
		const root = dom(TREE);
		const before = Array.from(root.querySelectorAll('.nav-file-title')).map((el) => `${el.getAttribute('data-path')}|${el.textContent}`);

		decorateExplorer(root, () => '📘');

		expect(Array.from(root.querySelectorAll('.nav-file-title')).map((el) => `${el.getAttribute('data-path')}|${el.textContent}`)).toEqual(before);
	});

	it('clearEmoji removes the flags too', () => {
		const root = dom(TREE);
		decorateExplorer(root, () => null);
		clearEmoji(root);
		expect(root.querySelectorAll('[data-nc-folder-note]')).toHaveLength(0);
		expect(root.querySelectorAll('[data-nc-has-folder-note]')).toHaveLength(0);
	});

	it('knows a folder note by its path', () => {
		expect(isFolderNotePath('Coll/Ordner/Ordner.md')).toBe(true);
		expect(isFolderNotePath('Coll/Coll.md')).toBe(true);
		expect(isFolderNotePath('Coll/Ordner/Alpha.md')).toBe(false);
		expect(isFolderNotePath('Alpha.md')).toBe(false);
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

describe('property labels', () => {
	const ROWS = `
<div class="metadata-property" data-property-key="nc_page_id"><div class="metadata-property-key"><span class="icon"></span><input class="metadata-property-key-input" value="nc_page_id"></div><div class="metadata-property-value">12</div></div>
<div class="metadata-property" data-property-key="tags"><div class="metadata-property-key"><input class="metadata-property-key-input" value="tags"></div></div>`;

	it('has a label per plugin property in the language of the UI', () => {
		expect(propertyLabels(createTranslator('de'))).toMatchObject({ nc_page_id: 'Seiten-ID', nc_collective_id: 'Collective-ID', nc_emoji: 'Emoji' });
		expect(propertyLabels(createTranslator('en')).nc_page_id).toBe('Page ID');
	});

	it('shows the label of a plugin property in place of its key, once, and leaves other properties alone', () => {
		const root = dom(ROWS);
		const labels = { nc_page_id: 'Seiten-ID' };

		decorateProperties(root, labels);
		decorateProperties(root, labels);

		expect(root.querySelectorAll('.nc-property-label')).toHaveLength(1);
		expect(root.querySelector('.nc-property-label')?.textContent).toBe('Seiten-ID');
		const rows = Array.from(root.querySelectorAll('.metadata-property'));
		expect(rows.map((row) => row.classList.contains('nc-property-labelled'))).toEqual([true, false]);
		expect(root.querySelector('[data-property-key="nc_page_id"] input')?.getAttribute('value')).toBe('nc_page_id');
	});

	it('updates the label text and clearProperties shows the keys again', () => {
		const root = dom(ROWS);
		decorateProperties(root, { nc_page_id: 'Seiten-ID' });
		decorateProperties(root, { nc_page_id: 'Page ID' });
		expect(root.querySelector('.nc-property-label')?.textContent).toBe('Page ID');

		clearProperties(root);

		expect(root.querySelectorAll('.nc-property-label, .nc-property-labelled')).toHaveLength(0);
	});
});
