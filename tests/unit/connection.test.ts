import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInsecureRemoteUrl, normalizeServerUrl, testConnection } from '../../src/api/connection';
import { basicAuthHeader, type HttpRequest, type HttpResponse, type RequestFn } from '../../src/api/http';
import { ApiChangedError, AuthError, ConfigError, ForbiddenError, NetworkError, NotFoundError, ServerError } from '../../src/util/errors';

const COLLECTIVES_URL_SUFFIX = '/ocs/v2.php/apps/collectives/api/v1.0/collectives';

interface FakeRequest {
	fn: RequestFn;
	calls: HttpRequest[];
}

/** Hand-written RequestFn: records every request and answers with the configured response or rejection. */
function fakeRequest(outcome: HttpResponse | Error): FakeRequest {
	const calls: HttpRequest[] = [];
	const fn: RequestFn = async (req) => {
		calls.push(req);
		if (outcome instanceof Error) throw outcome;
		return outcome;
	};
	return { fn, calls };
}

function response(status: number, text: string): HttpResponse {
	return { status, headers: {}, text };
}

function okOcsBody(collectiveCount: number): string {
	const collectives = Array.from({ length: collectiveCount }, (_, i) => ({
		id: i + 1,
		circleId: `CIRCLE_ID_${i + 1}`,
		name: `C${i + 1}`,
		slug: `c${i + 1}`,
		emoji: null,
		level: 9,
		canEdit: true,
		trashTimestamp: null,
	}));
	return JSON.stringify({
		ocs: { meta: { status: 'ok', statuscode: 200, message: 'OK' }, data: { collectives } },
	});
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

const validCreds = { serverUrl: 'https://cloud.example.com', username: 'alice', appPassword: 'secret' };

describe('normalizeServerUrl', () => {
	it.each(['', '   ', '\t\n '])('rejects blank input %j with ConfigError(serverUrl, missing)', (input) => {
		const err = captureSync(() => normalizeServerUrl(input));

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'serverUrl', problem: 'missing' });
	});

	it('prepends https:// when the input has no scheme', () => {
		const result = normalizeServerUrl('cloud.example.com');

		expect(result).toBe('https://cloud.example.com');
	});

	it.each([
		['non-http scheme', 'ftp://host'],
		['unparseable URL', 'https://'],
		['query string', 'https://host/?a=1'],
		['fragment', 'https://host/#x'],
		['user info', 'https://bob:pw@host'],
	])('rejects %s (%s) with ConfigError(serverUrl, invalid)', (_label, input) => {
		const err = captureSync(() => normalizeServerUrl(input));

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'serverUrl', problem: 'invalid' });
	});

	it.each([
		['trailing slash removed', 'https://cloud.example.com/', 'https://cloud.example.com'],
		['surrounding whitespace trimmed', '  https://cloud.example.com  ', 'https://cloud.example.com'],
		['sub-path kept, trailing slash removed', 'https://example.com/nextcloud/', 'https://example.com/nextcloud'],
		['trailing /index.php/ removed', 'https://example.com/nextcloud/index.php/', 'https://example.com/nextcloud'],
		['trailing /index.php removed', 'https://example.com/index.php', 'https://example.com'],
		['scheme and host lowercased', 'HTTPS://Cloud.Example.COM', 'https://cloud.example.com'],
		['http allowed and port kept', 'http://localhost:8080', 'http://localhost:8080'],
	])('normalizes: %s', (_label, input, expected) => {
		const result = normalizeServerUrl(input);

		expect(result).toBe(expected);
	});
});

describe('basicAuthHeader', () => {
	it('encodes username and password as Basic base64', () => {
		const header = basicAuthHeader('alice', 'secret');

		expect(header).toBe('Basic YWxpY2U6c2VjcmV0');
	});

	it('encodes non-ASCII credentials as UTF-8 bytes', () => {
		const header = basicAuthHeader('jürgen', 'pässwort');

		expect(header).toBe('Basic ' + Buffer.from('jürgen:pässwort', 'utf8').toString('base64'));
	});
});

describe('testConnection', () => {
	describe('validates input before sending any request', () => {
		it.each([
			['invalid server URL', { ...validCreds, serverUrl: 'ftp://host' }, 'serverUrl', 'invalid'],
			['missing server URL', { ...validCreds, serverUrl: '  ' }, 'serverUrl', 'missing'],
			['empty username', { ...validCreds, username: '' }, 'username', 'missing'],
			['whitespace-only username', { ...validCreds, username: '   ' }, 'username', 'missing'],
			['empty app password', { ...validCreds, appPassword: '' }, 'appPassword', 'missing'],
		] as const)('rejects %s with ConfigError and performs zero requests', async (_label, creds, field, problem) => {
			const fake = fakeRequest(response(200, okOcsBody(1)));

			const err = await captureError(testConnection(creds, fake.fn));

			expect(err).toBeInstanceOf(ConfigError);
			expect(err).toMatchObject({ field, problem });
			expect(fake.calls).toHaveLength(0);
		});
	});

	describe('request sent to the server', () => {
		it('sends exactly one GET to the collectives OCS endpoint of the normalized server', async () => {
			const fake = fakeRequest(response(200, okOcsBody(0)));

			await testConnection({ ...validCreds, serverUrl: 'https://cloud.example.com/' }, fake.fn);

			expect(fake.calls).toHaveLength(1);
			expect(fake.calls[0]).toEqual({
				url: 'https://cloud.example.com' + COLLECTIVES_URL_SUFFIX,
				method: 'GET',
				headers: {
					'OCS-APIRequest': 'true',
					'Accept': 'application/json',
					'Authorization': basicAuthHeader('alice', 'secret'),
				},
			});
		});

		it('trims the username but keeps the app password exactly as entered', async () => {
			const fake = fakeRequest(response(200, okOcsBody(0)));

			await testConnection({ serverUrl: 'https://cloud.example.com', username: '  alice  ', appPassword: ' pw ' }, fake.fn);

			expect(fake.calls[0]?.headers['Authorization']).toBe(basicAuthHeader('alice', ' pw '));
		});
	});

	describe('successful responses', () => {
		it('resolves with the number of collectives in the OCS response', async () => {
			const fake = fakeRequest(response(200, okOcsBody(2)));

			const result = await testConnection(validCreds, fake.fn);

			expect(result).toEqual({ collectiveCount: 2 });
		});

		it('resolves with collectiveCount 0 for an empty collectives list', async () => {
			const fake = fakeRequest(response(200, okOcsBody(0)));

			const result = await testConnection(validCreds, fake.fn);

			expect(result).toEqual({ collectiveCount: 0 });
		});

		it('counts the collectives of the real M0 fixture response', async () => {
			const fixture = JSON.parse(
				readFileSync(new URL('../fixtures/m0/collectives-list.json', import.meta.url), 'utf8'),
			) as { response: { ocs: { data: { collectives: unknown[] } } } };
			const fake = fakeRequest(response(200, JSON.stringify(fixture.response)));

			const result = await testConnection(validCreds, fake.fn);

			expect(result.collectiveCount).toBe(fixture.response.ocs.data.collectives.length);
		});
	});

	describe('HTTP status mapping', () => {
		it('maps HTTP 401 to AuthError carrying the status 401', async () => {
			const fake = fakeRequest(response(401, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(AuthError);
			expect((err as AuthError).status).toBe(401);
		});

		it('maps HTTP 403 to ForbiddenError, not AuthError', async () => {
			const fake = fakeRequest(response(403, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(ForbiddenError);
			expect(err).not.toBeInstanceOf(AuthError);
		});

		it('maps HTTP 404 to NotFoundError', async () => {
			const fake = fakeRequest(response(404, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(NotFoundError);
		});

		it.each([400, 500, 502, 503])('maps HTTP %i to ServerError carrying the status', async (status) => {
			const fake = fakeRequest(response(status, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(ServerError);
			expect((err as ServerError).status).toBe(status);
		});
	});

	describe('unexpected 2xx bodies', () => {
		it.each([
			['HTML login page', '<html>login</html>'],
			['empty object', '{}'],
			['missing collectives list', '{"ocs":{"data":{}}}'],
			['collectives is not an array', '{"ocs":{"data":{"collectives":"x"}}}'],
		])('maps a 200 with %s to ApiChangedError', async (_label, body) => {
			const fake = fakeRequest(response(200, body));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(ApiChangedError);
		});

		it('maps a 200 whose collectives entry lacks circleId to ApiChangedError', async () => {
			const body = JSON.stringify({
				ocs: {
					meta: { status: 'ok', statuscode: 200, message: 'OK' },
					data: { collectives: [{ id: 1, name: 'C1', slug: 'c1', emoji: null, level: 9, canEdit: true, trashTimestamp: null }] },
				},
			});
			const fake = fakeRequest(response(200, body));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(ApiChangedError);
		});
	});

	describe('retries', () => {
		it('does not retry: a 503 is answered with exactly one request', async () => {
			const fake = fakeRequest(response(503, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(ServerError);
			expect(fake.calls).toHaveLength(1);
		});
	});

	describe('transport failures', () => {
		it('wraps a raw network error in NetworkError and keeps it as cause', async () => {
			const original = new Error('ECONNREFUSED');
			const fake = fakeRequest(original);

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(NetworkError);
			expect((err as NetworkError).cause).toBe(original);
		});

		it('rethrows an existing NetworkError instance unchanged', async () => {
			const original = new NetworkError('timeout');
			const fake = fakeRequest(original);

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBe(original);
		});
	});
});

/** Runs a synchronous function and returns the error it throws (fails the test if it does not throw). */
function captureSync(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected the function to throw, but it returned');
}

describe('isInsecureRemoteUrl', () => {
	it.each([
		['https to a remote host', 'https://cloud.example.com'],
		['http to localhost with port', 'http://localhost:8080'],
		['http to a *.localhost subdomain', 'http://dev.localhost'],
		['http to 127.0.0.1', 'http://127.0.0.1'],
		['http to another 127.x.y.z address', 'http://127.1.2.3:8080'],
		['http to IPv6 loopback', 'http://[::1]:8080'],
		['unparsable input', 'not a url'],
	])('is false for %s (%j)', (_label, url) => {
		expect(isInsecureRemoteUrl(url)).toBe(false);
	});

	it.each([
		['http to a remote host', 'http://cloud.example.com'],
		['http to a private LAN address', 'http://192.168.1.10'],
		['http to a host starting with localhost', 'http://localhost.example.com'],
		['http to 128.0.0.1 (outside 127/8)', 'http://128.0.0.1'],
	])('is true for %s (%j)', (_label, url) => {
		expect(isInsecureRemoteUrl(url)).toBe(true);
	});
});
