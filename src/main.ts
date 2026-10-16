import { Plugin } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { DEFAULT_SETTINGS, NcSettings } from './settings/types';
import { NcSettingTab } from './settings/settingsTab';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new NcSettingTab(this.app, this));
	}

	/**
	 * Only known keys with the expected types are taken over from data.json; anything else is ignored.
	 * The app password itself is never stored there, only the secret ID.
	 */
	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as unknown;
		const loaded: Partial<NcSettings> = {};
		if (isRecord(data)) {
			if (typeof data['serverUrl'] === 'string') loaded.serverUrl = data['serverUrl'];
			if (typeof data['username'] === 'string') loaded.username = data['username'];
			if (typeof data['appPasswordSecretId'] === 'string') loaded.appPasswordSecretId = data['appPasswordSecretId'];
		}
		this.settings = { ...DEFAULT_SETTINGS, ...loaded };
	}

	async saveSettings(): Promise<void> { await this.saveData(this.settings); }

	/** Runs the connection test with the stored settings. The app password is read from secret storage only for this call. */
	async testConnection(): Promise<ConnectionResult> {
		const { serverUrl, username, appPasswordSecretId } = this.settings;
		const appPassword = appPasswordSecretId ? this.app.secretStorage.getSecret(appPasswordSecretId) : null;
		// `?? ''` is intentional: a missing secret becomes ConfigError('appPassword', 'missing') in testConnection,
		// which is shown to the user. It is not a silent fallback.
		return testConnection({ serverUrl, username, appPassword: appPassword ?? '' }, obsidianRequest);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
