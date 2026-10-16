import { Plugin, getLanguage } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { createTranslator, resolveLocale, type Translator } from './i18n';
import { DEFAULT_SETTINGS, NcSettings } from './settings/types';
import { NcSettingTab } from './settings/settingsTab';
import { CredentialsStore } from './settings/credentialsStore';
import { isRecord } from './util/isRecord';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	t: Translator = createTranslator('en');
	/** Password storage; all reads and writes of the app password go through it. */
	private readonly credentials = new CredentialsStore(
		{
			setSecret: (id, value) => this.app.secretStorage.setSecret(id, value),
			getSecret: (id) => this.app.secretStorage.getSecret(id),
		},
		{
			getSecretId: () => this.settings.appPasswordSecretId,
			setSecretId: async (id) => {
				this.settings.appPasswordSecretId = id;
				await this.saveSettings();
			},
		},
	);

	async onload(): Promise<void> {
		// Obsidian requires a restart after a language change, so the language is resolved once here.
		this.t = createTranslator(resolveLocale(getLanguage()));
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

	/**
	 * Stores the app password in secret storage. Empty input is ignored.
	 * The secret is only written under an ID this plugin generated; any other ID in the settings
	 * (e.g. one chosen earlier in the Obsidian UI or planted in data.json) is replaced by a new one.
	 */
	storeAppPassword(password: string): Promise<void> {
		return this.credentials.store(password);
	}

	/** True if a non-empty app password is stored for the current secret ID. */
	hasStoredAppPassword(): boolean {
		return this.credentials.hasPassword();
	}

	/**
	 * Runs the connection test with the stored settings. Waits for a pending password write first.
	 * The app password is read from secret storage only for this call, and only under an ID this plugin
	 * generated: a foreign ID in data.json is treated as missing, so no foreign secret is ever sent.
	 */
	async testConnection(): Promise<ConnectionResult> {
		const appPassword = await this.credentials.read();
		const { serverUrl, username } = this.settings;
		// `?? ''` is intentional: a missing secret becomes ConfigError('appPassword', 'missing') in testConnection,
		// which is shown to the user. It is not a silent fallback.
		return testConnection({ serverUrl, username, appPassword: appPassword ?? '' }, obsidianRequest);
	}
}
