import { describe, expect, it } from 'vitest';
import { awaitLoginFlow, pollLoginFlow, startLoginFlow } from '../../src/api/loginFlow';
import type { LoginFlowStart } from '../../src/api/loginFlow';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';
import { ApiChangedError, AuthError, NetworkError, ServerError } from '../../src/util/errors';

const SERVER = 'https://cloud.example.com';
const startBody = (over: Record<string, unknown> = {}): string => JSON.stringify({
	poll: { token: 'tok+/=', endpoint: `${SERVER}/login/v2/poll` },
	login: `${SERVER}/login/v2/flow/abc`,
	...over,
});
const res = (status: number, text = ''): HttpResponse => ({ status, headers: {}, text });

describe('startLoginFlow', () => {
	it('posts to /index.php/login/v2 and returns login URL and poll data', async () => {
		const seen: HttpRequest[] = [];
		const request: RequestFn = async (req) => { seen.push(req); return res(200, startBody()); };
		const start = await startLoginFlow(SERVER, request);
		expect(seen[0]?.method).toBe('POST');
		expect(seen[0]?.url).toBe(`${SERVER}/index.php/login/v2`);
		expect(start).toEqual({ loginUrl: `${SERVER}/login/v2/flow/abc`, pollEndpoint: `${SERVER}/login/v2/poll`, pollToken: 'tok+/=' });
	});

	it('keeps a sub-path installation', async () => {
		const base = `${SERVER}/nextcloud`;
		const request: RequestFn = async (req) => {
			expect(req.url).toBe(`${base}/index.php/login/v2`);
			return res(200, startBody({ login: `${base}/login/v2/flow/x`, poll: { token: 't', endpoint: `${base}/login/v2/poll` } }));
		};
		await expect(startLoginFlow(base, request)).resolves.toMatchObject({ pollToken: 't' });
	});

	it.each([
		['login URL on another host', { login: 'https://evil.example.org/login' }],
		['poll endpoint on another host', { poll: { token: 't', endpoint: 'https://evil.example.org/poll' } }],
		['login URL with another scheme', { login: 'http://cloud.example.com/login' }],
		['non-http login URL', { login: 'javascript:alert(1)' }],
		['login URL on another port', { login: 'https://cloud.example.com:8443/login' }],
		['missing token', { poll: { endpoint: `${SERVER}/poll` } }],
		['empty token', { poll: { token: '', endpoint: `${SERVER}/poll` } }],
		['non-string login', { login: 5 }],
	])('rejects %s', async (_name, over) => {
		const request: RequestFn = async () => res(200, startBody(over));
		await expect(startLoginFlow(SERVER, request)).rejects.toBeInstanceOf(ApiChangedError);
	});

	it('rejects a body that is not JSON', async () => {
		await expect(startLoginFlow(SERVER, async () => res(200, '<html>'))).rejects.toBeInstanceOf(ApiChangedError);
	});

	it('maps HTTP errors through the central mapping', async () => {
		await expect(startLoginFlow(SERVER, async () => res(500))).rejects.toBeInstanceOf(ServerError);
		await expect(startLoginFlow(SERVER, async () => res(404))).rejects.toMatchObject({ name: 'NotFoundError' });
	});

	it('wraps a transport failure in NetworkError', async () => {
		await expect(startLoginFlow(SERVER, async () => { throw new Error('offline'); })).rejects.toBeInstanceOf(NetworkError);
	});

	it('rejects a 503 with a ServerError carrying the OCS message of the body as detail', async () => {
		const body = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 503, message: 'Maintenance mode is active' } } });

		const err = await startLoginFlow(SERVER, async () => res(503, body)).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ServerError);
		expect((err as ServerError).detail).toBe('Maintenance mode is active');
	});
});

const START: LoginFlowStart = { loginUrl: `${SERVER}/login`, pollEndpoint: `${SERVER}/poll`, pollToken: 'a b&c' };

describe('pollLoginFlow', () => {
	it('posts the URL-encoded token to the poll endpoint', async () => {
		const seen: HttpRequest[] = [];
		await pollLoginFlow(START, async (req) => { seen.push(req); return res(404); });
		expect(seen[0]?.url).toBe(START.pollEndpoint);
		expect(seen[0]?.method).toBe('POST');
		expect(seen[0]?.body).toBe('token=a%20b%26c');
		expect(seen[0]?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
	});

	it('does not send an Authorization header', async () => {
		const seen: HttpRequest[] = [];
		await pollLoginFlow(START, async (req) => { seen.push(req); return res(404); });
		expect(Object.keys(seen[0]?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain('authorization');
	});

	it('returns null while the user has not finished (404)', async () => {
		await expect(pollLoginFlow(START, async () => res(404))).resolves.toBeNull();
	});

	it('returns login name and app password when done', async () => {
		const body = JSON.stringify({ server: SERVER, loginName: 'anna', appPassword: 'secret-pw' });
		await expect(pollLoginFlow(START, async () => res(200, body))).resolves.toEqual({ loginName: 'anna', appPassword: 'secret-pw' });
	});

	it('rejects a done response without app password', async () => {
		const body = JSON.stringify({ loginName: 'anna' });
		await expect(pollLoginFlow(START, async () => res(200, body))).rejects.toBeInstanceOf(ApiChangedError);
	});

	it('maps 401 to AuthError and 5xx to ServerError', async () => {
		await expect(pollLoginFlow(START, async () => res(401))).rejects.toBeInstanceOf(AuthError);
		await expect(pollLoginFlow(START, async () => res(503))).rejects.toBeInstanceOf(ServerError);
	});

	it('rejects a 500 with a ServerError whose detail masks the poll token', async () => {
		const body = JSON.stringify({ ocs: { meta: { message: `Token ${START.pollToken} is broken` } } });

		const err = await pollLoginFlow(START, async () => res(500, body)).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ServerError);
		const detail = (err as ServerError).detail;
		expect(detail).not.toContain(START.pollToken);
		expect(detail).toContain('***');
	});

	it('keeps the app password out of error messages', async () => {
		const body = JSON.stringify({ loginName: '', appPassword: 'secret-pw' });
		const err = await pollLoginFlow(START, async () => res(200, body)).catch((e: unknown) => e);
		expect(String((err as Error).message)).not.toContain('secret-pw');
	});
});

function loop(responses: (HttpResponse | Error)[], opts: { cancelAfterPolls?: number; timeoutMs?: number } = {}) {
	let now = 0;
	let polls = 0;
	const request: RequestFn = async () => {
		const next = responses[Math.min(polls, responses.length - 1)] ?? res(404);
		polls++;
		if (next instanceof Error) throw next;
		return next;
	};
	return {
		polls: () => polls,
		run: () => awaitLoginFlow(START, {
			request,
			sleep: async (ms) => { now += ms; },
			now: () => now,
			isCancelled: () => opts.cancelAfterPolls !== undefined && polls >= opts.cancelAfterPolls,
			intervalMs: 2000,
			timeoutMs: opts.timeoutMs ?? 20 * 60_000,
		}),
	};
}

describe('awaitLoginFlow', () => {
	const done = res(200, JSON.stringify({ loginName: 'anna', appPassword: 'pw' }));

	it('polls until the credentials arrive', async () => {
		const l = loop([res(404), res(404), done]);
		await expect(l.run()).resolves.toEqual({ kind: 'done', credentials: { loginName: 'anna', appPassword: 'pw' } });
		expect(l.polls()).toBe(3);
	});

	it('ends as cancelled and stops polling', async () => {
		const l = loop([res(404)], { cancelAfterPolls: 2 });
		await expect(l.run()).resolves.toEqual({ kind: 'cancelled' });
		expect(l.polls()).toBe(2);
	});

	it('does not poll at all if cancelled before the first poll', async () => {
		const l = loop([res(404)], { cancelAfterPolls: 0 });
		await expect(l.run()).resolves.toEqual({ kind: 'cancelled' });
		expect(l.polls()).toBe(0);
	});

	it('ends with timeout when the token has expired', async () => {
		const l = loop([res(404)], { timeoutMs: 10_000 });
		await expect(l.run()).resolves.toEqual({ kind: 'timeout' });
		expect(l.polls()).toBe(5);
	});

	it('survives short network failures', async () => {
		const l = loop([new NetworkError('x'), new NetworkError('x'), done]);
		await expect(l.run()).resolves.toMatchObject({ kind: 'done' });
	});

	it('gives up after repeated network failures', async () => {
		const l = loop([new NetworkError('x')]);
		await expect(l.run()).rejects.toBeInstanceOf(NetworkError);
		expect(l.polls()).toBe(5);
	});

	it('survives a short 5xx from a proxy', async () => {
		const l = loop([res(502), res(503), done]);
		await expect(l.run()).resolves.toMatchObject({ kind: 'done' });
	});

	it('does not swallow other errors', async () => {
		const l = loop([res(401)]);
		await expect(l.run()).rejects.toBeInstanceOf(AuthError);
	});
});
