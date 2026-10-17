// Page emoji in front of note titles, display only (PLAN §6.2): the file name is not changed. The emoji is the note's
// `nc_emoji`; a CSS rule (styles.css) shows it from a data attribute on the title elements of the file explorer, the
// inline title and the view header. Pure DOM helpers; the wiring to Obsidian's events is in main.ts.

export const EMOJI_ATTR = 'data-nc-emoji';
export const FOLDER_NOTE_ATTR = 'data-nc-folder-note';

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

/** True for `…/Name/Name.md`: the note of the folder `Name` (the page that belongs to the folder). */
export function isFolderNotePath(path: string): boolean {
	const segments = path.split('/');
	if (segments.length < 2) return false;
	const file = segments[segments.length - 1] ?? '';
	return file === `${segments[segments.length - 2] ?? ''}.md`;
}

/**
 * Marks the titles below `root` (a file explorer): notes and folders with the emoji of their page (a folder shows the emoji
 * of its own note `Folder/Folder.md`), and with `folderNoteFirst` the note of each folder, so the style sheet shows it first
 * in its folder. Only attributes change; Obsidian's order of the items stays as it is.
 */
export function decorateExplorer(root: ParentNode, emojiOf: (path: string) => string | null, folderNoteFirst = true): void {
	for (const item of Array.from(root.querySelectorAll('.nav-file-title[data-path]'))) {
		const path = item.getAttribute('data-path') ?? '';
		mark(item.querySelector('.nav-file-title-content'), emojiOf(path));
		flag(item.closest('.nav-file'), folderNoteFirst && isFolderNotePath(path));
	}
	for (const item of Array.from(root.querySelectorAll('.nav-folder-title[data-path]'))) {
		const path = item.getAttribute('data-path') ?? '';
		const name = path.slice(path.lastIndexOf('/') + 1);
		mark(item.querySelector('.nav-folder-title-content'), path === '' ? null : emojiOf(`${path}/${name}.md`));
	}
}

/** Sets or removes the folder-note flag. */
function flag(el: Element | null, on: boolean): void {
	if (el === null) return;
	if (on) {
		if (!el.hasAttribute(FOLDER_NOTE_ATTR)) el.setAttribute(FOLDER_NOTE_ATTR, '');
	} else if (el.hasAttribute(FOLDER_NOTE_ATTR)) {
		el.removeAttribute(FOLDER_NOTE_ATTR);
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
	for (const el of Array.from(root.querySelectorAll(`[${FOLDER_NOTE_ATTR}]`))) el.removeAttribute(FOLDER_NOTE_ATTR);
}
