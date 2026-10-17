// Page links between the Collectives format and Obsidian wikilinks (PLAN §9.1–9.3, ADR 0008, ADR 0020). Pure: no Obsidian,
// no network imports. The index of pages comes from the caller.
import type { CollectiveId, PageId } from '../api/types';
import { pathKey } from './paths';

/** A page a link can point to. */
export interface LinkTarget {
	pageId: PageId;
	collectiveId: CollectiveId;
	/** Collective slug as used in URLs (`{slug}-{collectiveId}`). */
	collectiveSlug: string;
	/** Page slug as used in URLs (`{slug}-{pageId}`). */
	slug: string;
	/** True for the landing page of the collective. */
	landing: boolean;
	title: string;
	/** Path of the Markdown file inside the collective folder, e.g. 'Prozesse/Urlaub.md' or 'Prozesse/Readme.md'. */
	remotePath: string;
	/** Vault path of the note, or null if the page has no local file. */
	localPath: string | null;
}

/** Everything that is known about pages for link conversion. */
export class LinkIndex {
	private readonly byPageId = new Map<number, LinkTarget>();
	private readonly byLocalKey = new Map<string, LinkTarget>();
	private readonly byRemoteKey = new Map<string, LinkTarget>();
	private readonly byBase = new Map<string, LinkTarget[]>();
	private readonly landings = new Map<number, LinkTarget>();
	private readonly origin: string | null;

	/** `serverUrl`: absolute links count as internal only for this server (scheme and host, no path). */
	constructor(targets: readonly LinkTarget[], serverUrl?: string) {
		this.origin = serverUrl === undefined ? null : originOf(serverUrl);
		for (const target of targets) {
			this.byPageId.set(target.pageId, target);
			this.byRemoteKey.set(`${target.collectiveId}/${target.remotePath}`, target);
			if (target.landing) this.landings.set(target.collectiveId, target);
			if (target.localPath === null) continue;
			const stem = stripMd(target.localPath);
			this.byLocalKey.set(pathKey(stem), target);
			const base = pathKey(stem.slice(stem.lastIndexOf('/') + 1));
			this.byBase.set(base, [...(this.byBase.get(base) ?? []), target]);
		}
	}

	/** True if an absolute URL points to the configured server (always true if none was given). */
	isOwnOrigin(url: string): boolean {
		return this.origin === null || originOf(url) === this.origin;
	}

	get(pageId: PageId): LinkTarget | undefined {
		return this.byPageId.get(pageId);
	}

	landingOf(collectiveId: CollectiveId): LinkTarget | undefined {
		return this.landings.get(collectiveId);
	}

	/** A page by its file inside a collective (case-sensitive, like the server). */
	byRemotePath(collectiveId: CollectiveId, path: string): LinkTarget | undefined {
		return this.byRemoteKey.get(`${collectiveId}/${path}`);
	}

	/**
	 * A page by the name of a link in a note at `fromPath`, like Obsidian resolves it: the path from the vault root, then
	 * relative to the note's folder, then a file name that only one synced page has. Ambiguous names are not resolved.
	 */
	byLocalName(name: string, fromPath: string): LinkTarget | undefined {
		const stem = stripMd(name.trim());
		if (stem === '') return undefined;
		const direct = this.byLocalKey.get(pathKey(stem));
		if (direct !== undefined) return direct;
		const relative = this.byLocalKey.get(pathKey(normalizePath(`${folderOf(fromPath)}/${stem}`)));
		if (relative !== undefined) return relative;
		if (stem.includes('/')) return undefined;
		const named = this.byBase.get(pathKey(stem));
		return named !== undefined && named.length === 1 ? named[0] : undefined;
	}
}

/** The page whose text is converted. */
export interface LinkContext {
	index: LinkIndex;
	sourceId: PageId;
}

// ---------------------------------------------------------------------------
// Text regions
// ---------------------------------------------------------------------------

const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BACKTICKS = /`+/;

/** Applies `fn` to the parts of a text that are neither frontmatter, fenced code nor inline code. */
function mapProse(text: string, fn: (prose: string) => string): string {
	const front = FRONTMATTER.exec(text)?.[0] ?? '';
	const lines = text.slice(front.length).match(/[^\n]*\n|[^\n]+$/g) ?? [];
	let out = front;
	let prose = '';
	let fence: string | null = null;
	const flush = (): void => {
		out += mapInline(prose, fn);
		prose = '';
	};
	for (const line of lines) {
		const marker = FENCE.exec(line)?.[1];
		if (fence === null) {
			if (marker === undefined) {
				prose += line;
				continue;
			}
			flush();
			fence = marker;
			out += line;
		} else {
			out += line;
			const closing = FENCE.exec(line)?.[1];
			if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length && line.trim() === closing) fence = null;
		}
	}
	flush();
	return out;
}

/** Applies `fn` outside inline code spans: a run of backticks up to the next run of the same length. */
function mapInline(prose: string, fn: (part: string) => string): string {
	let out = '';
	let last = 0;
	let from = 0;
	for (;;) {
		const open = BACKTICKS.exec(prose.slice(from));
		if (open === null) break;
		const start = from + open.index;
		const run = open[0];
		const close = closingRun(prose, start + run.length, run.length);
		if (close === -1) {
			from = start + run.length;
			continue;
		}
		out += fn(prose.slice(last, start)) + prose.slice(start, close + run.length);
		last = close + run.length;
		from = last;
	}
	return out + fn(prose.slice(last));
}

/** Index of the next run of exactly `length` backticks at or after `from`, or -1. */
function closingRun(text: string, from: number, length: number): number {
	let i = text.indexOf('`', from);
	while (i !== -1) {
		let end = i;
		while (text[end] === '`') end++;
		if (end - i === length) return i;
		i = text.indexOf('`', end);
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Remote → local
// ---------------------------------------------------------------------------

/** `[text](url)` that is not an image. The url has no spaces and no parentheses (the plugin encodes both). */
const MD_LINK = /(!?)\[([^[\]\n]*)\]\(([^()\s]+)\)/g;

/** Page links of the remote format → `[[Vault/Pfad/Seite|Linktext]]`. Links that cannot be resolved stay as they are. */
export function linksToLocal(remote: string, links: LinkContext | undefined): string {
	if (links === undefined) return remote;
	const source = links.index.get(links.sourceId);
	return mapProse(remote, (prose) =>
		prose.replace(MD_LINK, (whole: string, bang: string, text: string, url: string) => {
			if (bang !== '') return whole;
			const target = resolveRemoteUrl(url, links.index, source);
			if (target?.localPath == null || /[[\]|]/.test(text)) return whole;
			const name = stripMd(target.localPath);
			const anchor = anchorOf(url);
			const heading = anchor === '' ? '' : `#${decodeAnchor(anchor)}`;
			if (/[[\]|]/.test(heading)) return whole;
			return text === target.title || text === '' ? `[[${name}${heading}]]` : `[[${name}${heading}|${text}]]`;
		}),
	);
}

/** The page a remote link points to (relative with fileId, relative path, absolute or root-relative Collectives URL). */
function resolveRemoteUrl(url: string, index: LinkIndex, source: LinkTarget | undefined): LinkTarget | undefined {
	const [beforeAnchor = ''] = url.split('#');
	const [path = '', query = ''] = beforeAnchor.split('?');
	const urlPath = /^https?:\/\/[^/]+(\/.*)?$/i.exec(path);
	if (urlPath !== null && !index.isOwnOrigin(path)) return undefined;
	const absolute = urlPath !== null ? (urlPath[1] ?? '') : path.startsWith('/') ? path : null;
	if (absolute !== null) return resolveCollectivesUrl(absolute, index, source);
	if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path === '') return undefined;
	const fileId = /(?:^|&)fileId=(\d+)(?:&|$)/.exec(query)?.[1];
	// Relative links stay inside the collective: a crafted fileId must not reach the user's other collectives.
	if (fileId !== undefined) return sameCollective(index.get(Number(fileId) as PageId), source);
	if (source === undefined || !path.endsWith('.md')) return undefined;
	const target = normalizePath(`${folderOf(source.remotePath)}/${safeDecode(path)}`);
	return index.byRemotePath(source.collectiveId, target);
}

/** `/index.php/apps/collectives/{collective}/{parent}-{id}/{page}-{id}`: the page is the id after the last dash. */
function resolveCollectivesUrl(path: string, index: LinkIndex, source: LinkTarget | undefined): LinkTarget | undefined {
	const match = /^\/(?:index\.php\/)?apps\/collectives\/(.+)$/.exec(path);
	if (match?.[1] === undefined) return undefined;
	const segments = match[1].split('/').filter((segment) => segment !== '');
	const last = segments[segments.length - 1];
	if (last === undefined) return undefined;
	const id = /-(\d+)$/.exec(last)?.[1];
	if (id === undefined) return undefined;
	const target = segments.length === 1 ? index.landingOf(Number(id) as CollectiveId) : index.get(Number(id) as PageId);
	if (target === undefined || (segments.length > 1 && target.landing)) return undefined;
	// Into another collective only if the URL names it right (`{slug}-{id}`), so ids alone cannot probe other collectives.
	if (source?.collectiveId === target.collectiveId) return target;
	return safeDecode(segments[0] ?? '') === `${target.collectiveSlug}-${target.collectiveId}` ? target : undefined;
}

// ---------------------------------------------------------------------------
// Local → remote
// ---------------------------------------------------------------------------

const WIKILINK = /(!?)\[\[([^[\]|#\n]+)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;

/**
 * Wikilinks and Markdown links to synced notes → the remote format (ADR 0008): relative path with `?fileId=` in the same
 * collective, root-relative Collectives URL into another one. Links to anything else stay as they are.
 */
export function linksToRemote(local: string, links: LinkContext | undefined): string {
	if (links === undefined) return local;
	const source = links.index.get(links.sourceId);
	if (source === undefined) return local;
	return mapProse(local, (prose) => {
		const wiki = prose.replace(WIKILINK, (whole: string, bang: string, name: string, heading: string | undefined, alias: string | undefined) => {
			if (bang !== '') return whole;
			const target = links.index.byLocalName(name, source.localPath ?? '');
			if (target === undefined) return whole;
			return remoteLink(source, target, alias?.trim() || target.title, heading) ?? whole;
		});
		return wiki.replace(MD_LINK, (whole: string, bang: string, text: string, url: string) => {
			if (bang !== '') return whole;
			const parsed = parseLocalMarkdownUrl(url);
			if (parsed === null) return whole;
			const target = links.index.byLocalName(parsed.path, source.localPath ?? '');
			if (target === undefined) return whole;
			return remoteLink(source, target, text === '' ? target.title : text, parsed.heading) ?? whole;
		});
	});
}

/** A Markdown link to a note: path (decoded, with '.md') and heading. Null for URLs, anchors and links with a fileId. */
function parseLocalMarkdownUrl(url: string): { path: string; heading: string | undefined } | null {
	if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return null;
	const hash = url.indexOf('#');
	const path = hash === -1 ? url : url.slice(0, hash);
	if (path.includes('?') || !path.endsWith('.md')) return null;
	return { path: safeDecode(path), heading: hash === -1 ? undefined : decodeAnchor(url.slice(hash + 1)) };
}

function remoteLink(source: LinkTarget, target: LinkTarget, text: string, heading: string | undefined): string | null {
	if (/[[\]\n]/.test(text)) return null;
	const anchor = heading === undefined || heading === '' ? '' : `#${encodeAnchor(heading)}`;
	if (source.collectiveId === target.collectiveId) {
		const relative = relativePath(folderOf(source.remotePath), target.remotePath);
		return `[${text}](${encodePath(relative)}?fileId=${target.pageId}${anchor})`;
	}
	const base = `/apps/collectives/${encodeURIComponent(target.collectiveSlug)}-${target.collectiveId}`;
	return `[${text}](${target.landing ? base : `${base}/${encodeURIComponent(target.slug)}-${target.pageId}`}${anchor})`;
}

// ---------------------------------------------------------------------------
// Paths and encoding
// ---------------------------------------------------------------------------

function stripMd(path: string): string {
	return path.toLowerCase().endsWith('.md') ? path.slice(0, -'.md'.length) : path;
}

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** Resolves '.' and '..' segments; leading '..' beyond the root are dropped. */
function normalizePath(path: string): string {
	const out: string[] = [];
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') out.pop();
		else out.push(segment);
	}
	return out.join('/');
}

/** Path from folder `from` to the file `to` (both inside one collective). */
function relativePath(from: string, to: string): string {
	const a = from === '' ? [] : from.split('/');
	const b = to.split('/');
	let common = 0;
	while (common < a.length && common < b.length - 1 && a[common] === b[common]) common++;
	return [...a.slice(common).map(() => '..'), ...b.slice(common)].join('/');
}

function encodePath(path: string): string {
	return path.split('/').map(encodeSegment).join('/');
}

/** encodeURIComponent plus the characters it keeps but a Markdown link destination cannot hold. */
function encodeSegment(segment: string): string {
	return encodeURIComponent(segment).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeAnchor(heading: string): string {
	return encodeSegment(heading);
}

function decodeAnchor(anchor: string): string {
	return safeDecode(anchor);
}

function anchorOf(url: string): string {
	const hash = url.indexOf('#');
	return hash === -1 ? '' : url.slice(hash + 1);
}

function safeDecode(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

function sameCollective(target: LinkTarget | undefined, source: LinkTarget | undefined): LinkTarget | undefined {
	return target !== undefined && source !== undefined && target.collectiveId === source.collectiveId ? target : undefined;
}

/** Lower-case scheme and host (with port) of an absolute URL, or null. */
function originOf(url: string): string | null {
	const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
	return match?.[1] === undefined || match[2] === undefined ? null : `${match[1]}://${match[2]}`.toLowerCase();
}
