import type { ConnectionResult } from '../api/connection';
import type { MessageKey, Translator } from '../i18n';
import { ApiChangedError, AuthError, ConfigError, NetworkError, NotFoundError, ServerError } from '../util/errors';

const CONFIG_MESSAGE_KEYS: Partial<Record<string, MessageKey>> = {
	'serverUrl/missing': 'connection.error.serverUrlMissing',
	'serverUrl/invalid': 'connection.error.serverUrlInvalid',
	'username/missing': 'connection.error.usernameMissing',
	'appPassword/missing': 'connection.error.appPasswordMissing',
};

/**
 * Maps an error from testConnection() to a user-facing message in the given language.
 * Never includes the raw message of unknown errors: it may contain credentials.
 */
export function describeConnectionError(err: unknown, t: Translator): string {
	if (err instanceof ConfigError) return describeConfigError(err, t);
	if (err instanceof AuthError) return t('connection.error.auth');
	if (err instanceof NotFoundError) return t('connection.error.notFound');
	if (err instanceof NetworkError) return t('connection.error.network');
	if (err instanceof ServerError) return t('connection.error.server', { status: err.status });
	if (err instanceof ApiChangedError) return t('connection.error.apiChanged');
	return t('connection.error.unknown');
}

function describeConfigError(err: ConfigError, t: Translator): string {
	const key = CONFIG_MESSAGE_KEYS[`${err.field}/${err.problem}`];
	return key ? t(key) : t('connection.error.unknown');
}

export function formatConnectionSuccess(result: ConnectionResult, t: Translator): string {
	const count = result.collectiveCount;
	if (count === 0) return t('connection.success.none');
	return count === 1 ? t('connection.success.one') : t('connection.success.other', { count });
}
