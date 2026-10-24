// Nextcloud Login Flow v2 (architecture §10.1): the user signs in in the browser, the plugin polls for the app password.
// Uses RequestFn directly: the poll endpoint is an absolute URL and no Basic auth exists yet.
import { ApiChangedError, NetworkError, ServerError } from '../util/errors';
import { errorForStatus } from './http';
import { extractErrorDetail } from './errorDetail';
import type { RequestFn } from './http';
import { isRecord } from '../util/isRecord';

export interface LoginFlowStart {
	/** Page the user opens in the browser. */
	loginUrl: string;
	pollEndpoint: string;
	pollToken: string;
}

export interface LoginFlowCredentials {
	loginName: string;
	appPassword: string;
}

export type LoginFlowOutcome =
	| { kind: 'done'; credentials: LoginFlowCredentials }
	| { kind: 'cancelled' }
	| { kind: 'timeout' };

/** The device name Nextcloud shows in the list of app passwords (best effort; not every platform sends the header). */
const USER_AGENT = 'Obsidian Nextcloud Collectives';
/** Nextcloud keeps the login token for 20 minutes. */
export const LOGIN_FLOW_TIMEOUT_MS = 20 * 60_000;
export const LOGIN_FLOW_POLL_INTERVAL_MS = 2000;
/** Consecutive network failures while polling that end the flow. */
const MAX_POLL_NETWORK_FAILURES = 5;

/** The transport rejects when no response came; that is a NetworkError for the caller. */
async function send(request: RequestFn, req: Parameters<RequestFn>[0], what: string): ReturnType<RequestFn> {
	try {
		return await request(req);
	} catch (err) {
		throw err instanceof NetworkError ? err : new NetworkError(`Request failed: ${what}`, { cause: err });
	}
}

/** True if both URLs are http(s) and share scheme, host and port. */
function sameOrigin(a: string, b: string): boolean {
	try {
		const first = new URL(a);
		const second = new URL(b);
		return (first.protocol === 'http:' || first.protocol === 'https:') && first.origin === second.origin;
	} catch {
		return false;
	}
}

/**
 * Step 1: asks the server for a login flow. `serverUrl` is the normalized base URL.
 * The login page and the poll endpoint must belong to the same origin as the server: a server (or a man in the middle)
 * must not be able to send the user to another site or make the plugin post the poll token there.
 */
export async function startLoginFlow(serverUrl: string, request: RequestFn): Promise<LoginFlowStart> {
	const res = await send(request, { url: `${serverUrl}/index.php/login/v2`, method: 'POST', headers: { 'User-Agent': USER_AGENT } }, 'POST /index.php/login/v2');
	const failure = errorForStatus(res.status, 'POST /index.php/login/v2', extractErrorDetail(res.text, []));
	if (failure) throw failure;
	let body: unknown;
	try {
		body = JSON.parse(res.text);
	} catch {
		throw new ApiChangedError('Login flow response is not JSON');
	}
	const poll = isRecord(body) ? body['poll'] : undefined;
	const loginUrl = isRecord(body) ? body['login'] : undefined;
	const token = isRecord(poll) ? poll['token'] : undefined;
	const endpoint = isRecord(poll) ? poll['endpoint'] : undefined;
	if (typeof loginUrl !== 'string' || typeof token !== 'string' || typeof endpoint !== 'string' || token === '') {
		throw new ApiChangedError('Login flow response has an unexpected structure');
	}
	if (!sameOrigin(serverUrl, loginUrl) || !sameOrigin(serverUrl, endpoint)) {
		throw new ApiChangedError('Login flow points to another server');
	}
	return { loginUrl, pollEndpoint: endpoint, pollToken: token };
}

/** One poll. null = the user has not finished yet (the server answers 404 until then). */
export async function pollLoginFlow(start: LoginFlowStart, request: RequestFn): Promise<LoginFlowCredentials | null> {
	const res = await send(request, {
		url: start.pollEndpoint,
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
		body: `token=${encodeURIComponent(start.pollToken)}`,
	}, 'POST login flow poll');
	if (res.status === 404) return null;
	const failure = errorForStatus(res.status, 'POST login flow poll', extractErrorDetail(res.text, []));
	if (failure) throw failure;
	let body: unknown;
	try {
		body = JSON.parse(res.text);
	} catch {
		throw new ApiChangedError('Login flow poll response is not JSON');
	}
	const loginName = isRecord(body) ? body['loginName'] : undefined;
	const appPassword = isRecord(body) ? body['appPassword'] : undefined;
	if (typeof loginName !== 'string' || typeof appPassword !== 'string' || loginName === '' || appPassword === '') {
		throw new ApiChangedError('Login flow poll response has an unexpected structure');
	}
	return { loginName, appPassword };
}

export interface AwaitLoginFlowOptions {
	request: RequestFn;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	isCancelled: () => boolean;
	intervalMs?: number;
	timeoutMs?: number;
}

/** Step 2: polls until the user has signed in, cancelled, or the token has expired. */
export async function awaitLoginFlow(start: LoginFlowStart, options: AwaitLoginFlowOptions): Promise<LoginFlowOutcome> {
	const { request, sleep, now, isCancelled } = options;
	const deadline = now() + (options.timeoutMs ?? LOGIN_FLOW_TIMEOUT_MS);
	let networkFailures = 0;
	while (!isCancelled()) {
		if (now() >= deadline) return { kind: 'timeout' };
		await sleep(options.intervalMs ?? LOGIN_FLOW_POLL_INTERVAL_MS);
		if (isCancelled()) break;
		try {
			const credentials = await pollLoginFlow(start, request);
			networkFailures = 0;
			if (credentials !== null) return { kind: 'done', credentials };
		} catch (err) {
			// A dropped connection or a short 5xx (phone in a tunnel, proxy restart) is no reason to lose the flow.
			const transient = err instanceof NetworkError || (err instanceof ServerError && err.status >= 500);
			if (!transient || ++networkFailures >= MAX_POLL_NETWORK_FAILURES) throw err;
		}
	}
	return { kind: 'cancelled' };
}
