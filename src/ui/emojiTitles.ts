// Page emoji in front of note titles, display only (PLAN §6.2): the file name is not changed. The emoji is the note's
// `nc_emoji`; a CSS rule (styles.css) shows it from a data attribute on the title elements of the file explorer, the
// inline title and the view header. Pure DOM helpers; the wiring to Obsidian's events is in main.ts.

export const EMOJI_ATTR = 'data-nc-emoji';

/** The emoji of a frontmatter value: a non-empty string of at most 16 characters, else null. */
export function emojiFromFrontmatter(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const emoji = value.trim();
	return emoji === '' || emoji.length > 16 ? null : emoji;
}

function mark(el: Element | null, emoji: string | null): void {
	if (el === null) return;
	if (emoji === null) {
		if (el.hasAttribute(EMOJI_ATTR)) el.removeAttribute(EMOJI_ATTR);
	} else if (el.getAttribute(EMOJI_ATTR) !== emoji) {
		el.setAttribute(EMOJI_ATTR, emoji);
	}
}

/** Marks the file titles below `root` (a file explorer) with the emoji of their note. */
export function decorateExplorer(root: ParentNode, emojiOf: (path: string) => string | null): void {
	for (const item of Array.from(root.querySelectorAll('.nav-file-title[data-path]'))) {
		const path = item.getAttribute('data-path');
		mark(item.querySelector('.nav-file-title-content'), path === null ? null : emojiOf(path));
	}
}

/** Marks the inline title and the title in the header of one note view. */
export function decorateView(container: ParentNode, emoji: string | null): void {
	mark(container.querySelector('.inline-title'), emoji);
	mark(container.querySelector('.view-header-title'), emoji);
}

/** Removes every mark below `root`. */
export function clearEmoji(root: ParentNode): void {
	for (const el of Array.from(root.querySelectorAll(`[${EMOJI_ATTR}]`))) el.removeAttribute(EMOJI_ATTR);
}
