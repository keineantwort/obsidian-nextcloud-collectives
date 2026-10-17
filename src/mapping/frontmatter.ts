import { asCollectiveId, asPageId } from '../api/types';
import type { CollectiveId, PageId } from '../api/types';
import { parseEmoji } from './emoji';
import { inlineTags, toObsidianTag } from './tags';

/** Plugin fields stored as flat top-level keys in the frontmatter of a local file (PLAN §6.2). */
export interface NcMeta {
	pageId: PageId;
	collectiveId: CollectiveId;
	/** Only if the file name differs from the title. */
	title: string | null;
	emoji: string | null;
	/** Tag names; [] = no tags. */
	tags: string[];
}

/** What a note says about its emoji and tags. `tags` are the names as written, not yet matched to the server's tags. */
export interface LocalFields {
	/** The emoji, or null for none; also null if the note holds something that is not one emoji (see emojiInvalid). */
	emoji: string | null;
	/** True if the emoji property holds text or several emojis. Such a value is never sent to the server. */
	emojiInvalid: boolean;
	/** null: the tags property is there but in a form that is not read (a flow list over several lines): no change is assumed. */
	tags: string[] | null;
}

const BOM = '﻿';

/** Frontmatter block of a text: its byte order mark, line ending, the lines between the delimiters and the text after it. */
interface Block {
	bom: string;
	eol: string;
	yamlLines: string[];
	rest: string;
}

/** An nc_* key, optionally quoted, e.g. `nc_page_id:`, `"nc_page_id":`, `'nc_page_id' :`. */
const NC_KEY = /^["']?nc_[A-Za-z_]+["']?[ \t]*:/;
const CONTINUATION = /^[ \t-]/;
/** Obsidian's own `tags` property, optionally quoted, in any case. */
const TAGS_KEY = /^["']?tags["']?[ \t]*:/i;
/** A property `emoji` that the user adds by hand (the plugin's own key is nc_emoji): read as the emoji, then replaced by nc_emoji. */
const EMOJI_ALIAS_KEY = /^["']?emoji["']?[ \t]*:/i;
const LIST_ITEM_LINE = /^[ \t]*-[ \t]+(.*?)[ \t]*$/;
const PAGE_ID_LINE = /^["']?nc_page_id["']?[ \t]*:[ \t]*["']?(\d+)["']?[ \t]*$/;
const PLACEHOLDER_META: NcMeta = { pageId: asPageId(0), collectiveId: asCollectiveId(0), title: null, emoji: null, tags: [] };

/** Splits off a leading byte order mark; the text after it decides the line ending ('\r\n' only if it starts with '---\r\n'). */
function textParts(text: string): { bom: string; body: string; eol: string } {
	const bom = text.startsWith(BOM) ? BOM : '';
	const body = text.slice(bom.length);
	return { bom, body, eol: body.startsWith('---\r\n') ? '\r\n' : '\n' };
}

/** Splits a text into its frontmatter block, or null if it has no block (no closing '---' line). */
function splitBlock(text: string): Block | null {
	const { bom, body, eol } = textParts(text);
	if (!body.startsWith(`---${eol}`)) return null;
	const lines = body.split(eol);
	const close = lines.findIndex((line, index) => index > 0 && line === '---');
	if (close < 0) return null;
	return { bom, eol, yamlLines: lines.slice(1, close), rest: lines.slice(close + 1).join(eol) };
}

/**
 * Removes each nc_* line together with its continuation lines (indented or starting with '-'). With `withTags` the
 * `tags` property goes too: the plugin writes it itself. The `emoji` alias always goes.
 */
function withoutNcLines(lines: string[], withTags = false): string[] {
	const kept: string[] = [];
	let inNcField = false;
	for (const line of lines) {
		if (NC_KEY.test(line) || EMOJI_ALIAS_KEY.test(line) || (withTags && TAGS_KEY.test(line))) {
			inNcField = true;
			continue;
		}
		if (inNcField && CONTINUATION.test(line)) continue;
		inNcField = false;
		kept.push(line);
	}
	return kept;
}

function ncLines(meta: NcMeta, eol: string): string {
	let out = `nc_page_id: ${meta.pageId}${eol}nc_collective_id: ${meta.collectiveId}${eol}`;
	if (meta.title !== null) out += `nc_title: ${JSON.stringify(meta.title)}${eol}`;
	if (meta.emoji !== null) out += `nc_emoji: ${JSON.stringify(meta.emoji)}${eol}`;
	if (meta.tags.length > 0) {
		// The tags are Obsidian's `tags` property: names with '-' for spaces.
		out += `tags: ${JSON.stringify(meta.tags.map(toObsidianTag))}${eol}`;
	}
	return out;
}

/** Writes the nc fields in front of the user YAML of `text` (or adds a block); user lines and body stay byte-identical. */
function withNcFields(text: string, meta: NcMeta): string {
	const block = splitBlock(text);
	if (!block) {
		const { bom, body, eol } = textParts(text);
		return `${bom}---${eol}${ncLines(meta, eol)}---${eol}${body}`;
	}
	const { bom, eol } = block;
	const userLines = withoutNcLines(block.yamlLines, true);
	const userYaml = userLines.length > 0 ? `${userLines.join(eol)}${eol}` : '';
	return `${bom}---${eol}${ncLines(meta, eol)}${userYaml}---${eol}${block.rest}`;
}

/** Removes all trailing line breaks (LF or CRLF). */
function stripTrailingNewlines(text: string): string {
	return text.replace(/(?:\r?\n)+$/, '');
}

/** Remote text → local file content. */
export function toLocal(remote: string, meta: NcMeta): string {
	return withNcFields(remote, meta);
}

/**
 * Local file content → canonical remote format (the format baseHash is computed on). The byte order mark is kept. The
 * `tags` property is dropped too: the page's tags are real Collectives tags, not text.
 */
export function toRemote(local: string): string {
	const block = splitBlock(local);
	if (!block) {
		const { bom, body } = textParts(local);
		return bom + stripTrailingNewlines(body);
	}
	const { bom, eol } = block;
	const userLines = withoutNcLines(block.yamlLines, true);
	const body = block.rest.startsWith(eol) ? block.rest.slice(eol.length) : block.rest;
	const hasUserFields = userLines.some((line) => line !== '');
	const text = hasUserFields ? `---${eol}${userLines.join(eol)}${eol}---${eol}${eol}${body}` : body;
	return bom + stripTrailingNewlines(text);
}

/** Replaces only the nc_* lines of `local` with those for `meta`; everything else (user YAML, body) stays byte-identical. */
export function replaceNcMeta(local: string, meta: NcMeta): string {
	return withNcFields(local, meta);
}

/** Reads nc_page_id from the frontmatter, or null. The first matching line wins. */
export function readPageId(local: string): PageId | null {
	const block = splitBlock(local);
	if (!block) return null;
	for (const line of block.yamlLines) {
		const match = PAGE_ID_LINE.exec(line);
		if (match?.[1] !== undefined) return asPageId(Number(match[1]));
	}
	return null;
}

/**
 * Maps a value of the metadata cache (frontmatter nc_page_id) to a page id: a safe integer ≥ 0, or a string of digits
 * (quoted in YAML). Anything else is undefined.
 */
export function pageIdFromFrontmatterValue(value: unknown): PageId | undefined {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? asPageId(value) : undefined;
	if (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return asPageId(Number(value));
	return undefined;
}

/** Parses a JSON value, or undefined if it is not valid JSON. */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** `key: value` for one key (any case, optionally quoted); the value text is group 1. */
function keyLine(key: string): RegExp {
	return new RegExp(`^["']?${key}["']?[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, 'i');
}

/** The text after `key:` of the first line with that key, or undefined if there is none. */
function readRaw(lines: readonly string[], key: string): string | undefined {
	const pattern = keyLine(key);
	for (const line of lines) {
		const value = pattern.exec(line)?.[1];
		if (value !== undefined) return value;
	}
	return undefined;
}

/** A YAML scalar as text: a double-quoted one with JSON escapes, a single-quoted one with '' for ', or a plain one. */
function scalarText(raw: string): string {
	const text = raw.trim();
	if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
		const parsed = parseJson(text);
		return typeof parsed === 'string' ? parsed : text.slice(1, -1);
	}
	if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
	return text;
}

/** The scalar of `key` (plain, as Obsidian's properties view writes `key: 📘`, or quoted); undefined if the key is missing. */
function readScalar(lines: readonly string[], key: string): string | undefined {
	const raw = readRaw(lines, key);
	if (raw === undefined) return undefined;
	return raw === 'null' || raw === '~' ? '' : scalarText(raw);
}

/** A list item without quotes and without a leading '#' (Obsidian tag syntax). */
function listItem(item: string): string {
	return scalarText(item).replace(/^#+/, '').trim();
}

/**
 * The items of the list `key`: a flow list `[a, b]`, a block list (`- a`), or one scalar (separated by commas and, for
 * `splitSpaces`, white space). undefined if the key is missing, null if it is written in a form this does not read (a flow
 * list over several lines).
 */
function readList(lines: readonly string[], key: string, splitSpaces: boolean): string[] | null | undefined {
	const pattern = keyLine(key);
	const index = lines.findIndex((line) => pattern.test(line));
	if (index < 0) return undefined;
	const value = pattern.exec(lines[index] ?? '')?.[1] ?? '';
	let items: string[];
	if (value === '') {
		items = [];
		for (const line of lines.slice(index + 1)) {
			const item = LIST_ITEM_LINE.exec(line)?.[1];
			if (item === undefined) break;
			items.push(item);
		}
	} else if (value.startsWith('[')) {
		if (!value.endsWith(']')) return null;
		items = value.slice(1, -1).split(',');
	} else {
		items = splitSpaces ? value.split(/[,\s]+/) : value.split(',');
	}
	return items.map(listItem).filter((item) => item !== '');
}

/** The emoji of a note: nc_emoji, else the property `emoji` a user added by hand. A value that is not one emoji is invalid. */
function readEmoji(lines: readonly string[]): { emoji: string | null; invalid: boolean } {
	const raw = readScalar(lines, 'nc_emoji') ?? readScalar(lines, 'emoji');
	const parsed = parseEmoji(raw ?? '');
	return { emoji: parsed.emoji, invalid: !parsed.valid };
}

/**
 * Emoji and tags a note carries: the emoji in `nc_emoji` (or `emoji`), and the tags in Obsidian's `tags` property plus the
 * `#tags` in the text. A missing property means no tags; a note that still has the old `nc_tags` and no `tags` yet counts
 * with those (so the first sync after the update removes no tag). tags is null if the property is written in a form that
 * is not read. A note without frontmatter can carry `#tags` (a new note).
 */
export function readLocalFields(local: string): LocalFields | null {
	const block = splitBlock(local);
	if (!block) return { emoji: null, emojiInvalid: false, tags: inlineTags(textParts(local).body) };
	const { emoji, invalid } = readEmoji(block.yamlLines);
	const own = readList(block.yamlLines, 'tags', true);
	let tags: string[] | null = own === undefined ? (readList(block.yamlLines, 'nc_tags', false) ?? []) : own;
	if (tags !== null) {
		const list: string[] = [...tags];
		for (const name of inlineTags(block.rest)) if (!list.some((known) => known.toLowerCase() === name.toLowerCase())) list.push(name);
		tags = list;
	}
	return { emoji, emojiInvalid: invalid, tags };
}

/**
 * Reads the nc_* fields written by the plugin (PLAN §6.2), or null if the text has no valid nc_page_id and nc_collective_id.
 * Unknown or malformed optional fields count as absent.
 */
export function readNcMeta(local: string): NcMeta | null {
	const block = splitBlock(local);
	if (!block) return null;
	const pageId = pageIdFromFrontmatterValue(parseJson(readRaw(block.yamlLines, 'nc_page_id') ?? ''));
	const collectiveId = pageIdFromFrontmatterValue(parseJson(readRaw(block.yamlLines, 'nc_collective_id') ?? ''));
	if (pageId === undefined || collectiveId === undefined) return null;
	const title = readScalar(block.yamlLines, 'nc_title');
	const fields = readLocalFields(local);
	return {
		pageId,
		collectiveId: asCollectiveId(collectiveId),
		title: title === undefined || title === '' ? null : title,
		emoji: fields?.emoji ?? null,
		tags: fields?.tags ?? [],
	};
}

/**
 * Remote text with the server's emoji and tags as `nc_emoji` / `tags` (no page id): the conflict copy of a metadata
 * conflict shows what the server has. Such a file is not linked to a page and is never synced.
 */
export function withMetaOnly(remote: string, meta: Pick<NcMeta, 'emoji' | 'tags'>): string {
	const block = splitBlock(remote);
	const { bom, body, eol } = textParts(remote);
	const fields = `nc_emoji: ${JSON.stringify(meta.emoji)}${eol}tags: ${JSON.stringify(meta.tags.map(toObsidianTag))}${eol}`;
	if (!block) return `${bom}---${eol}${fields}---${eol}${body}`;
	const userLines = withoutNcLines(block.yamlLines);
	const userYaml = userLines.length > 0 ? `${userLines.join(eol)}${eol}` : '';
	return `${bom}---${eol}${fields}${userYaml}---${eol}${block.rest}`;
}

/** Removes the nc_* fields; the user's YAML and the body stay byte-identical. An empty block is dropped. */
export function stripNcMeta(local: string): string {
	const block = splitBlock(local);
	if (!block) return local;
	const userLines = withoutNcLines(block.yamlLines);
	if (userLines.length === 0) return block.bom + block.rest;
	return `${block.bom}---${block.eol}${userLines.join(block.eol)}${block.eol}---${block.eol}${block.rest}`;
}

/** Canonical remote format of a remote text: toRemote(toLocal(remote, anyMeta)). */
export function canonicalRemote(remote: string): string {
	return toRemote(toLocal(remote, PLACEHOLDER_META));
}
