import { describe, expect, it } from 'vitest';
import {
	basicAuthHeader,
	errorForStatus,
	getHeader,
	HttpClient,
	type HttpRequest,
	type HttpResponse,
	type RequestFn,
} from '../../src/api/http';
import { AuthError, ConflictError, ForbiddenError, NetworkError, NotFoundError, ServerError } from '../../src/util/errors';

const BASE_URL = 'https://cloud.example.com';
const PASSWORD = 'pw-SECRET-123';
const PATH = '/ocs/v2.php/apps/collectives/api/v1.0/collectives';

type Outcome = HttpResponse | Error;

interface FakeRequest {
	fn: RequestFn;
	calls: HttpRequest[];
}

/** Hand-written RequestFn: records every request and answers with the queued outcomes, one per call. */
function fakeRequest(...outcomes: Outcome[]): FakeRequest {
	const calls: HttpRequest[] = [];
	const queue = [...outcomes];
	const fn: RequestFn = async (req) => {
		calls.push(req);
		const next = queue.shift();
		if (next === undefined) throw new Error('fake: no outcome queued for this request');
		if (next instanceof Error) throw next;
		return next;
	};
	return { fn, calls };
}

function reply(status: number, text = ''): HttpResponse {
	return { status, headers: {}, text };
}

interface FakeSleep {
	sleep: (ms: number) => Promise<void>;
	delays: number[];
}

/** Records the requested delays and resolves at once, so retry tests never wait on real timers. */
function recordingSleep(): FakeSleep {
	const delays: number[] = [];
	return {
		sleep: async (ms) => {
			delays.push(ms);
		},
		delays,
	};
}

interface ClientOptions {
	retry?: boolean;
	sleep?: (ms: number) => Promise<void>;
}

function createClient(fake: FakeRequest, options: ClientOptions = {}): HttpClient {
	return new HttpClient({ baseUrl: BASE_URL, username: 'alice', appPassword: PASSWORD, request: fake.fn, ...options });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

describe('errorForStatus', () => {
	it.each([200, 204, 207, 299])('returns null for successful HTTP %i', (status) => {
		const err = errorForStatus(status, `GET ${PATH}`);

		expect(err).toBeNull();
	});

	it('maps HTTP 401 to AuthError carrying the status', () => {
		const err = errorForStatus(401, `GET ${PATH}`);

		expect(err).toBeInstanceOf(AuthError);
		expect(err).toMatchObject({ status: 401 });
	});

	it('maps HTTP 403 to ForbiddenError, not AuthError', () => {
		const err = errorForStatus(403, `DELETE ${PATH}`);

		expect(err).toBeInstanceOf(ForbiddenError);
		expect(err).not.toBeInstanceOf(AuthError);
	});

	it('maps HTTP 404 to NotFoundError', () => {
		const err = errorForStatus(404, `GET ${PATH}`);

		expect(err).toBeInstanceOf(NotFoundError);
	});

	it('maps HTTP 412 to ConflictError', () => {
		const err = errorForStatus(412, `PUT ${PATH}`);

		expect(err).toBeInstanceOf(ConflictError);
	});

	it.each([400, 405, 500, 503])('maps HTTP %i to ServerError carrying the status', (status) => {
		const err = errorForStatus(status, `GET ${PATH}`);

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status });
	});

	it('includes the request description in the ServerError message', () => {
		const err = errorForStatus(500, `GET ${PATH}`);

		expect(err?.message).toContain(`GET ${PATH}`);
	});
});

describe('getHeader', () => {
	it('finds a header regardless of the case used in the lookup or in the map', () => {
		const headers = { 'Content-Type': 'text/markdown', 'ETag': '"abc"' };

		expect(getHeader(headers, 'content-type')).toBe('text/markdown');
		expect(getHeader(headers, 'ETAG')).toBe('"abc"');
	});

	it('returns undefined when the header is absent', () => {
		expect(getHeader({}, 'ETag')).toBeUndefined();
		expect(getHeader({ 'Content-Type': 'text/plain' }, 'ETag')).toBeUndefined();
	});
});

describe('HttpClient.send request', () => {
	it('sends the method to baseUrl + path', async () => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({ method: 'GET', path: PATH });

		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]).toMatchObject({ method: 'GET', url: BASE_URL + PATH });
	});

	it.each(['GET', 'PROPFIND'] as const)('asks the server, not a cache, for every %s (Electron caches WebDAV responses)', async (method) => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({ method, path: PATH });

		expect(getHeader(fake.calls[0]?.headers ?? {}, 'Cache-Control')).toBe('no-cache');
		expect(getHeader(fake.calls[0]?.headers ?? {}, 'Pragma')).toBe('no-cache');
	});

	it('sends no cache headers with a write', async () => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({ method: 'PUT', path: PATH, body: 'x' });

		expect(getHeader(fake.calls[0]?.headers ?? {}, 'Cache-Control')).toBeUndefined();
	});

	it('sends the Basic Authorization header of the configured user', async () => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({ method: 'GET', path: PATH });

		expect(getHeader(fake.calls[0]?.headers ?? {}, 'Authorization')).toBe(basicAuthHeader('alice', PASSWORD));
	});

	it.each(['Authorization', 'authorization'])('keeps the Basic Authorization header when the caller sets %s', async (name) => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({ method: 'GET', path: PATH, headers: { [name]: 'Bearer hijack' } });

		expect(getHeader(fake.calls[0]?.headers ?? {}, 'Authorization')).toBe(basicAuthHeader('alice', PASSWORD));
		expect(Object.values(fake.calls[0]?.headers ?? {})).not.toContain('Bearer hijack');
	});

	it('passes the caller headers and the body through unchanged', async () => {
		const fake = fakeRequest(reply(200));
		const client = createClient(fake);

		await client.send({
			method: 'POST',
			path: PATH,
			headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json' },
			body: '{"name":"Handbuch"}',
		});

		expect(fake.calls[0]?.headers).toMatchObject({ 'OCS-APIRequest': 'true', 'Content-Type': 'application/json' });
		expect(fake.calls[0]?.body).toBe('{"name":"Handbuch"}');
	});

	it.each([
		['a path without leading slash', 'ocs/v2.php/apps'],
		['an absolute URL', 'https://evil.example.com/steal'],
		['a path that embeds a scheme', '/redirect?to=https://evil.example.com'],
	])('rejects %s with "Invalid request path" without sending anything', async (_label, path) => {
		const fake = fakeRequest();
		const client = createClient(fake);

		const err = await captureError(client.send({ method: 'GET', path }));

		expect(err).toHaveProperty('message', 'Invalid request path');
		expect(fake.calls).toHaveLength(0);
	});
});

describe('HttpClient.send failure handling', () => {
	it('wraps a plain RequestFn rejection in NetworkError and keeps the original as cause', async () => {
		const original = new Error('socket hang up');
		const fake = fakeRequest(original);
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(NetworkError);
		expect((err as NetworkError).cause).toBe(original);
	});

	it('passes an NcError rejected by the RequestFn through as the same instance', async () => {
		const original = new NetworkError('timeout');
		const fake = fakeRequest(original);
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBe(original);
	});

	it('resolves a 2xx response with the response unchanged', async () => {
		const response = reply(207, '<d:multistatus/>');
		const fake = fakeRequest(response);
		const client = createClient(fake, { retry: false });

		const result = await client.send({ method: 'PROPFIND', path: PATH });

		expect(result).toEqual(response);
	});

	it('rejects HTTP 401 with AuthError carrying the status', async () => {
		const fake = fakeRequest(reply(401));
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(AuthError);
		expect(err).toMatchObject({ status: 401 });
	});

	it('rejects HTTP 403 with ForbiddenError, not AuthError', async () => {
		const fake = fakeRequest(reply(403));
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'DELETE', path: PATH }));

		expect(err).toBeInstanceOf(ForbiddenError);
		expect(err).not.toBeInstanceOf(AuthError);
	});

	it('rejects HTTP 404 with NotFoundError', async () => {
		const fake = fakeRequest(reply(404));
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(NotFoundError);
	});

	it('rejects HTTP 412 with ConflictError', async () => {
		const fake = fakeRequest(reply(412));
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'PUT', path: PATH }));

		expect(err).toBeInstanceOf(ConflictError);
	});

	it('rejects HTTP 400 with ServerError carrying the status', async () => {
		const fake = fakeRequest(reply(400));
		const client = createClient(fake, { retry: false });

		const err = await captureError(client.send({ method: 'POST', path: PATH }));

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status: 400 });
	});

	it('never puts the password or the Authorization value into an error message', async () => {
		const failures: Outcome[] = [
			reply(400, `echo ${PASSWORD}`),
			reply(401),
			reply(403),
			reply(404),
			reply(412),
			reply(500),
			new Error(`connect failed with ${PASSWORD}`),
		];
		const secretValues = [PASSWORD, basicAuthHeader('alice', PASSWORD).slice('Basic '.length)];

		for (const failure of failures) {
			const client = createClient(fakeRequest(failure), { retry: false });

			const err = await captureError(client.send({ method: 'PUT', path: PATH }));

			expect(err).toBeInstanceOf(Error);
			const message = String((err as Error).message);
			for (const secret of secretValues) expect(message).not.toContain(secret);
		}
	});
});

describe('HttpClient.send retries', () => {
	it('retries a GET that fails with 503 and resolves with the third attempt', async () => {
		const fake = fakeRequest(reply(503), reply(503), reply(200, 'ok'));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const result = await client.send({ method: 'GET', path: PATH });

		expect(result).toEqual(reply(200, 'ok'));
		expect(fake.calls).toHaveLength(3);
		expect(timing.delays).toEqual([1000, 2000]);
	});

	it('gives up after three retries of a GET that keeps failing with 500', async () => {
		const fake = fakeRequest(reply(500), reply(500), reply(500), reply(500));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status: 500 });
		expect(fake.calls).toHaveLength(4);
		expect(timing.delays).toEqual([1000, 2000, 4000]);
	});

	it('retries a PROPFIND after a NetworkError', async () => {
		const fake = fakeRequest(new Error('connection reset'), new Error('connection reset'), reply(207, '<d:multistatus/>'));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const result = await client.send({ method: 'PROPFIND', path: PATH });

		expect(result.status).toBe(207);
		expect(fake.calls).toHaveLength(3);
		expect(timing.delays).toEqual([1000, 2000]);
	});

	it('sends the retry only after the injected sleep has resolved', async () => {
		const fake = fakeRequest(reply(503), reply(200));
		const delays: number[] = [];
		const pendingSleeps: Array<() => void> = [];
		const sleep = (ms: number): Promise<void> => {
			delays.push(ms);
			return new Promise<void>((resolve) => pendingSleeps.push(resolve));
		};
		const client = createClient(fake, { sleep });

		const sending = client.send({ method: 'GET', path: PATH });
		for (let i = 0; i < 50; i++) await Promise.resolve();

		expect(delays).toEqual([1000]);
		expect(fake.calls).toHaveLength(1);

		pendingSleeps.shift()?.();
		const result = await sending;

		expect(result.status).toBe(200);
		expect(fake.calls).toHaveLength(2);
	});

	it.each(['PUT', 'POST', 'DELETE'] as const)('does not retry %s after a 503, so the write is sent once', async (method) => {
		const fake = fakeRequest(reply(503), reply(200));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const err = await captureError(client.send({ method, path: PATH }));

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status: 503 });
		expect(fake.calls).toHaveLength(1);
		expect(timing.delays).toEqual([]);
	});

	it('does not retry a POST after a NetworkError', async () => {
		const fake = fakeRequest(new Error('connection reset'), reply(200));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const err = await captureError(client.send({ method: 'POST', path: PATH }));

		expect(err).toBeInstanceOf(NetworkError);
		expect(fake.calls).toHaveLength(1);
		expect(timing.delays).toEqual([]);
	});

	it.each([401, 404])('does not retry a GET after HTTP %i', async (status) => {
		const fake = fakeRequest(reply(status), reply(200));
		const timing = recordingSleep();
		const client = createClient(fake, { sleep: timing.sleep });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(Error);
		expect(fake.calls).toHaveLength(1);
		expect(timing.delays).toEqual([]);
	});

	it('does not retry a GET with 503 when retry is disabled', async () => {
		const fake = fakeRequest(reply(503), reply(200));
		const timing = recordingSleep();
		const client = createClient(fake, { retry: false, sleep: timing.sleep });

		const err = await captureError(client.send({ method: 'GET', path: PATH }));

		expect(err).toBeInstanceOf(ServerError);
		expect(fake.calls).toHaveLength(1);
		expect(timing.delays).toEqual([]);
	});
});

describe('HttpClient onAttempt (debug log)', () => {
	it('reports method, path, status and duration of every attempt, without headers or body', async () => {
		const seen: { method: string; path: string; status: number; ms: number }[] = [];
		const fake = fakeRequest(reply(500), reply(200));
		const client = new HttpClient({ baseUrl: BASE_URL, username: 'alice', appPassword: PASSWORD, request: fake.fn, sleep: async () => undefined, onAttempt: (info) => seen.push(info) });

		await client.send({ method: 'GET', path: PATH });

		expect(seen.map(({ method, path, status }) => ({ method, path, status }))).toEqual([
			{ method: 'GET', path: PATH, status: 500 },
			{ method: 'GET', path: PATH, status: 200 },
		]);
		expect(seen.every((s) => s.ms >= 0)).toBe(true);
		expect(JSON.stringify(seen)).not.toContain(PASSWORD);
	});

	it('reports status 0 when no response arrived', async () => {
		const seen: { status: number }[] = [];
		const fake = fakeRequest(new Error('offline'));
		const client = new HttpClient({ baseUrl: BASE_URL, username: 'alice', appPassword: PASSWORD, request: fake.fn, retry: false, onAttempt: (info) => seen.push(info) });

		await expect(client.send({ method: 'PUT', path: PATH })).rejects.toBeInstanceOf(NetworkError);

		expect(seen.map((s) => s.status)).toEqual([0]);
	});
});
