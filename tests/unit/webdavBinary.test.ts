// M8: binary transfers of the WebDAV client (getBinary, putBinary) and the request options they rely on.
import { describe, expect, it } from 'vitest';
import { createApiClients } from '../../src/api/clients';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';
import { ATTACHMENT_TIMEOUT_MS } from '../../src/api/webdavClient';
import { ApiChangedError, ConflictError } from '../../src/util/errors';

const PATH = '.Collectives/Handbuch/.attachments.97/bild b.png';
const URL_PATH = '/remote.php/dav/files/alice/.Collectives/Handbuch/.attachments.97/bild%20b.png';

function client(respond: (req: HttpRequest) => HttpResponse): { webdav: ReturnType<typeof createApiClients>['webdav']; calls: HttpRequest[] } {
	const calls: HttpRequest[] = [];
	const request: RequestFn = async (req) => {
		calls.push(req);
		return respond(req);
	};
	return { webdav: createApiClients({ baseUrl: 'https://cloud.example.com', username: 'alice', appPassword: 'pw', request, retry: false }).webdav, calls };
}

const PNG = new Uint8Array([137, 80, 78, 71]).buffer;

describe('getBinary', () => {
	it('asks for bytes with the long timeout and returns them with the ETag', async () => {
		const { webdav, calls } = client(() => ({ status: 200, headers: { ETag: '"e1"' }, text: '', data: PNG }));

		const file = await webdav.getBinary(PATH);

		expect(file).toEqual({ data: PNG, etag: '"e1"' });
		expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://cloud.example.com' + URL_PATH, binaryResponse: true, timeoutMs: ATTACHMENT_TIMEOUT_MS });
	});

	it('rejects with ApiChangedError when the transport delivered no bytes or the response has no ETag', async () => {
		await expect(client(() => ({ status: 200, headers: { ETag: '"e1"' }, text: 'x' })).webdav.getBinary(PATH)).rejects.toBeInstanceOf(ApiChangedError);
		await expect(client(() => ({ status: 200, headers: {}, text: '', data: PNG })).webdav.getBinary(PATH)).rejects.toBeInstanceOf(ApiChangedError);
	});
});

describe('putBinary', () => {
	it('sends the bytes with content type, If-None-Match and the long timeout', async () => {
		const { webdav, calls } = client(() => ({ status: 201, headers: { ETag: '"new"' }, text: '' }));

		const result = await webdav.putBinary(PATH, PNG, 'image/png', { ifNoneMatch: '*' });

		expect(result).toEqual({ etag: '"new"' });
		expect(calls[0]).toMatchObject({ method: 'PUT', body: PNG, timeoutMs: ATTACHMENT_TIMEOUT_MS });
		expect(calls[0]?.headers).toMatchObject({ 'Content-Type': 'image/png', 'If-None-Match': '*' });
	});

	it('sends If-Match with a quoted ETag', async () => {
		const { webdav, calls } = client(() => ({ status: 204, headers: { ETag: '"new"' }, text: '' }));

		await webdav.putBinary(PATH, PNG, 'image/png', { ifMatch: 'abc' });

		expect(calls[0]?.headers).toMatchObject({ 'If-Match': '"abc"' });
	});

	it('maps 412 to ConflictError and does not retry the write', async () => {
		const { webdav, calls } = client(() => ({ status: 412, headers: {}, text: '' }));

		await expect(webdav.putBinary(PATH, PNG, 'image/png', { ifNoneMatch: '*' })).rejects.toBeInstanceOf(ConflictError);
		expect(calls).toHaveLength(1);
	});

	it('reads the ETag with PROPFIND when the response has none', async () => {
		const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${URL_PATH}</d:href><d:propstat><d:prop><d:getetag>"from-propfind"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
		const { webdav, calls } = client((req) => (req.method === 'PUT' ? { status: 201, headers: {}, text: '' } : { status: 207, headers: {}, text: xml }));

		const result = await webdav.putBinary(PATH, PNG, 'image/png', { ifNoneMatch: '*' });

		expect(result.etag).toBe('"from-propfind"');
		expect(calls.map((call) => call.method)).toEqual(['PUT', 'PROPFIND']);
	});
});
