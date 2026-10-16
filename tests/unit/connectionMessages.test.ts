import { describe, expect, it } from 'vitest';
import { describeConnectionError, formatConnectionSuccess } from '../../src/settings/connectionMessages';
import { createTranslator } from '../../src/i18n';
import { ApiChangedError, AuthError, ConfigError, NetworkError, NotFoundError, ServerError } from '../../src/util/errors';

const t = createTranslator('de');

describe('describeConnectionError', () => {
	it.each([
		['missing server URL', new ConfigError('serverUrl', 'missing'), 'Bitte die Server-URL angeben.'],
		[
			'invalid server URL',
			new ConfigError('serverUrl', 'invalid'),
			'Die Server-URL ist ungültig. Beispiel: https://cloud.example.com',
		],
		['missing username', new ConfigError('username', 'missing'), 'Bitte den Benutzernamen angeben.'],
		['missing app password', new ConfigError('appPassword', 'missing'), 'Bitte ein App-Passwort hinterlegen.'],
		[
			'rejected credentials (401)',
			new AuthError(401),
			'Anmeldung fehlgeschlagen. Bitte Benutzername und App-Passwort prüfen.',
		],
		[
			'endpoint not found',
			new NotFoundError('x'),
			'Die Collectives-API wurde nicht gefunden. Bitte die Server-URL prüfen und sicherstellen, dass die App Collectives auf dem Server aktiviert ist.',
		],
		[
			'unreachable server',
			new NetworkError('x'),
			'Der Server ist nicht erreichbar. Bitte Server-URL und Netzwerkverbindung prüfen.',
		],
		['server error 503', new ServerError(503), 'Der Server hat mit einem Fehler geantwortet (HTTP 503).'],
		[
			'unexpected response shape',
			new ApiChangedError('x'),
			'Unerwartete Antwort vom Server. Ist die Server-URL korrekt und läuft dort Nextcloud mit der App Collectives?',
		],
		['plain Error', new Error('secret-token-123'), 'Unbekannter Fehler beim Verbindungstest.'],
		['thrown string', 'string', 'Unbekannter Fehler beim Verbindungstest.'],
		['thrown undefined', undefined, 'Unbekannter Fehler beim Verbindungstest.'],
	])('describes %s in German', (_label, err, expected) => {
		const message = describeConnectionError(err, t);

		expect(message).toBe(expected);
	});

	it('reports the actual status code of a ServerError, not a fixed one', () => {
		const message = describeConnectionError(new ServerError(500), t);

		expect(message).toBe('Der Server hat mit einem Fehler geantwortet (HTTP 500).');
	});

	it('does not leak the raw message of an unknown error, which may contain credentials', () => {
		const message = describeConnectionError(new Error('secret-token-123'), t);

		expect(message).not.toContain('secret-token-123');
	});
});

describe('formatConnectionSuccess', () => {
	it.each([
		[0, 'Verbindung erfolgreich. Es wurden noch keine Collectives gefunden.'],
		[1, 'Verbindung erfolgreich: 1 Collective gefunden.'],
		[3, 'Verbindung erfolgreich: 3 Collectives gefunden.'],
	])('formats collectiveCount %i', (collectiveCount, expected) => {
		const message = formatConnectionSuccess({ collectiveCount }, t);

		expect(message).toBe(expected);
	});
});
