// Attachments of pages (PLAN §9.4, ADR 0021). Pure: no Obsidian, no network imports.
import type { PageId } from '../api/types';
import { pathKey } from './paths';

/** Default of the setting `attachmentFolderPattern`: relative to the folder of the note, `{title}` = file name of the note. */
export const DEFAULT_ATTACHMENT_PATTERN = '_attachments/{title}';
/** Default of the setting `maxAttachmentSizeMb`. */
export const DEFAULT_MAX_ATTACHMENT_MB = 20;

/** Settings that decide where attachments go and which ones are transferred. */
export interface AttachmentOptions {
	pattern: string;
	/** Files above this size (bytes) are neither uploaded nor downloaded. */
	maxBytes: number;
}

/** A file of the vault that can be an attachment (no note), with its size in bytes. */
export interface AttachmentFile {
	path: string;
	size: number;
}

const NOTE_EXTENSIONS = new Set(['md', 'canvas', 'base']);

/** True for files that can be attachments: everything but notes, canvases and bases. */
export function isAttachmentFile(path: string): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 && !NOTE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

const MIME_TYPES: Record<string, string> = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
	avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain', mp3: 'audio/mpeg', mp4: 'video/mp4',
	webm: 'video/webm', zip: 'application/zip',
};

/** Content type for an upload by file extension; 'application/octet-stream' for anything unknown. */
export function mimeTypeOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return (dot > 0 ? MIME_TYPES[name.slice(dot + 1).toLowerCase()] : undefined) ?? 'application/octet-stream';
}

/** Vault folder for the attachments of the note at `notePath`: the pattern, relative to the note's folder. */
export function attachmentFolderFor(notePath: string, pattern: string): string {
	const slash = notePath.lastIndexOf('/');
	const folder = slash === -1 ? '' : notePath.slice(0, slash);
	const file = notePath.slice(slash + 1);
	const title = file.toLowerCase().endsWith('.md') ? file.slice(0, -'.md'.length) : file;
	const relative = pattern.replace(/\{title\}/g, title).replace(/^\/+|\/+$/g, '');
	return folder === '' ? relative : `${folder}/${relative}`;
}

/** Last path segment. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** `.attachments.{pageId}/{name}` as page text links it (name URL-encoded). */
export function attachmentUrl(pageId: PageId, name: string): string {
	return `.attachments.${pageId}/${encodeURIComponent(name).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** The page and file name of an `.attachments.{pageId}/{name}` link target, or null for any other URL. */
export function parseAttachmentUrl(url: string): { pageId: PageId; name: string } | null {
	const match = /^(?:\.\/)?\.attachments\.(\d+)\/([^/?#]+)$/.exec(url);
	if (match?.[1] === undefined || match[2] === undefined) return null;
	let name: string;
	try {
		name = decodeURIComponent(match[2]);
	} catch {
		name = match[2];
	}
	return { pageId: Number(match[1]) as PageId, name };
}

/** What `AttachmentIndex` is built from. */
export interface AttachmentIndexInput {
	/** Every attachment candidate in the vault. */
	files: readonly AttachmentFile[];
	/** Folder (vault path) the attachments of a page go to by default: from its note path and the pattern. */
	folders: ReadonlyMap<PageId, string>;
	/** Attachments that were synced already, by page: name and vault path. They win over the default folder. */
	known: ReadonlyMap<PageId, readonly { name: string; localPath: string }[]>;
	maxBytes: number;
}

/** An embed in a note that stands for an attachment of the page. `path`: the vault file, null if it is not there (yet). */
export interface ResolvedEmbed {
	name: string;
	path: string | null;
}

/** Resolves attachment embeds between note text and files (ADR 0021). */
export class AttachmentIndex {
	private readonly byPath = new Map<string, AttachmentFile>();
	private readonly byBase = new Map<string, AttachmentFile[]>();
	private readonly folders: ReadonlyMap<PageId, string>;
	private readonly known: ReadonlyMap<PageId, readonly { name: string; localPath: string }[]>;
	private readonly maxBytes: number;

	constructor(input: AttachmentIndexInput) {
		this.folders = input.folders;
		this.known = input.known;
		this.maxBytes = input.maxBytes;
		for (const file of input.files) {
			this.byPath.set(pathKey(file.path), file);
			const base = pathKey(baseName(file.path));
			this.byBase.set(base, [...(this.byBase.get(base) ?? []), file]);
		}
	}

	/** Where the attachment `name` of a page lies in the vault: where it was synced to, else in the page's default folder. */
	localPath(pageId: PageId, name: string): string | undefined {
		const known = this.known.get(pageId)?.find((entry) => entry.name === name);
		if (known !== undefined) return known.localPath;
		const folder = this.folders.get(pageId);
		return folder === undefined ? undefined : `${folder}/${name}`;
	}

	/**
	 * The attachment an embed target stands for, in a note at `fromPath` that belongs to page `pageId`. A file in the vault
	 * is found like Obsidian finds it (path from the root, relative to the note, a name only one file has); files above the
	 * size limit are not attachments. Where no file is, a path the page's attachments are synced to (or would be) still counts:
	 * the file is downloaded after the note is written.
	 */
	resolve(target: string, fromPath: string, pageId: PageId): ResolvedEmbed | undefined {
		const wanted = normalizePath(target.trim());
		if (wanted === '') return undefined;
		const file = this.findFile(wanted, fromPath);
		if (file !== undefined) return file.size > this.maxBytes ? undefined : { name: baseName(file.path), path: file.path };
		const key = pathKey(wanted);
		const known = this.known.get(pageId)?.find((entry) => pathKey(entry.localPath) === key);
		if (known !== undefined) return { name: known.name, path: null };
		const folder = this.folders.get(pageId);
		if (folder !== undefined && key.startsWith(`${pathKey(folder)}/`)) {
			const name = wanted.slice(folder.length + 1);
			if (name !== '' && !name.includes('/')) return { name, path: null };
		}
		return undefined;
	}

	private findFile(wanted: string, fromPath: string): AttachmentFile | undefined {
		const direct = this.byPath.get(pathKey(wanted));
		if (direct !== undefined) return direct;
		const slash = fromPath.lastIndexOf('/');
		const relative = slash === -1 ? undefined : this.byPath.get(pathKey(normalizePath(`${fromPath.slice(0, slash)}/${wanted}`)));
		if (relative !== undefined) return relative;
		if (wanted.includes('/')) return undefined;
		const named = this.byBase.get(pathKey(wanted));
		return named !== undefined && named.length === 1 ? named[0] : undefined;
	}
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
