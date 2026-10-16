export interface NcSettings {
	/** Server base URL as entered by the user (normalized on use). */
	serverUrl: string;
	username: string;
	/** ID of the secret in Obsidian's secret storage holding the app password. Never the password itself. */
	appPasswordSecretId: string;
}
export const DEFAULT_SETTINGS: NcSettings = { serverUrl: '', username: '', appPasswordSecretId: '' };
