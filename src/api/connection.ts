import { ApiChangedError, AuthError, ConfigError, NcError, NetworkError, NotFoundError, ServerError } from '../util/errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'MOVE';
export interface HttpRequest { url: string; method: HttpMethod; headers: Record<string, string>; body?: string; }
export interface HttpResponse { status: number; headers: Record<string, string>; text: string; }
/** Performs one HTTP request. Must resolve for every HTTP status (incl. 4xx/5xx); rejects only if no response was received. */
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;

export interface ConnectionCredentials { serverUrl: string; username: string; appPassword: string; }
export interface ConnectionResult { collectiveCount: number; }

export const COLLECTIVES_OCS_BASE = '/ocs/v2.php/apps/collectives/api/v1.0';

const INDEX_PHP_SUFFIX = '/index.php';

/**
 * Validates a user-entered server URL and returns its canonical base form
 * (origin + sub-path, no trailing slash, no trailing /index.php).
 * Throws ConfigError('serverUrl', ...) for blank or unusable input.
 */
export function normalizeServerUrl(input: string): string {
	const trimmed = input.trim();
	if (trimmed === '') throw new ConfigError('serverUrl', 'missing');

	const withScheme = trimmed.includes('://') ? trimmed : 'https://' + trimmed;
	// Check the raw input as well: `new URL('https://h/?').search` is '' although a '?' was typed.
	if (withScheme.includes('?') || withScheme.includes('#')) throw new ConfigError('serverUrl', 'invalid');

	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new ConfigError('serverUrl', 'invalid');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError('serverUrl', 'invalid');
	if (url.search !== '' || url.hash !== '') throw new ConfigError('serverUrl', 'invalid');
	if (url.username !== '' || url.password !== '') throw new ConfigError('serverUrl', 'invalid');
	if (url.hostname === '') throw new ConfigError('serverUrl', 'invalid');

	let path = stripTrailingSlashes(url.pathname);
	if (path.endsWith(INDEX_PHP_SUFFIX)) path = path.slice(0, -INDEX_PHP_SUFFIX.length);
	path = stripTrailingSlashes(path);

	return url.origin + path;
}

function stripTrailingSlashes(path: string): string {
	return path.replace(/\/+$/, '');
}

/** Builds an HTTP Basic Authorization header value. Encodes UTF-8 bytes with web APIs only, so it works on mobile. */
export function basicAuthHeader(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}

/**
 * Checks that the server answers the Collectives OCS API with the given credentials.
 * Input is validated before any request is sent. Resolves with the number of collectives.
 */
export async function testConnection(creds: ConnectionCredentials, request: RequestFn): Promise<ConnectionResult> {
	const baseUrl = normalizeServerUrl(creds.serverUrl);
	const username = creds.username.trim();
	if (username === '') throw new ConfigError('username', 'missing');
	// The app password is not trimmed: it is used exactly as the user entered it.
	if (creds.appPassword === '') throw new ConfigError('appPassword', 'missing');

	let res: HttpResponse;
	try {
		res = await request({
			method: 'GET',
			url: baseUrl + COLLECTIVES_OCS_BASE + '/collectives',
			headers: {
				'OCS-APIRequest': 'true',
				'Accept': 'application/json',
				'Authorization': basicAuthHeader(username, creds.appPassword),
			},
		});
	} catch (err) {
		if (err instanceof NcError) throw err;
		throw new NetworkError('Request failed', { cause: err });
	}

	if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
	if (res.status === 404) throw new NotFoundError('Collectives API not found (HTTP 404)');
	if (res.status < 200 || res.status >= 300) throw new ServerError(res.status);

	return { collectiveCount: countCollectives(res.text) };
}

/** Parses a 2xx body of the collectives list. Anything not matching the expected shape is ApiChangedError. */
function countCollectives(text: string): number {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch (err) {
		throw new ApiChangedError('Response body is not JSON', { cause: err });
	}
	if (!isRecord(body) || !isRecord(body['ocs']) || !isRecord(body['ocs']['data'])) {
		throw new ApiChangedError('Response has no ocs.data object');
	}
	const collectives = body['ocs']['data']['collectives'];
	if (!Array.isArray(collectives)) throw new ApiChangedError('Response has no ocs.data.collectives array');
	return collectives.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
