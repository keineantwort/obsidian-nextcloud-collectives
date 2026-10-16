import { beforeAll, describe, expect, it } from 'vitest';
import { testConnection, type HttpRequest, type RequestFn } from '../../src/api/connection';
import { AuthError, NetworkError, NotFoundError } from '../../src/util/errors';
import { fetchRequest, loadTestServerEnv, type TestServerEnv } from './helpers';

const COLLECTIVES_PATH = '/ocs/v2.php/apps/collectives/api/v1.0/collectives';

let env: TestServerEnv;

/**
 * Independent oracle: counts collectives with a raw fetch and a hand-built Basic header,
 * so the test does not depend on the code under test.
 */
async function rawCollectiveCount(baseUrl: string): Promise<number> {
	const res = await fetch(baseUrl + COLLECTIVES_PATH, {
		headers: {
			'OCS-APIRequest': 'true',
			'Accept': 'application/json',
			'Authorization': 'Basic ' + Buffer.from(`${env.user}:${env.password}`, 'utf8').toString('base64'),
		},
	});
	const body = (await res.json()) as { ocs: { data: { collectives: unknown[] } } };
	return body.ocs.data.collectives.length;
}

beforeAll(async () => {
	env = loadTestServerEnv();
	let installed = false;
	try {
		const res = await fetch(`${env.baseUrl}/status.php`);
		const body = (await res.json()) as { installed?: unknown };
		installed = body.installed === true;
	} catch {
		installed = false;
	}
	if (!installed) throw new Error('Testserver läuft nicht: npm run nc:up ausführen');
});

describe('testConnection against the local Docker Nextcloud', () => {
	it('returns the same collective count as a raw OCS request with valid credentials', async () => {
		const expected = await rawCollectiveCount(env.baseUrl);

		const result = await testConnection(
			{ serverUrl: env.baseUrl, username: env.user, appPassword: env.password },
			fetchRequest,
		);

		// Guard: a server with zero collectives would make the equality below pass trivially.
		expect(expected).toBeGreaterThan(0);
		expect(result.collectiveCount).toBe(expected);
	});

	it('rejects with AuthError (status 401) when the password is wrong', async () => {
		const attempt = testConnection(
			{ serverUrl: env.baseUrl, username: env.user, appPassword: env.password + '-wrong' },
			fetchRequest,
		);

		await expect(attempt).rejects.toBeInstanceOf(AuthError);
		await expect(attempt).rejects.toMatchObject({ status: 401 });
	});

	it('rejects with NotFoundError when the server URL points to a non-existent path', async () => {
		const attempt = testConnection(
			{ serverUrl: env.baseUrl + '/does-not-exist', username: env.user, appPassword: env.password },
			fetchRequest,
		);

		await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
	});

	it('rejects with NetworkError when nothing listens on the server port', async () => {
		const attempt = testConnection(
			{ serverUrl: 'http://127.0.0.1:1', username: env.user, appPassword: env.password },
			fetchRequest,
		);

		await expect(attempt).rejects.toBeInstanceOf(NetworkError);
	});

	it('normalizes a trailing /index.php/ so the request hits the collectives endpoint and succeeds', async () => {
		const expected = await rawCollectiveCount(env.baseUrl);
		const sent: HttpRequest[] = [];
		const recording: RequestFn = async (req) => {
			sent.push(req);
			return fetchRequest(req);
		};

		const result = await testConnection(
			{ serverUrl: env.baseUrl + '/index.php/', username: env.user, appPassword: env.password },
			recording,
		);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(env.baseUrl + COLLECTIVES_PATH);
		expect(result.collectiveCount).toBe(expected);
	});
});
