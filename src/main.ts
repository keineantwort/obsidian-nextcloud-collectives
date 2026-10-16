import { Plugin, getLanguage } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { createTranslator, resolveLocale, type Translator } from './i18n';
import { DEFAULT_SETTINGS, NcSettings } from './settings/types';
import { NcSettingTab } from './settings/settingsTab';
import { buildSecretId, isValidSecretId } from './settings/secretId';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	t: Translator = createTranslator('en');

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
	 * Stores the app password in secret storage. Creates the secret ID on first use (random, 8 bytes)
	 * and persists it in the settings. Existing IDs (e.g. chosen earlier in the Obsidian UI) are reused.
	 * Empty input is ignored.
	 */
	async storeAppPassword(password: string): Promise<void> {
		if (password === '') return;
		if (!isValidSecretId(this.settings.appPasswordSecretId)) {
			this.settings.appPasswordSecretId = buildSecretId(crypto.getRandomValues(new Uint8Array(8)));
			// Persist the ID before the secret is written, so the secret is never stored under an unknown ID.
			await this.saveSettings();
		}
		this.app.secretStorage.setSecret(this.settings.appPasswordSecretId, password);
	}

	/** True if a non-empty app password is stored for the current secret ID. */
	hasStoredAppPassword(): boolean {
		const id = this.settings.appPasswordSecretId;
		if (!isValidSecretId(id)) return false;
		const stored = this.app.secretStorage.getSecret(id);
		return stored !== null && stored !== '';
	}

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
