import type { ConnectionResult } from '../api/connection';
import { ApiChangedError, AuthError, ConfigError, NetworkError, NotFoundError, ServerError } from '../util/errors';

const UNKNOWN_ERROR_MESSAGE = 'Unbekannter Fehler beim Verbindungstest.';

/**
 * Maps an error from testConnection() to a German, user-facing message.
 * Never includes the raw message of unknown errors: it may contain credentials.
 */
export function describeConnectionError(err: unknown): string {
	if (err instanceof ConfigError) return describeConfigError(err);
	if (err instanceof AuthError) return 'Anmeldung fehlgeschlagen. Bitte Benutzername und App-Passwort prüfen.';
	if (err instanceof NotFoundError) {
		return 'Die Collectives-API wurde nicht gefunden. Bitte die Server-URL prüfen und sicherstellen, dass die App Collectives auf dem Server aktiviert ist.';
	}
	if (err instanceof NetworkError) return 'Der Server ist nicht erreichbar. Bitte Server-URL und Netzwerkverbindung prüfen.';
	if (err instanceof ServerError) return `Der Server hat mit einem Fehler geantwortet (HTTP ${err.status}).`;
	if (err instanceof ApiChangedError) {
		return 'Unerwartete Antwort vom Server. Ist die Server-URL korrekt und läuft dort Nextcloud mit der App Collectives?';
	}
	return UNKNOWN_ERROR_MESSAGE;
}

function describeConfigError(err: ConfigError): string {
	if (err.field === 'serverUrl' && err.problem === 'missing') return 'Bitte die Server-URL angeben.';
	if (err.field === 'serverUrl' && err.problem === 'invalid') {
		return 'Die Server-URL ist ungültig. Beispiel: https://cloud.example.com';
	}
	if (err.field === 'username' && err.problem === 'missing') return 'Bitte den Benutzernamen angeben.';
	if (err.field === 'appPassword' && err.problem === 'missing') return 'Bitte ein App-Passwort hinterlegen.';
	return UNKNOWN_ERROR_MESSAGE;
}

export function formatConnectionSuccess(result: ConnectionResult): string {
	const count = result.collectiveCount;
	if (count === 0) return 'Verbindung erfolgreich. Es wurden noch keine Collectives gefunden.';
	return count === 1
		? 'Verbindung erfolgreich: 1 Collective gefunden.'
		: `Verbindung erfolgreich: ${count} Collectives gefunden.`;
}
