import { Notice, Plugin, getLanguage, normalizePath } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { createTranslator, resolveLocale, type Translator } from './i18n';
import { DEFAULT_SETTINGS, NcSettings } from './settings/types';
import { NcSettingTab } from './settings/settingsTab';
import { CredentialsStore } from './settings/credentialsStore';
import { createObsidianVault } from './sync/obsidianVault';
import { runSync } from './sync/syncRun';
import { StateStore, type StateFile } from './sync/stateStore';
import { showSyncNotice } from './ui/showSyncNotice';
import { confirmInitialSync } from './ui/initialSyncModal';
import { alreadyRunningNotice, describeSyncOutcome, describeSyncError } from './ui/syncNotices';
import { Logger } from './util/logger';
import { isRecord } from './util/isRecord';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	t: Translator = createTranslator('en');
	/** In-memory log of this session; shown by the log view in M10. Never logs credentials. */
	readonly log = new Logger();
	/** Simple in-flight guard; a scheduler with re-run flag comes in M9. */
	private syncRunning = false;
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
		this.addCommand({ id: 'sync-now', name: this.t('command.syncNow'), callback: () => { void this.runSyncFromUi(); } });
		this.addRibbonIcon('refresh-cw', this.t('ribbon.syncNow'), () => { void this.runSyncFromUi(); });
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

	/**
	 * Runs a pull from the UI (command or ribbon) and shows the outcome as notice.
	 * Only one run at a time; a second request shows a notice and does nothing.
	 */
	private async runSyncFromUi(): Promise<void> {
		const t = this.t;
		if (this.syncRunning) {
			showSyncNotice(alreadyRunningNotice(t));
			return;
		}
		this.syncRunning = true;
		let progress: Notice | null = new Notice(t('sync.running'), 0);
		const hideProgress = (): void => {
			progress?.hide();
			progress = null;
		};
		try {
			const outcome = await runSync({
				settings: this.settings,
				readPassword: () => this.credentials.read(),
				request: obsidianRequest,
				vault: createObsidianVault(this.app),
				stateStore: new StateStore(this.stateFile(), this.log),
				t,
				log: this.log,
				confirmInitialSync: async () => {
					hideProgress(); // never show "running" behind the decision dialog
					const merge = await confirmInitialSync(this.app, t);
					if (merge) progress = new Notice(t('sync.running'), 0);
					return merge;
				},
			});
			hideProgress();
			showSyncNotice(describeSyncOutcome(outcome, t));
		} catch (err) {
			hideProgress();
			// Log only the error class, never the message (may contain credentials or URLs with secrets).
			this.log.error('Sync failed', { error: err instanceof Error ? err.name : 'unknown' });
			showSyncNotice(describeSyncError(err, t));
		} finally {
			hideProgress();
			this.syncRunning = false;
		}
	}

	/** Sync state file in the plugin folder. It is not a note, so it goes through the adapter. */
	private stateFile(): StateFile {
		const dir = this.manifest.dir;
		if (dir === undefined) throw new Error('Plugin directory unknown');
		const path = normalizePath(`${dir}/sync-state.json`);
		const adapter = this.app.vault.adapter;
		return {
			read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
			write: (text) => adapter.write(path, text),
		};
	}
}
