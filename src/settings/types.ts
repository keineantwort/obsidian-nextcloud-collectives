import type { ConflictStrategy } from '../sync/decide';

export interface NcSettings {
	/** Server base URL as entered by the user (normalized on use). */
	serverUrl: string;
	username: string;
	/** ID of the secret in Obsidian's secret storage holding the app password. Never the password itself. */
	appPasswordSecretId: string;
	/** What happens when a page changed both in the vault and on the server (PLAN §7.3). */
	conflictStrategy: ConflictStrategy;
}

export const DEFAULT_SETTINGS: NcSettings = {
	serverUrl: '',
	username: '',
	appPasswordSecretId: '',
	conflictStrategy: 'conflictFile',
};

export const CONFLICT_STRATEGIES = ['conflictFile', 'preferLocal', 'preferRemote'] as const;

/** True for the three strategy values; anything else (e.g. a hand-edited data.json) is rejected. */
export function isConflictStrategy(v: unknown): v is ConflictStrategy {
	return typeof v === 'string' && (CONFLICT_STRATEGIES as readonly string[]).includes(v);
}
