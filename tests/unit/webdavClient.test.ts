import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApiClients, type ApiClients } from '../../src/api/clients';
import { basicAuthHeader, type HttpRequest, type HttpResponse, type RequestFn } from '../../src/api/http';
import { parsePropfind, quoteEtag, type DavEntry } from '../../src/api/webdavClient';
import { ApiChangedError, ConflictError, NotFoundError, ServerError } from '../../src/util/errors';

const BASE_URL = 'https://cloud.example.com';
const USERNAME = 'alice';
const PASSWORD = 'pw-SECRET-123';
const FILES_ROOT = '/remote.php/dav/files/alice';
const PAGE_PATH = '.Collectives/Handbuch/Onboarding.md';

const EXPECTED_PATHS = [
	'.Collectives/Handbuch',
	'.Collectives/Handbuch/Readme.md',
	'.Collectives/Handbuch/Onboarding.md',
	'.Collectives/Handbuch/Prozesse',
	'.Collectives/Handbuch/A-B Fragen #1 [x].md',
	'.Collectives/Handbuch/Per WebDAV.md',
];

interface FixtureFile {
	request: { method: string; path: string; headers?: Record<string, string> };
	status: number;
	headers?: Record<string, string>;
}

function readFixture(name: string): FixtureFile {
	return JSON.parse(readFileSync(new URL(`../fixtures/m0/${name}`, import.meta.url), 'utf8')) as FixtureFile;
}

function readPropfindXml(): string {
	return readFileSync(new URL('../fixtures/m0/dav-propfind-depth1.body.xml', import.meta.url), 'utf8');
}

function responseFromFixture(fixture: FixtureFile, text = ''): HttpResponse {
	return { status: fixture.status, headers: fixture.headers ?? {}, text };
}

interface FakeDav {
	fn: RequestFn;
	calls: HttpRequest[];
}

/** Hand-written RequestFn: records every request and answers each one with the given response. */
function fakeDav(response: HttpResponse): FakeDav {
	const calls: HttpRequest[] = [];
	const fn: RequestFn = async (req) => {
		calls.push(req);
		return response;
	};
	return { fn, calls };
}

/** Returns the single recorded request (fails the test if there is none). */
function onlyCall(fake: FakeDav): HttpRequest {
	const [call] = fake.calls;
	if (!call) throw new Error('expected at least one request, but none was sent');
	return call;
}

function davClient(fake: FakeDav, username = USERNAME, baseUrl = BASE_URL): ApiClients['webdav'] {
	return createApiClients({ baseUrl, username, appPassword: PASSWORD, request: fake.fn, retry: false }).webdav;
}

function entryAt(entries: DavEntry[], path: string): DavEntry {
	const found = entries.find((entry) => entry.path === path);
	if (!found) throw new Error(`no entry for path ${path}`);
	return found;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

/** Runs a synchronous function and returns the error it throws (fails the test if it does not throw). */
function captureSync(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected the function to throw, but it returned');
}

describe('quoteEtag', () => {
	it.each([
		['abc', '"abc"'],
		['"abc"', '"abc"'],
		['W/"abc"', 'W/"abc"'],
	])('turns %j into %j', (input, expected) => {
		expect(quoteEtag(input)).toBe(expected);
	});
});

describe('get', () => {
	it('sends a GET to the encoded file URL with Basic auth and no body', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json'), '# Onboarding\n'));

		await davClient(fake).get(PAGE_PATH);

		expect(fake.calls).toHaveLength(1);
		expect(onlyCall(fake)).toMatchObject({
			url: BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Onboarding.md',
			method: 'GET',
		});
		expect(onlyCall(fake).headers['Authorization']).toBe(basicAuthHeader(USERNAME, PASSWORD));
		expect(onlyCall(fake).body).toBeUndefined();
	});

	it('resolves with the body text and the ETag from the response headers', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json'), '# Onboarding\n'));

		const file = await davClient(fake).get(PAGE_PATH);

		expect(file).toEqual({ content: '# Onboarding\n', etag: '"9f5fe63ab652040a5c861cf2b414ee3e"' });
	});

	it('finds the ETag header even when its key is upper-case', async () => {
		const fake = fakeDav({ status: 200, headers: { ETag: '"abc123"' }, text: 'x' });

		const file = await davClient(fake).get(PAGE_PATH);

		expect(file.etag).toBe('"abc123"');
	});

	it('rejects with ApiChangedError when a 200 response carries no ETag', async () => {
		const fake = fakeDav({ status: 200, headers: {}, text: 'x' });

		const err = await captureError(davClient(fake).get(PAGE_PATH));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('rejects with NotFoundError on HTTP 404', async () => {
		const fake = fakeDav({ status: 404, headers: {}, text: '' });

		const err = await captureError(davClient(fake).get(PAGE_PATH));

		expect(err).toBeInstanceOf(NotFoundError);
	});
});

describe('path encoding', () => {
	it('percent-encodes spaces in file names', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json')));

		await davClient(fake).get('.Collectives/Handbuch/Per WebDAV.md');

		expect(onlyCall(fake).url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Per%20WebDAV.md');
	});

	it('percent-encodes #, ?, [ and ] in file names', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json')));

		await davClient(fake).get('.Collectives/Handbuch/A-B Fragen? #1 [x].md');

		expect(onlyCall(fake).url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/A-B%20Fragen%3F%20%231%20%5Bx%5D.md');
	});

	it('percent-encodes the username in the files root', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json')));

		await davClient(fake, 'a b').get(PAGE_PATH);

		expect(onlyCall(fake).url).toBe(`${BASE_URL}/remote.php/dav/files/a%20b/.Collectives/Handbuch/Onboarding.md`);
	});

	it('drops empty path segments', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json')));

		await davClient(fake).get('/.Collectives//Handbuch/Onboarding.md/');

		expect(onlyCall(fake).url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Onboarding.md');
	});

	it.each(['../bob/x.md', '.Collectives/../../x.md', './Readme.md', '..'])(
		'rejects the dot segments in %j without sending a request, so no request leaves the files root',
		async (path) => {
			const fake = fakeDav(responseFromFixture(readFixture('dav-get-empty-page.json')));

			const err = await captureError(davClient(fake).delete(path));

			expect(err).toBeInstanceOf(Error);
			expect(fake.calls).toHaveLength(0);
		},
	);
});

describe('put', () => {
	it('sends the content as markdown with a quoted If-Match and no If-None-Match', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-put-if-match-ok.json')));

		await davClient(fake).put(PAGE_PATH, 'Neu\n', { ifMatch: '9f5f' });

		const call = onlyCall(fake);
		expect(fake.calls).toHaveLength(1);
		expect(call.method).toBe('PUT');
		expect(call.url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Onboarding.md');
		expect(call.headers['If-Match']).toBe('"9f5f"');
		expect(call.headers['If-None-Match']).toBeUndefined();
		expect(call.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
		expect(call.body).toBe('Neu\n');
	});

	it('resolves with the ETag of the write response', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-put-if-match-ok.json')));

		const result = await davClient(fake).put(PAGE_PATH, 'Neu\n', { ifMatch: '9f5f' });

		expect(result).toEqual({ etag: '"4860db6fd2d2e7ee2a3828dd0e0ea2d0"' });
	});

	it('sends If-None-Match * and no If-Match when the file is created', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-put-new-file.json')));

		const result = await davClient(fake).put('.Collectives/Handbuch/Per WebDAV.md', 'Hi', { ifNoneMatch: '*' });

		const call = onlyCall(fake);
		expect(call.method).toBe('PUT');
		expect(call.url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Per%20WebDAV.md');
		expect(call.headers['If-None-Match']).toBe('*');
		expect(call.headers['If-Match']).toBeUndefined();
		expect(result).toEqual({ etag: '"5ff4d2a6a07119ac0fd9c5f861fc0da5"' });
	});

	it('maps HTTP 412 (stale ETag) to ConflictError', async () => {
		const fake = fakeDav(responseFromFixture(readFixture('dav-put-if-match-stale.json')));

		const err = await captureError(davClient(fake).put(PAGE_PATH, 'Neu', { ifMatch: '9f5f' }));

		expect(err).toBeInstanceOf(ConflictError);
	});

	it('rejects with ApiChangedError when a successful PUT response carries no ETag', async () => {
		const fake = fakeDav({ status: 204, headers: {}, text: '' });

		const err = await captureError(davClient(fake).put(PAGE_PATH, 'Neu', { ifMatch: '9f5f' }));

		expect(err).toBeInstanceOf(ApiChangedError);
	});
});

describe('propfind', () => {
	it('sends PROPFIND with Depth 1 and a body that asks for ETag and fileid', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		await davClient(fake).propfind('.Collectives/Handbuch', 1);

		const call = onlyCall(fake);
		expect(fake.calls).toHaveLength(1);
		expect(call.method).toBe('PROPFIND');
		expect(call.url).toBe(BASE_URL + FILES_ROOT + '/.Collectives/Handbuch');
		expect(call.headers['Depth']).toBe('1');
		expect(call.body).toContain('getetag');
		expect(call.body).toContain('fileid');
	});

	it('rejects a 2xx answer other than 207 Multi-Status with ApiChangedError', async () => {
		const fake = fakeDav({ status: 200, headers: {}, text: readPropfindXml() });

		const err = await captureError(davClient(fake).propfind('.Collectives/Handbuch', 1));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('sends Depth 0 when asked for depth 0', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		await davClient(fake).propfind('.Collectives/Handbuch', 0);

		expect(onlyCall(fake).headers['Depth']).toBe('0');
	});

	it('returns one entry per response, with the collection itself first', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		const entries = await davClient(fake).propfind('.Collectives/Handbuch', 1);

		expect(entries.map((entry) => entry.path)).toEqual(EXPECTED_PATHS);
		expect(entries[0]).toEqual({
			path: '.Collectives/Handbuch',
			isCollection: true,
			etag: '"6ad1dee216adf"',
			lastModified: 'Fri, 16 Oct 2026 08:22:58 GMT',
			contentLength: null,
			fileId: 91,
		});
	});

	it('reports Readme.md with its ETag, size, fileId and modification time', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		const entries = await davClient(fake).propfind('.Collectives/Handbuch', 1);

		expect(entryAt(entries, '.Collectives/Handbuch/Readme.md')).toEqual({
			path: '.Collectives/Handbuch/Readme.md',
			isCollection: false,
			etag: '"82a110eb434a6e70e7eb6f86d008519b"',
			lastModified: 'Fri, 16 Oct 2026 08:22:57 GMT',
			contentLength: 451,
			fileId: 92,
		});
	});

	it('decodes percent-encoded hrefs into plain file names', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		const entries = await davClient(fake).propfind('.Collectives/Handbuch', 1);

		expect(entryAt(entries, '.Collectives/Handbuch/A-B Fragen #1 [x].md')).toMatchObject({
			isCollection: false,
			fileId: 101,
			contentLength: 0,
		});
	});

	it('reports a sub-folder as a collection without content length', async () => {
		const fake = fakeDav({ status: 207, headers: {}, text: readPropfindXml() });

		const entries = await davClient(fake).propfind('.Collectives/Handbuch', 1);

		expect(entryAt(entries, '.Collectives/Handbuch/Prozesse')).toMatchObject({
			isCollection: true,
			fileId: 99,
			contentLength: null,
		});
	});
});

describe('parsePropfind', () => {
	it('resolves hrefs against a files root that has a sub-path', () => {
		const xml = readPropfindXml().replace(/\/remote\.php\//g, '/nextcloud/remote.php/');

		const entries = parsePropfind(xml, '/nextcloud/remote.php/dav/files/alice');

		expect(entries.map((entry) => entry.path)).toEqual(EXPECTED_PATHS);
	});

	it('sends PROPFIND to a sub-path base URL and reads the entries from the sub-path hrefs', async () => {
		const xml = readPropfindXml().replace(/\/remote\.php\//g, '/nextcloud/remote.php/');
		const fake = fakeDav({ status: 207, headers: {}, text: xml });

		const entries = await davClient(fake, USERNAME, BASE_URL + '/nextcloud').propfind('.Collectives/Handbuch', 1);

		expect(onlyCall(fake).url).toBe(`${BASE_URL}/nextcloud/remote.php/dav/files/alice/.Collectives/Handbuch`);
		expect(entries.map((entry) => entry.path)).toEqual(EXPECTED_PATHS);
	});

	it('rejects a document that keeps its multistatus root but contains a parsererror element', () => {
		// Chromium inserts <parsererror> into a truncated document instead of replacing the root (jsdom replaces it).
		const xml = readPropfindXml().replace(
			'</d:multistatus>',
			'<parsererror xmlns="http://www.mozilla.org/newlayout/xml/parsererror.xml">truncated</parsererror></d:multistatus>',
		);

		const err = captureSync(() => parsePropfind(xml, FILES_ROOT));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('rejects an href of another user whose name only starts with the own username', () => {
		const xml = readPropfindXml().replace('/remote.php/dav/files/alice/.Collectives/Handbuch/Readme.md', '/remote.php/dav/files/alice2/x.md');

		const err = captureSync(() => parsePropfind(xml, FILES_ROOT));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it.each([
		['a dot-dot segment', '/remote.php/dav/files/alice/../bob/x.md'],
		['an encoded slash inside a segment', '/remote.php/dav/files/alice/.Collectives/a%2Fb.md'],
	])('rejects an href with %s with ApiChangedError', (_label, href) => {
		const xml = readPropfindXml().replace('/remote.php/dav/files/alice/.Collectives/Handbuch/Readme.md', href);

		const err = captureSync(() => parsePropfind(xml, FILES_ROOT));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('rejects malformed XML with ApiChangedError', () => {
		const err = captureSync(() => parsePropfind('<d:multistatus xmlns:d="DAV:"><d:response>', FILES_ROOT));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it.each([
		['an HTML page', '<html/>'],
		['a multistatus in a foreign namespace', '<d:multistatus xmlns:d="urn:example"/>'],
	])('rejects %s as root with ApiChangedError', (_label, xml) => {
		const err = captureSync(() => parsePropfind(xml, FILES_ROOT));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('rejects a response whose href lies outside the files root with ApiChangedError', () => {
		const err = captureSync(() => parsePropfind(readPropfindXml(), '/nextcloud/remote.php/dav/files/alice'));

		expect(err).toBeInstanceOf(ApiChangedError);
	});

	it('tolerates a leading byte order mark', () => {
		const entries = parsePropfind('\uFEFF' + readPropfindXml(), FILES_ROOT);

		expect(entries.map((entry) => entry.path)).toEqual(EXPECTED_PATHS);
	});

	it('parses a document that uses the prefix D: exactly like the prefix d:', () => {
		const xml = readPropfindXml().replace(/xmlns:d=/g, 'xmlns:D=').replace(/<(\/?)d:/g, '<$1D:');

		const entries = parsePropfind(xml, FILES_ROOT);

		expect(entries).toEqual(parsePropfind(readPropfindXml(), FILES_ROOT));
	});

	it('ignores properties that sit in a propstat with status 404', () => {
		const xml = '<?xml version="1.0"?>'
			+ '<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">'
			+ `<d:response><d:href>${FILES_ROOT}/.Collectives/Handbuch/Geheim.md</d:href>`
			+ '<d:propstat><d:prop><d:getetag>&quot;x&quot;</d:getetag><d:getcontentlength>99</d:getcontentlength><oc:fileid>7</oc:fileid></d:prop>'
			+ '<d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>'
			+ '</d:response></d:multistatus>';

		const entries = parsePropfind(xml, FILES_ROOT);

		expect(entries).toEqual([
			{
				path: '.Collectives/Handbuch/Geheim.md',
				isCollection: false,
				etag: null,
				lastModified: null,
				contentLength: null,
				fileId: null,
			},
		]);
	});
});

describe('mkcol', () => {
	it('sends MKCOL to the encoded folder URL and resolves on 201', async () => {
		const fake = fakeDav({ status: 201, headers: {}, text: '' });

		await expect(davClient(fake).mkcol('.Collectives/Handbuch/Neuer Ordner')).resolves.toBeUndefined();

		expect(onlyCall(fake)).toMatchObject({
			method: 'MKCOL',
			url: BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Neuer%20Ordner',
		});
	});

	it('maps HTTP 405 (folder already exists) to ServerError carrying the status and no password', async () => {
		const fake = fakeDav({ status: 405, headers: {}, text: '' });

		const err = await captureError(davClient(fake).mkcol('.Collectives/Handbuch/Neuer Ordner'));

		expect(err).toBeInstanceOf(ServerError);
		expect((err as ServerError).status).toBe(405);
		expect((err as Error).message).not.toContain(PASSWORD);
	});
});

describe('delete', () => {
	it('sends DELETE to the encoded file URL and resolves on 204', async () => {
		const fake = fakeDav({ status: 204, headers: {}, text: '' });

		await expect(davClient(fake).delete('.Collectives/Handbuch/Per WebDAV.md')).resolves.toBeUndefined();

		expect(onlyCall(fake)).toMatchObject({
			method: 'DELETE',
			url: BASE_URL + FILES_ROOT + '/.Collectives/Handbuch/Per%20WebDAV.md',
		});
	});

	it('maps HTTP 404 to NotFoundError', async () => {
		const fake = fakeDav({ status: 404, headers: {}, text: '' });

		const err = await captureError(davClient(fake).delete('.Collectives/Handbuch/Weg.md'));

		expect(err).toBeInstanceOf(NotFoundError);
	});
});
