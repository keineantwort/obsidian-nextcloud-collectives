import { ApiChangedError } from '../util/errors';
import { getHeader, type HttpClient, type HttpResponse } from './http';

export interface DavFile {
	content: string;
	etag: string;
	/** Raw `Last-Modified` response header, null if absent. */
	lastModified: string | null;
	/** Raw `Date` response header, null if absent. */
	date: string | null;
}
export interface DavWriteResult { etag: string; }
/** Bytes of a file (attachments). */
export interface DavBinary { data: ArrayBuffer; etag: string; }

/** Timeout for attachment transfers: far above the default, since a file can be 20 MB on a slow mobile connection. */
export const ATTACHMENT_TIMEOUT_MS = 180_000;
/** Exactly one precondition is mandatory: never overwrite blindly (AGENTS rule 4). */
export type PutPrecondition = { ifMatch: string } | { ifNoneMatch: '*' };

export interface DavEntry {
	/** Decoded user-relative path without leading/trailing slash, e.g. '.Collectives/Handbuch/Readme.md'; the collection itself e.g. '.Collectives/Handbuch'. */
	path: string;
	isCollection: boolean;
	/** Raw value including quotes, e.g. '"82a1…"'; null if not reported. */
	etag: string | null;
	lastModified: string | null;
	contentLength: number | null;
	fileId: number | null;
}

const DAV_NS = 'DAV:';
const OC_NS = 'http://owncloud.org/ns';

const PROPFIND_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:getetag/><d:getlastmodified/><d:getcontentlength/><d:resourcetype/><oc:fileid/></d:prop></d:propfind>';

/** Ensures an ETag is sent quoted: 'abc' → '"abc"'; values already starting with '"' or 'W/"' are returned unchanged. */
export function quoteEtag(etag: string): string {
	if (etag.startsWith('"') || etag.startsWith('W/"')) return etag;
	return `"${etag}"`;
}

/**
 * Pure: parses a 207 multistatus body. Uses `new DOMParser().parseFromString(xml, 'application/xml')`.
 * Pattern adapted from siosig/obsidian-nextcloudsync src/network/dav/propfind.ts (MIT, Copyright (c) 2026 Daisuke ITO,
 * commit cff8b216f0e2d818d221bb3c24c08eed4b62226e). Written fresh for this plugin, not copied.
 */
export function parsePropfind(xml: string, filesRootPath: string): DavEntry[] {
	const text = xml.startsWith('\uFEFF') ? xml.slice(1) : xml;
	const doc = new DOMParser().parseFromString(text, 'application/xml');
	// Browsers do not throw on malformed XML; they put a parsererror element into the document instead.
	if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) throw new ApiChangedError('PROPFIND response is not well-formed XML');

	const root = doc.documentElement;
	if (root.namespaceURI !== DAV_NS || root.localName !== 'multistatus') {
		throw new ApiChangedError('PROPFIND response root is not DAV:multistatus');
	}

	return Array.from(root.getElementsByTagNameNS(DAV_NS, 'response'), (response) => parseResponse(response, filesRootPath));
}

function parseResponse(response: Element, filesRootPath: string): DavEntry {
	const href = firstElement(response, DAV_NS, 'href')?.textContent ?? '';
	if (href === '') throw new ApiChangedError('PROPFIND response has no href');

	// Only properties of propstats with status 200 are used; others (e.g. 404 for unknown props) are ignored.
	const props = Array.from(response.getElementsByTagNameNS(DAV_NS, 'propstat'))
		.filter((propstat) => (firstElement(propstat, DAV_NS, 'status')?.textContent ?? '').includes(' 200 '));
	const prop = (ns: string, name: string): Element | null => {
		for (const propstat of props) {
			const found = firstElement(propstat, ns, name);
			if (found) return found;
		}
		return null;
	};

	const resourceType = prop(DAV_NS, 'resourcetype');
	return {
		path: toUserPath(href, filesRootPath),
		isCollection: resourceType !== null && firstElement(resourceType, DAV_NS, 'collection') !== null,
		etag: nonEmptyText(prop(DAV_NS, 'getetag')),
		lastModified: nonEmptyText(prop(DAV_NS, 'getlastmodified')),
		contentLength: integerText(prop(DAV_NS, 'getcontentlength'), 'getcontentlength'),
		fileId: integerText(prop(OC_NS, 'fileid'), 'fileid'),
	};
}

function firstElement(scope: Element, ns: string, name: string): Element | null {
	return scope.getElementsByTagNameNS(ns, name).item(0);
}

function nonEmptyText(element: Element | null): string | null {
	const text = element?.textContent ?? '';
	return text === '' ? null : text;
}

function integerText(element: Element | null, name: string): number | null {
	const text = nonEmptyText(element);
	if (text === null) return null;
	if (!/^\d+$/.test(text)) throw new ApiChangedError(`PROPFIND property ${name} is not an integer`);
	return Number(text);
}

/** Turns an href into a user-relative path. The href must lie below the files root. */
function toUserPath(href: string, filesRootPath: string): string {
	const decodedHref = decodeSegments(href);
	const decodedRoot = decodeSegments(filesRootPath);
	const rest = decodedHref.slice(decodedRoot.length);
	const insideRoot = decodedHref.startsWith(decodedRoot) && (rest === '' || rest.startsWith('/'));
	if (!insideRoot) throw new ApiChangedError('PROPFIND href lies outside the files root');
	return rest.replace(/^\/+|\/+$/g, '');
}

/** Decodes each '/'-separated segment. Dot segments and encoded slashes would change the path structure. */
function decodeSegments(path: string): string {
	return path.split('/').map((segment) => {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch (err) {
			throw new ApiChangedError('PROPFIND href is not valid percent-encoding', { cause: err });
		}
		if (isDotSegment(decoded) || decoded.includes('/')) throw new ApiChangedError('PROPFIND href has a dot segment or an encoded slash');
		return decoded;
	}).join('/');
}

/**
 * Encodes a user-relative path segment by segment; empty segments are dropped.
 * '.' and '..' are rejected: URL normalization would resolve them and the request could leave the files root.
 */
function encodeSegments(path: string): string {
	const segments = path.split('/').filter((segment) => segment !== '');
	if (segments.some(isDotSegment)) throw new Error('Invalid WebDAV path');
	return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function isDotSegment(segment: string): boolean {
	return segment === '.' || segment === '..';
}

/** Returns the ETag header of a response, or undefined if the server did not send one. */
function etagHeader(res: HttpResponse): string | undefined {
	const etag = getHeader(res.headers, 'ETag');
	return etag === undefined || etag === '' ? undefined : etag;
}

/** Returns the ETag header of a response, or ApiChangedError if the server did not send one. */
function requireEtag(res: HttpResponse, what: string): string {
	const etag = etagHeader(res);
	if (etag === undefined) throw new ApiChangedError(`${what} response has no ETag`);
	return etag;
}

/**
 * True if the ETag of a GET can be trusted for If-Match (PLAN §4.5, api-notes §10a: ETags have one-second resolution).
 * Confirmed iff both headers parse (Date.parse not NaN) and floor(lastModified/1000) < floor(date/1000), i.e. the file
 * was last written in an earlier server second than the one the response was produced in. Missing/unparsable → false.
 */
export function isEtagConfirmed(file: Pick<DavFile, 'lastModified' | 'date'>): boolean {
	if (file.lastModified === null || file.date === null) return false;
	const modified = Date.parse(file.lastModified);
	const responded = Date.parse(file.date);
	if (Number.isNaN(modified) || Number.isNaN(responded)) return false;
	return Math.floor(modified / 1000) < Math.floor(responded / 1000);
}

/** WebDAV access to files below /remote.php/dav/files/{user}. Paths are user-relative, e.g. '.Collectives/Handbuch/Readme.md'. */
export class WebdavClient {
	private readonly http: HttpClient;
	private readonly filesRoot: string;

	/**
	 * `davUserId` is the Nextcloud user ID (from getCurrentUserId), not the login name: WebDAV paths use the user ID.
	 * Defaults to the login name, which is only correct if both are equal.
	 */
	constructor(http: HttpClient, davUserId: string = http.username) {
		this.http = http;
		this.filesRoot = '/remote.php/dav/files/' + encodeURIComponent(davUserId);
	}

	/** GET. Resolves with body text, ETag and the Last-Modified/Date headers (case-insensitive lookup). Missing ETag → ApiChangedError. */
	async get(path: string): Promise<DavFile> {
		const res = await this.http.send({ method: 'GET', path: this.filePath(path) });
		return {
			content: res.text,
			etag: requireEtag(res, 'GET'),
			lastModified: getHeader(res.headers, 'Last-Modified') ?? null,
			date: getHeader(res.headers, 'Date') ?? null,
		};
	}

	/**
	 * PUT with 'Content-Type': 'text/markdown; charset=utf-8' and either 'If-Match': quoteEtag(etag) or 'If-None-Match': '*'.
	 * 412 → ConflictError (via HttpClient). Resolves with the new ETag from the response. If the response has no ETag,
	 * the ETag is read with propfind(path, 0); if that has none either → ApiChangedError. Never retried.
	 */
	async put(path: string, content: string, precondition: PutPrecondition): Promise<DavWriteResult> {
		const headers: Record<string, string> = { 'Content-Type': 'text/markdown; charset=utf-8' };
		if ('ifMatch' in precondition) headers['If-Match'] = quoteEtag(precondition.ifMatch);
		else headers['If-None-Match'] = precondition.ifNoneMatch;
		const res = await this.http.send({ method: 'PUT', path: this.filePath(path), headers, body: content });
		const etag = etagHeader(res);
		if (etag !== undefined) return { etag };
		return { etag: await this.etagAfterWrite(path) };
	}

	/** GET of a binary file. Missing ETag → ApiChangedError. */
	async getBinary(path: string): Promise<DavBinary> {
		const res = await this.http.send({ method: 'GET', path: this.filePath(path), binaryResponse: true, timeoutMs: ATTACHMENT_TIMEOUT_MS });
		if (res.data === undefined) throw new ApiChangedError('GET response has no body bytes');
		return { data: res.data, etag: requireEtag(res, 'GET') };
	}

	/**
	 * PUT of a binary file with the given content type and exactly one precondition (see `put`). Never retried.
	 * Without an ETag header in the response the ETag is read with propfind(path, 0).
	 */
	async putBinary(path: string, data: ArrayBuffer, contentType: string, precondition: PutPrecondition): Promise<DavWriteResult> {
		const headers: Record<string, string> = { 'Content-Type': contentType };
		if ('ifMatch' in precondition) headers['If-Match'] = quoteEtag(precondition.ifMatch);
		else headers['If-None-Match'] = precondition.ifNoneMatch;
		const res = await this.http.send({ method: 'PUT', path: this.filePath(path), headers, body: data, timeoutMs: ATTACHMENT_TIMEOUT_MS });
		const etag = etagHeader(res);
		if (etag !== undefined) return { etag };
		return { etag: await this.etagAfterWrite(path) };
	}

	/** ETag of a file from PROPFIND Depth 0, for PUT responses without an ETag header. Missing → ApiChangedError. */
	private async etagAfterWrite(path: string): Promise<string> {
		const [entry] = await this.propfind(path, 0);
		const etag = entry?.etag;
		if (etag === null || etag === undefined) throw new ApiChangedError('PUT response has no ETag and PROPFIND reports none');
		return etag;
	}

	/**
	 * PROPFIND with header 'Depth': '0' | '1', 'Content-Type': 'application/xml; charset=utf-8' and PROPFIND_BODY.
	 * Expects 207. Returns parsePropfind(text, filesRootPath) where filesRootPath = URL pathname of baseUrl + filesRoot
	 * (e.g. base 'https://h/nextcloud' → '/nextcloud/remote.php/dav/files/alice').
	 */
	async propfind(path: string, depth: 0 | 1): Promise<DavEntry[]> {
		const headers = { 'Depth': String(depth), 'Content-Type': 'application/xml; charset=utf-8' };
		const res = await this.http.send({ method: 'PROPFIND', path: this.filePath(path), headers, body: PROPFIND_BODY });
		if (res.status !== 207) throw new ApiChangedError(`PROPFIND expected HTTP 207, got ${res.status}`);
		const basePath = new URL(this.http.baseUrl).pathname.replace(/\/+$/, '');
		return parsePropfind(res.text, basePath + this.filesRoot);
	}

	/** MKCOL. 201 resolves. */
	async mkcol(path: string): Promise<void> {
		await this.http.send({ method: 'MKCOL', path: this.filePath(path) });
	}

	/** DELETE (lands in the Nextcloud/Collectives trash). */
	async delete(path: string): Promise<void> {
		await this.http.send({ method: 'DELETE', path: this.filePath(path) });
	}

	private filePath(path: string): string {
		return this.filesRoot + '/' + encodeSegments(path);
	}
}
