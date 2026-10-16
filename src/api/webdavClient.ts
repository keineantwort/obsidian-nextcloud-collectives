import { ApiChangedError } from '../util/errors';
import { getHeader, type HttpClient, type HttpResponse } from './http';

export interface DavFile { content: string; etag: string; }
export interface DavWriteResult { etag: string; }
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

/** Returns the ETag header of a response, or ApiChangedError if the server did not send one. */
function requireEtag(res: HttpResponse, what: string): string {
	const etag = getHeader(res.headers, 'ETag');
	if (etag === undefined || etag === '') throw new ApiChangedError(`${what} response has no ETag`);
	return etag;
}

/** WebDAV access to files below /remote.php/dav/files/{user}. Paths are user-relative, e.g. '.Collectives/Handbuch/Readme.md'. */
export class WebdavClient {
	private readonly http: HttpClient;
	private readonly filesRoot: string;

	constructor(http: HttpClient) {
		this.http = http;
		this.filesRoot = '/remote.php/dav/files/' + encodeURIComponent(http.username);
	}

	/** GET. Resolves with body text and ETag header (case-insensitive lookup). Missing ETag → ApiChangedError. */
	async get(path: string): Promise<DavFile> {
		const res = await this.http.send({ method: 'GET', path: this.filePath(path) });
		return { content: res.text, etag: requireEtag(res, 'GET') };
	}

	/**
	 * PUT with 'Content-Type': 'text/markdown; charset=utf-8' and either 'If-Match': quoteEtag(etag) or 'If-None-Match': '*'.
	 * 412 → ConflictError (via HttpClient). Resolves with the new ETag from the response; missing → ApiChangedError.
	 */
	async put(path: string, content: string, precondition: PutPrecondition): Promise<DavWriteResult> {
		const headers: Record<string, string> = { 'Content-Type': 'text/markdown; charset=utf-8' };
		if ('ifMatch' in precondition) headers['If-Match'] = quoteEtag(precondition.ifMatch);
		else headers['If-None-Match'] = precondition.ifNoneMatch;
		const res = await this.http.send({ method: 'PUT', path: this.filePath(path), headers, body: content });
		return { etag: requireEtag(res, 'PUT') };
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
