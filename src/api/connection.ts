import { ConfigError } from '../util/errors';
import { createApiClients } from './clients';
import type { RequestFn } from './http';

export interface ConnectionCredentials { serverUrl: string; username: string; appPassword: string; }
export interface ConnectionResult { collectiveCount: number; }

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

/**
 * True if the URL uses plain http to a host other than the local machine (localhost, *.localhost, 127.0.0.0/8, [::1]); then credentials would travel unencrypted. Expects a normalized URL (see normalizeServerUrl).
 */
export function isInsecureRemoteUrl(normalizedUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(normalizedUrl);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:') return false;
	const host = url.hostname;
	if (host === 'localhost' || host.endsWith('.localhost')) return false;
	if (/^127\.\d+\.\d+\.\d+$/.test(host)) return false;
	if (host === '[::1]') return false;
	return true;
}

function stripTrailingSlashes(path: string): string {
	return path.replace(/\/+$/, '');
}

/**
 * Checks that the server answers the Collectives OCS API with the given credentials.
 * Input is validated before any request is sent. Resolves with the number of collectives.
 * Retries are disabled: the user waits for this result, so failures are reported at once.
 */
export async function testConnection(creds: ConnectionCredentials, request: RequestFn): Promise<ConnectionResult> {
	const baseUrl = normalizeServerUrl(creds.serverUrl);
	const username = creds.username.trim();
	if (username === '') throw new ConfigError('username', 'missing');
	// The app password is not trimmed: it is used exactly as the user entered it.
	if (creds.appPassword === '') throw new ConfigError('appPassword', 'missing');

	const clients = createApiClients({ baseUrl, username, appPassword: creds.appPassword, request, retry: false });
	const collectives = await clients.collectives.listCollectives();
	return { collectiveCount: collectives.length };
}
