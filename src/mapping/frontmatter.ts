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

/** Frontmatter block of a text: the lines between the delimiters, and the text after the closing line. */
interface Block {
	yamlLines: string[];
	rest: string;
}

const NC_KEY = /^nc_[a-z_]+:/;
const CONTINUATION = /^[ \t-]/;
const PAGE_ID_LINE = /^nc_page_id:[ \t]*["']?(\d+)["']?[ \t]*$/;
const PLACEHOLDER_META: NcMeta = { pageId: asPageId(0), collectiveId: asCollectiveId(0), title: null, emoji: null, tags: [] };

/** Splits a text into its frontmatter block, or null if it has no block (no closing '---' line). */
function splitBlock(text: string): Block | null {
	if (!text.startsWith('---\n')) return null;
	const lines = text.split('\n');
	const close = lines.findIndex((line, index) => index > 0 && line === '---');
	if (close < 0) return null;
	return { yamlLines: lines.slice(1, close), rest: lines.slice(close + 1).join('\n') };
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

function ncLines(meta: NcMeta): string {
	let out = `nc_page_id: ${meta.pageId}\nnc_collective_id: ${meta.collectiveId}\n`;
	if (meta.title !== null) out += `nc_title: ${JSON.stringify(meta.title)}\n`;
	if (meta.emoji !== null) out += `nc_emoji: ${JSON.stringify(meta.emoji)}\n`;
	if (meta.tags.length > 0) out += `nc_tags: ${JSON.stringify(meta.tags)}\n`;
	return out;
}

/** Writes the nc fields in front of the user YAML of `text` (or adds a block); user lines and body stay byte-identical. */
function withNcFields(text: string, meta: NcMeta): string {
	const block = splitBlock(text);
	if (!block) return `---\n${ncLines(meta)}---\n${text}`;
	const userLines = withoutNcLines(block.yamlLines);
	const userYaml = userLines.length > 0 ? `${userLines.join('\n')}\n` : '';
	return `---\n${ncLines(meta)}${userYaml}---\n${block.rest}`;
}

function stripTrailingNewlines(text: string): string {
	return text.replace(/\n+$/, '');
}

/** Remote text → local file content. */
export function toLocal(remote: string, meta: NcMeta): string {
	return withNcFields(remote, meta);
}

/** Local file content → canonical remote format (the format baseHash is computed on). */
export function toRemote(local: string): string {
	const block = splitBlock(local);
	if (!block) return stripTrailingNewlines(local);
	const userLines = withoutNcLines(block.yamlLines);
	const body = block.rest.startsWith('\n') ? block.rest.slice(1) : block.rest;
	const hasUserFields = userLines.some((line) => line !== '');
	const text = hasUserFields ? `---\n${userLines.join('\n')}\n---\n\n${body}` : body;
	return stripTrailingNewlines(text);
}

/** Replaces only the nc_* lines of `local` with those for `meta`; everything else (user YAML, body) stays byte-identical. */
export function replaceNcMeta(local: string, meta: NcMeta): string {
	return withNcFields(local, meta);
}

/** Reads nc_page_id from the frontmatter, or null. */
export function readPageId(local: string): PageId | null {
	const block = splitBlock(local);
	if (!block) return null;
	for (const line of block.yamlLines) {
		const match = PAGE_ID_LINE.exec(line);
		if (match?.[1] !== undefined) return asPageId(Number(match[1]));
	}
	return null;
}

/** Canonical remote format of a remote text: toRemote(toLocal(remote, anyMeta)). */
export function canonicalRemote(remote: string): string {
	return toRemote(toLocal(remote, PLACEHOLDER_META));
}
