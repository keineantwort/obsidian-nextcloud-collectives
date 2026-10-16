import { Notice, Platform, Plugin, getLanguage, normalizePath } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { createTranslator, resolveLocale, type Translator } from './i18n';
import { toRemote } from './mapping/frontmatter';
import { DEFAULT_SETTINGS, isConflictStrategy, NcSettings } from './settings/types';
import { NcSettingTab } from './settings/settingsTab';
import { CredentialsStore } from './settings/credentialsStore';
import { applyResolution, countConflicts, listConflicts, withCurrentPaths } from './sync/conflicts';
import type { ConflictChoice, ConflictEntry, ResolutionVault } from './sync/conflicts';
import { DirtyQueue, suppressingWriter } from './sync/dirtyQueue';
import { createObsidianVault } from './sync/obsidianVault';
import type { SyncState } from './sync/state';
import { runSync } from './sync/syncRun';
import type { SyncRunOutcome } from './sync/syncRun';
import { StateStore, type StateFile } from './sync/stateStore';
import { openConflictModal } from './ui/conflictModal';
import type { ConflictModalSource } from './ui/conflictModal';
import { StatusBar } from './ui/statusBar';
import type { LastRun } from './ui/statusBar';
import { showSyncNotice } from './ui/showSyncNotice';
import { confirmInitialSync } from './ui/initialSyncModal';
import { alreadyRunningNotice, describeSyncOutcome, describeSyncError } from './ui/syncNotices';
import { Logger } from './util/logger';
import { isRecord } from './util/isRecord';

/** Runs async tasks one after another: a task starts only after the tasks queued before it have finished. */
class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task);
		// The queue itself never rejects; the caller gets the error through `result`.
		this.tail = result.catch(() => undefined);
		return result;
	}
}

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	t: Translator = createTranslator('en');
	/** In-memory log of this session; shown by the log view in M10. Never logs credentials. */
	readonly log = new Logger();
	/** Sync runs and conflict resolutions take turns here, so a resolution never changes the state during a run. */
	private readonly lock = new SerialQueue();
	/** Vault changes by the user since the last sync run; the input for pushing local changes (PLAN §7.2). */
	private readonly dirtyQueue = new DirtyQueue();
	/** True from a command or ribbon sync request until its run has finished; a second request shows a notice. */
	private syncRequested = false;
	/** True while a sync run is in progress. */
	private running = false;
	private lastRun: LastRun = null;
	/** Pages with an open conflict (PLAN §4); the status bar shows this number. */
	private openConflicts = 0;
	/** State as last loaded or written; the conflict list is built from it. */
	private lastState: SyncState | null = null;
	private statusBar: StatusBar | null = null;
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
		this.addCommand({ id: 'show-conflicts', name: this.t('command.showConflicts'), callback: () => { this.showConflicts(); } });
		this.addRibbonIcon('refresh-cw', this.t('ribbon.syncNow'), () => { void this.runSyncFromUi(); });
		// The status bar is desktop only; on mobile the conflicts are reached through the command.
		if (!Platform.isMobile) {
			this.statusBar = new StatusBar(this.addStatusBarItem(), this.t, (action) => {
				if (action === 'openConflicts') this.showConflicts();
				else void this.runSyncFromUi();
			});
			this.refreshStatusBar();
		}
		// Vault events during the initial vault load are not user changes, so they are only tracked once the layout is ready.
		this.app.workspace.onLayoutReady(() => {
			this.registerDirtyTracking();
			void this.loadInitialState();
		});
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
			const strategy = data['conflictStrategy'];
			if (isConflictStrategy(strategy)) loaded.conflictStrategy = strategy;
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
	 * Runs a sync from the UI (command or ribbon) and shows the outcome as notice.
	 * A request while another one is queued or running shows a notice and does nothing.
	 */
	private runSyncFromUi(): Promise<void> {
		if (this.syncRequested) {
			showSyncNotice(alreadyRunningNotice(this.t));
			return Promise.resolve();
		}
		this.syncRequested = true;
		return this.lock.run(() => this.runSyncOnce()).finally(() => { this.syncRequested = false; });
	}

	/** One sync run, called under the lock: shows progress and the outcome, and keeps the status bar and state current. */
	private async runSyncOnce(): Promise<void> {
		const t = this.t;
		this.running = true;
		this.refreshStatusBar();
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
				vault: suppressingWriter(createObsidianVault(this.app), this.dirtyQueue),
				dirty: () => this.dirtyQueue.drain(),
				stateStore: this.stateStore(),
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
			this.recordOutcome(outcome);
			showSyncNotice(describeSyncOutcome(outcome, t));
		} catch (err) {
			hideProgress();
			this.lastRun = { kind: 'failed', at: Date.now() };
			// Log only the error class, never the message (may contain credentials or URLs with secrets).
			this.log.error('Sync failed', { error: err instanceof Error ? err.name : 'unknown' });
			showSyncNotice(describeSyncError(err, t));
		} finally {
			hideProgress();
			this.running = false;
			await this.refreshState();
			this.refreshStatusBar();
		}
	}

	/** Last run after a run. A cancelled run changes nothing (PLAN §2.1). The conflict count comes from the state. */
	private recordOutcome(outcome: SyncRunOutcome): void {
		if (outcome.kind === 'cancelled') return;
		if (outcome.kind === 'done') {
			this.lastRun = { kind: 'success', at: Date.now() };
			return;
		}
		this.lastRun = { kind: 'failed', at: Date.now() };
	}

	/** Vault events that mark synced files as changed by the user. The plugin's own writes are filtered by suppressingWriter. */
	private registerDirtyTracking(): void {
		const { vault } = this.app;
		const queue = this.dirtyQueue;
		this.registerEvent(vault.on('modify', (file) => queue.noteModified(file.path)));
		this.registerEvent(vault.on('rename', (file, oldPath) => queue.noteRenamed(oldPath, file.path)));
		this.registerEvent(vault.on('delete', (file) => queue.noteDeleted(file.path)));
	}

	/** Reads the saved state once, so the status bar shows the open conflicts from the start. Errors are ignored. */
	private async loadInitialState(): Promise<void> {
		await this.lock.run(() => this.refreshState());
		this.refreshStatusBar();
	}

	/** Reloads lastState. A failed read keeps the previous value; the next run or resolution loads the state again. */
	private async refreshState(): Promise<void> {
		try {
			this.setLastState(await this.stateStore().load());
		} catch {
			// Nothing to show from a failed read; the state is loaded again on the next run or resolution.
		}
	}

	/** The only place that assigns lastState: the open conflict count is always derived from it. */
	private setLastState(state: SyncState | null): void {
		this.lastState = state;
		this.openConflicts = state === null ? 0 : countConflicts(state);
	}

	private refreshStatusBar(): void {
		this.statusBar?.update({ running: this.running, lastRun: this.lastRun, openConflicts: this.openConflicts });
	}

	/** Opens the conflict list, or tells the user that there is none. */
	showConflicts(): void {
		if (this.conflictEntries().length === 0) {
			showSyncNotice({ lines: [this.t('conflicts.none')], level: 'info' });
			return;
		}
		openConflictModal(this.app, this.t, this.conflictSource());
	}

	/** Open conflicts with the current local paths: a page renamed by the user keeps its nc_page_id under the new name. */
	private conflictEntries(): ConflictEntry[] {
		if (this.lastState === null) return [];
		const vault = createObsidianVault(this.app);
		const files = vault.listFiles().map((file) => ({ path: file.path, pageId: vault.cachedPageId(file.path) ?? null }));
		return withCurrentPaths(listConflicts(this.lastState), files);
	}

	private conflictSource(): ConflictModalSource {
		return {
			entries: () => this.conflictEntries(),
			loadTexts: (entry) => this.loadConflictTexts(entry),
			resolve: (entry, choice) => this.resolveConflict(entry, choice),
		};
	}

	/**
	 * Local and remote text in canonical remote format. The local text is null if the local file is not in the vault,
	 * the remote is null if the conflict copy is not in the vault.
	 */
	private async loadConflictTexts(entry: ConflictEntry): Promise<{ local: string | null; remote: string | null }> {
		const vault = createObsidianVault(this.app);
		const local = vault.exists(entry.localPath) ? toRemote(await vault.read(entry.localPath)) : null;
		const copy = entry.conflictPath;
		if (copy === null || !vault.exists(copy)) return { local, remote: null };
		return { local, remote: toRemote(await vault.read(copy)) };
	}

	/**
	 * Applies a conflict choice, then runs a sync. The change waits for a running sync (lock).
	 * Resolves true if the choice was applied, false if the entry was no longer open; rejects only if applying failed.
	 */
	private async resolveConflict(entry: ConflictEntry, choice: ConflictChoice): Promise<boolean> {
		const applied = await this.lock.run(() => this.applyChoice(entry, choice));
		if (applied) await this.runSyncFromUi();
		return applied;
	}

	/** Under the lock: loads the state, applies the choice, saves the state and updates the conflict count. */
	private async applyChoice(entry: ConflictEntry, choice: ConflictChoice): Promise<boolean> {
		const store = this.stateStore();
		const state = await store.load();
		if (state === null) return false;
		const applied = await applyResolution({ vault: this.resolutionVault(), state, log: this.log }, entry.pageId, choice, {
			localPath: entry.localPath,
			expectedConflictPath: entry.conflictPath,
		});
		if (!applied) return false;
		await store.save(state);
		this.setLastState(state);
		this.refreshStatusBar();
		return true;
	}

	/** Vault access for a conflict choice: notes through the vault API, the trash through the file manager. */
	private resolutionVault(): ResolutionVault {
		const vault = createObsidianVault(this.app);
		return {
			read: (path) => vault.read(path),
			process: (path, fn) => vault.process(path, fn),
			exists: (path) => vault.exists(path),
			trash: async (path) => {
				const file = this.app.vault.getFileByPath(path);
				if (file !== null) await this.app.fileManager.trashFile(file);
			},
		};
	}

	private stateStore(): StateStore {
		return new StateStore(this.stateFile(), this.log);
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
