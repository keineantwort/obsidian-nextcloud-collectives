// Tag names between Collectives and a note's frontmatter (architecture §6.2, §7.5). Pure: no Obsidian, no network.

/** Color of a tag the plugin creates: 6 hex digits without '#' (the Nextcloud blue). */
export const DEFAULT_TAG_COLOR = '0082c9';

/** Obsidian tags cannot contain spaces: runs of white space become '-'; a leading '#' is dropped. */
export function toObsidianTag(name: string): string {
	return name.trim().replace(/^#+/, '').replace(/\s+/g, '-');
}

/** The comparison key of a tag name: its Obsidian form (spaces as '-'), case-insensitive. */
function tagKey(name: string): string {
	return toObsidianTag(name).toLowerCase();
}

/**
 * The tag a name from a note stands for: the exact name first, else the first tag with the same name regardless of case
 * (the server's duplicate check depends on the database collation, so case-insensitive is the safe side). The Obsidian form
 * of the tag names is compared, which maps 'a-b' back to 'a b'; a tag that is really named 'a-b' is found first.
 */
export function findTagByName<T extends { name: string }>(tags: readonly T[], name: string): T | undefined {
	const exact = tags.find((tag) => tag.name === name);
	if (exact !== undefined) return exact;
	const key = tagKey(name);
	return key === '' ? undefined : tags.find((tag) => tagKey(tag.name) === key);
}

/**
 * Tag names of a note as the server knows them: names found among `remoteNames` take the server's spelling, the others
 * stay as written (trimmed, without '#', spaces as '-': a new '-' stays a '-'). Empty names and repeats are dropped. The result is what metaHash is
 * computed on, so a different spelling of a known tag is no change.
 */
export function resolveTagNames(names: readonly string[], remoteNames: readonly string[]): string[] {
	const known = remoteNames.map((name) => ({ name }));
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of names) {
		const written = toObsidianTag(raw);
		if (written === '') continue;
		const resolved = findTagByName(known, written)?.name ?? written;
		const key = tagKey(resolved);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(resolved);
	}
	return out;
}

/** An Obsidian tag in running text: '#' after the start of a line or white space, letters/digits/_/-//, at least one non-digit. */
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/**
 * The `#Tag`s in the text of a note (not its frontmatter), in order of appearance without repeats. Code (fenced blocks and
 * `inline code`) and headings (`# Title`: no tag) are skipped, so are links (`[[Note#Heading]]`: '#' not after white space).
 */
export function inlineTags(body: string): string[] {
	const found: string[] = [];
	let fence: string | null = null;
	for (const rawLine of body.split(/\r?\n/)) {
		const marker = /^\s*(```+|~~~+)/.exec(rawLine)?.[1];
		if (fence !== null) {
			if (marker !== undefined && marker.startsWith(fence[0] ?? '')) fence = null;
			continue;
		}
		if (marker !== undefined) {
			fence = marker;
			continue;
		}
		const line = rawLine.replace(/`[^`]*`/g, ' ');
		for (const match of line.matchAll(INLINE_TAG)) {
			const name = match[1];
			if (name !== undefined && !found.some((known) => known.toLowerCase() === name.toLowerCase())) found.push(name);
		}
	}
	return found;
}
