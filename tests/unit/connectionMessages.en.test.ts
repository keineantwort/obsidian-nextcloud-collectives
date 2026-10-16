import { describe, expect, it } from 'vitest';
import { describeConnectionError, formatConnectionSuccess } from '../../src/settings/connectionMessages';
import { createTranslator } from '../../src/i18n';
import { ApiChangedError, AuthError, ConfigError, ForbiddenError, NetworkError, NotFoundError, ServerError } from '../../src/util/errors';

const t = createTranslator('en');

describe('describeConnectionError in English', () => {
	it.each([
		['missing server URL', new ConfigError('serverUrl', 'missing'), 'Please enter the server URL.'],
		[
			'invalid server URL',
			new ConfigError('serverUrl', 'invalid'),
			'The server URL is invalid. Example: https://cloud.example.com',
		],
		['missing username', new ConfigError('username', 'missing'), 'Please enter the username.'],
		['missing app password', new ConfigError('appPassword', 'missing'), 'Please enter an app password.'],
		[
			'rejected credentials (401)',
			new AuthError(401),
			'Login failed. Please check username and app password.',
		],
		[
			'access denied (403)',
			new ForbiddenError(),
			'Access denied (HTTP 403). Please check that the Collectives app is enabled for your account.',
		],
		[
			'endpoint not found',
			new NotFoundError('x'),
			'The Collectives API was not found. Please check the server URL and make sure the Collectives app is enabled on the server.',
		],
		[
			'unreachable server',
			new NetworkError('x'),
			'The server cannot be reached. Please check the server URL and your network connection.',
		],
		[
			'unexpected response shape',
			new ApiChangedError('x'),
			'Unexpected response from the server. Is the server URL correct and does it run Nextcloud with the Collectives app?',
		],
		['plain Error', new Error('secret-token-123'), 'Unknown error during the connection test.'],
		['thrown string', 'string', 'Unknown error during the connection test.'],
		['thrown undefined', undefined, 'Unknown error during the connection test.'],
	])('describes %s in English', (_label, err, expected) => {
		const message = describeConnectionError(err, t);

		expect(message).toBe(expected);
	});

	it('gives 403 (access denied) a different text than 401 (rejected credentials)', () => {
		const forbidden = describeConnectionError(new ForbiddenError(), t);
		const auth = describeConnectionError(new AuthError(401), t);

		expect(forbidden).not.toBe(auth);
	});

	it('reports the HTTP status of a ServerError in the English text', () => {
		const message = describeConnectionError(new ServerError(502), t);

		expect(message).toBe('The server responded with an error (HTTP 502).');
	});

	it('does not leak the raw message of an unknown error, which may contain credentials', () => {
		const message = describeConnectionError(new Error('secret-token-123'), t);

		expect(message).not.toContain('secret-token-123');
	});

	it('falls back to the unknown-error text for an unmapped config problem', () => {
		const message = describeConnectionError(new ConfigError('appPassword', 'invalid'), t);

		expect(message).toBe('Unknown error during the connection test.');
	});
});

describe('formatConnectionSuccess in English', () => {
	it.each([
		[0, 'Connection successful. No collectives found yet.'],
		[1, 'Connection successful: 1 collective found.'],
		[3, 'Connection successful: 3 collectives found.'],
	])('describes %i collectives', (collectiveCount, expected) => {
		const message = formatConnectionSuccess({ collectiveCount }, t);

		expect(message).toBe(expected);
	});
});
