import { asCollectiveId, asPageId } from '../api/types';
import type { CollectiveId, PageId } from '../api/types';
import { toObsidianTag } from './tags';
import type { TagsProperty } from './tags';

/** Plugin fields stored as flat top-level keys in the frontmatter of a local file (PLAN §6.2). */
export interface NcMeta {
	pageId: PageId;
	collectiveId: CollectiveId;
	/** Only if the file name differs from the title. */
	title: string | null;
	emoji: string | null;
	/** Tag names; [] = no tags. */
	tags: string[];
	/** Which key carries the tags besides `nc_tags` (PLAN §10.2). Default: `nc_tags` only. */
	tagsProperty?: TagsProperty;
}

/** What a note says about its emoji and tags. `tags` are the names as written, not yet matched to the server's tags. */
export interface LocalFields {
	emoji: string | null;
	tags: string[];
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
/** Obsidian's own `tags` property, optionally quoted. */
const TAGS_KEY = /^["']?tags["']?[ \t]*:/;
const TAGS_VALUE_LINE = /^["']?tags["']?[ \t]*:[ \t]*(.*?)[ \t]*$/;
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
 * `tags` property goes too: the plugin writes it itself (tagsProperty = tags).
 */
function withoutNcLines(lines: string[], withTags = false): string[] {
	const kept: string[] = [];
	let inNcField = false;
	for (const line of lines) {
		if (NC_KEY.test(line) || (withTags && TAGS_KEY.test(line))) {
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
	if (meta.tags.length > 0) out += `nc_tags: ${JSON.stringify(meta.tags)}${eol}`;
	if (meta.tagsProperty === 'tags' && meta.tags.length > 0) out += `tags: ${JSON.stringify(meta.tags.map(toObsidianTag))}${eol}`;
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
	const userLines = withoutNcLines(block.yamlLines, meta.tagsProperty === 'tags');
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

/** Local file content → canonical remote format (the format baseHash is computed on). The byte order mark is kept. */
export function toRemote(local: string): string {
	const block = splitBlock(local);
	if (!block) {
		const { bom, body } = textParts(local);
		return bom + stripTrailingNewlines(body);
	}
	const { bom, eol } = block;
	const userLines = withoutNcLines(block.yamlLines);
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

/** Matches `nc_<name>: <value>` lines. */
const NC_VALUE_LINE = /^["']?(nc_[A-Za-z_]+)["']?[ \t]*:[ \t]*(.*?)[ \t]*$/;

/** Parses a JSON value, or undefined if it is not valid JSON. */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** The nc_<name> values of a block by key (first line wins), unparsed. */
function ncValues(block: Block): Map<string, string> {
	const values = new Map<string, string>();
	for (const line of block.yamlLines) {
		const match = NC_VALUE_LINE.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined && !values.has(match[1])) values.set(match[1], match[2]);
	}
	return values;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A YAML scalar as text: surrounding quotes and a leading '#' (Obsidian tag syntax) removed. */
function unquote(item: string): string {
	const trimmed = item.trim();
	const quoted = /^(["'])(.*)\1$/.exec(trimmed);
	return (quoted?.[2] ?? trimmed).trim().replace(/^#+/, '');
}

/**
 * The tag names of Obsidian's `tags` property: a flow list `[a, b]`, a block list, or one scalar (comma or space
 * separated). undefined if the property is missing or written in a form this does not read (a flow list over several lines).
 */
function readTagsProperty(lines: readonly string[]): string[] | undefined {
	const index = lines.findIndex((line) => TAGS_KEY.test(line));
	if (index < 0) return undefined;
	const value = TAGS_VALUE_LINE.exec(lines[index] ?? '')?.[1] ?? '';
	let items: string[];
	if (value === '') {
		items = [];
		for (const line of lines.slice(index + 1)) {
			const item = LIST_ITEM_LINE.exec(line)?.[1];
			if (item === undefined) break;
			items.push(item);
		}
	} else if (value.startsWith('[')) {
		if (!value.endsWith(']')) return undefined;
		items = value.slice(1, -1).split(',');
	} else {
		items = value.split(/[,\s]+/);
	}
	return items.map(unquote).filter((item) => item !== '');
}

/**
 * Emoji and tags a note carries: `nc_emoji` and `nc_tags`, and with tagsProperty = tags the `tags` property in
 * place of `nc_tags` (`nc_tags` is the fallback while the note has no `tags` yet, e.g. after the setting changed).
 * null if the text has no frontmatter block.
 */
export function readLocalFields(local: string, tagsProperty: TagsProperty = 'nc_tags'): LocalFields | null {
	const block = splitBlock(local);
	if (!block) return null;
	const values = ncValues(block);
	const emoji = parseJson(values.get('nc_emoji') ?? '');
	let tags = stringList(parseJson(values.get('nc_tags') ?? ''));
	if (tagsProperty === 'tags') tags = readTagsProperty(block.yamlLines) ?? tags;
	return { emoji: typeof emoji === 'string' && emoji !== '' ? emoji : null, tags };
}

/**
 * Reads the nc_* fields written by the plugin (PLAN §6.2), or null if the text has no valid nc_page_id and nc_collective_id.
 * Unknown or malformed optional fields count as absent.
 */
export function readNcMeta(local: string, tagsProperty: TagsProperty = 'nc_tags'): NcMeta | null {
	const block = splitBlock(local);
	if (!block) return null;
	const values = ncValues(block);
	const pageId = pageIdFromFrontmatterValue(parseJson(values.get('nc_page_id') ?? ''));
	const collectiveId = pageIdFromFrontmatterValue(parseJson(values.get('nc_collective_id') ?? ''));
	if (pageId === undefined || collectiveId === undefined) return null;
	const title = parseJson(values.get('nc_title') ?? '');
	const emoji = parseJson(values.get('nc_emoji') ?? '');
	return {
		pageId,
		collectiveId: asCollectiveId(collectiveId),
		title: typeof title === 'string' ? title : null,
		emoji: typeof emoji === 'string' ? emoji : null,
		tags: readLocalFields(local, tagsProperty)?.tags ?? [],
		...(tagsProperty === 'tags' ? { tagsProperty } : {}),
	};
}

/**
 * Remote text with the server's emoji and tags as `nc_emoji` / `nc_tags` (no page id): the conflict copy of a metadata
 * conflict shows what the server has. Such a file is not linked to a page and is never synced.
 */
export function withMetaOnly(remote: string, meta: Pick<NcMeta, 'emoji' | 'tags'>): string {
	const block = splitBlock(remote);
	const { bom, body, eol } = textParts(remote);
	const fields = `nc_emoji: ${JSON.stringify(meta.emoji)}${eol}nc_tags: ${JSON.stringify(meta.tags)}${eol}`;
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
