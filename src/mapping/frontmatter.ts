import { asCollectiveId, asPageId } from '../api/types';
import type { CollectiveId, PageId } from '../api/types';

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

/** Removes each nc_* line together with its continuation lines (indented or starting with '-'). */
function withoutNcLines(lines: string[]): string[] {
	const kept: string[] = [];
	let inNcField = false;
	for (const line of lines) {
		if (NC_KEY.test(line)) {
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
	const userLines = withoutNcLines(block.yamlLines);
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

/** Canonical remote format of a remote text: toRemote(toLocal(remote, anyMeta)). */
export function canonicalRemote(remote: string): string {
	return toRemote(toLocal(remote, PLACEHOLDER_META));
}
