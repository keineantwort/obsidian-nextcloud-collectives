import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	basicAuthHeader,
	normalizeServerUrl,
	testConnection,
	type HttpRequest,
	type HttpResponse,
	type RequestFn,
} from '../../src/api/connection';
import { ApiChangedError, AuthError, ConfigError, NetworkError, NotFoundError, ServerError } from '../../src/util/errors';

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
	const collectives = Array.from({ length: collectiveCount }, (_, i) => ({ id: i + 1, name: `C${i + 1}` }));
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
		it.each([401, 403])('maps HTTP %i to AuthError carrying the status', async (status) => {
			const fake = fakeRequest(response(status, ''));

			const err = await captureError(testConnection(validCreds, fake.fn));

			expect(err).toBeInstanceOf(AuthError);
			expect((err as AuthError).status).toBe(status);
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
