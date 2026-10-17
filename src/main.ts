import { MarkdownView, Notice, Platform, Plugin, getLanguage, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';
import { testConnection, type ConnectionResult } from './api/connection';
import { obsidianRequest } from './api/obsidianRequest';
import { createTranslator, resolveLocale, type Translator } from './i18n';
import {
	DEFAULT_SETTINGS, isConflictStrategy, isLocalDeleteBehaviour, isNewFolderBehaviour, isRemoteDeleteBehaviour, isTagsProperty, NcSettings,
} from './settings/types';
import { NcSettingTab } from './settings/settingsTab';
import { CredentialsStore } from './settings/credentialsStore';
import { StateStore, type StateFile } from './sync/stateStore';
import { SyncController } from './syncController';
import { StatusBar } from './ui/statusBar';
import { pickEmoji } from './ui/emojiModal';
import { clearEmoji, decorateExplorer, decorateView, emojiFromFrontmatter } from './ui/emojiTitles';
import { clearProperties, decorateProperties, propertyLabels } from './ui/propertyLabels';
import { Logger } from './util/logger';
import { isRecord } from './util/isRecord';

export default class NextcloudCollectivesPlugin extends Plugin {
	settings: NcSettings = { ...DEFAULT_SETTINGS };
	t: Translator = createTranslator('en');
	/** In-memory log of this session; shown by the log view in M10. Never logs credentials. */
	readonly log = new Logger();
	private statusBar: StatusBar | null = null;
	/** Sync runs, conflicts and the run status (PLAN §7.1); created in onload, after the language is known. */
	private sync: SyncController | null = null;
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
		const sync = new SyncController({
			app: this.app,
			t: this.t,
			log: this.log,
			settings: () => this.settings,
			readPassword: () => this.credentials.read(),
			stateStore: () => this.stateStore(),
			onStatusChange: () => { this.refreshStatusBar(); },
		});
		this.sync = sync;
		this.addSettingTab(new NcSettingTab(this.app, this));
		this.addCommand({ id: 'sync-now', name: this.t('command.syncNow'), callback: () => { void sync.runFromUi(); } });
		this.addCommand({ id: 'show-conflicts', name: this.t('command.showConflicts'), callback: () => { sync.showConflicts(); } });
		this.addCommand({
			id: 'set-emoji',
			name: this.t('command.setEmoji'),
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (file === null) new Notice(this.t('emoji.noNote'));
				else void this.setPageEmoji(file);
			},
		});
		this.addRibbonIcon('refresh-cw', this.t('ribbon.syncNow'), () => { void sync.runFromUi(); });
		// The status bar is desktop only; on mobile the conflicts are reached through the command.
		if (!Platform.isMobile) {
			this.statusBar = new StatusBar(this.addStatusBarItem(), this.t, (action) => {
				if (action === 'openConflicts') sync.showConflicts();
				else void sync.runFromUi();
			});
			this.refreshStatusBar();
		}
		// Vault events during the initial vault load are not user changes, so they are only tracked once the layout is ready.
		this.app.workspace.onLayoutReady(() => {
			this.registerEmojiTitles();
			this.registerEmojiPicker();
			this.registerDirtyTracking(sync);
			void sync.loadInitialState();
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
			const newFolder = data['newFolderBehaviour'];
			if (isNewFolderBehaviour(newFolder)) loaded.newFolderBehaviour = newFolder;
			const localDelete = data['localDeleteBehaviour'];
			if (isLocalDeleteBehaviour(localDelete)) loaded.localDeleteBehaviour = localDelete;
			const remoteDelete = data['remoteDeleteBehaviour'];
			if (isRemoteDeleteBehaviour(remoteDelete)) loaded.remoteDeleteBehaviour = remoteDelete;
			const tagsProperty = data['tagsProperty'];
			if (isTagsProperty(tagsProperty)) loaded.tagsProperty = tagsProperty;
			if (typeof data['showEmojiInTitles'] === 'boolean') loaded.showEmojiInTitles = data['showEmojiInTitles'];
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

	/** Vault events that mark synced files as changed by the user. The plugin's own writes are filtered by suppressingWriter. */
	/** Asks for the emoji of a note and writes it into its properties (`nc_emoji`; a hand-made `Emoji` property is replaced). */
	private async setPageEmoji(file: TFile): Promise<void> {
		const front = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const current = emojiFromFrontmatter(front?.['nc_emoji']);
		const chosen = await pickEmoji(this.app, this.t, current);
		if (chosen === undefined) return;
		await this.app.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
			for (const key of Object.keys(properties)) if (/^emoji$/i.test(key)) delete properties[key];
			if (chosen === null) delete properties['nc_emoji'];
			else properties['nc_emoji'] = chosen;
		});
		new Notice(this.t('emoji.set'));
	}

	/** Opens the picker when the user adds an empty `Emoji` property to the note they are editing. */
	private registerEmojiPicker(): void {
		const hadProperty = new Map<string, boolean>();
		this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
			const front = cache.frontmatter;
			const key = front === undefined ? undefined : Object.keys(front).find((name) => /^emoji$/i.test(name));
			const has = key !== undefined;
			const wasThere = hadProperty.get(file.path) ?? true;
			hadProperty.set(file.path, has);
			const empty = key !== undefined && (front?.[key] === null || front?.[key] === '');
			if (has && empty && !wasThere && this.app.workspace.getActiveFile()?.path === file.path) void this.setPageEmoji(file);
		}));
	}

	/** Page emoji in front of the titles (display only): refreshed when notes, their metadata or the layout change. */
	private registerEmojiTitles(): void {
		let timer: number | null = null;
		const schedule = (): void => {
			if (timer !== null) return;
			timer = window.setTimeout(() => {
				timer = null;
				this.refreshEmojiTitles();
			}, 100);
		};
		let observers: MutationObserver[] = [];
		const watchExplorers = (): void => {
			for (const observer of observers) observer.disconnect();
			// File explorers (renamed or scrolled items) and note views (the properties are drawn after the note opens).
			const containers = [
				...this.app.workspace.getLeavesOfType('file-explorer'),
				...this.app.workspace.getLeavesOfType('markdown'),
			].map((leaf) => leaf.view.containerEl);
			observers = containers.map((container) => {
				const observer = new MutationObserver(schedule);
				observer.observe(container, { childList: true, subtree: true });
				return observer;
			});
			schedule();
		};
		const { workspace, metadataCache, vault } = this.app;
		this.registerEvent(workspace.on('layout-change', watchExplorers));
		this.registerEvent(workspace.on('active-leaf-change', schedule));
		this.registerEvent(workspace.on('file-open', schedule));
		this.registerEvent(metadataCache.on('changed', schedule));
		this.registerEvent(vault.on('rename', schedule));
		this.register(() => {
			for (const observer of observers) observer.disconnect();
			if (timer !== null) window.clearTimeout(timer);
			clearEmoji(activeDocument.body);
			clearProperties(activeDocument.body);
		});
		watchExplorers();
	}

	/** Sets or removes the emoji marks (setting showEmojiInTitles) and shows the readable property names in the note views. */
	refreshEmojiTitles(): void {
		const { workspace, vault, metadataCache } = this.app;
		const show = this.settings.showEmojiInTitles;
		const emojiOf = (path: string): string | null => {
			if (!show) return null;
			const file = vault.getFileByPath(path);
			return emojiFromFrontmatter(file === null ? undefined : metadataCache.getFileCache(file)?.frontmatter?.['nc_emoji']);
		};
		for (const leaf of workspace.getLeavesOfType('file-explorer')) decorateExplorer(leaf.view.containerEl, emojiOf);
		const labels = propertyLabels(this.t);
		workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			decorateView(leaf.view.containerEl, emojiOf(leaf.view.file?.path ?? ''));
			decorateProperties(leaf.view.containerEl, labels);
		});
	}

	private registerDirtyTracking(sync: SyncController): void {
		const { vault } = this.app;
		const queue = sync.dirtyQueue;
		this.registerEvent(vault.on('modify', (file) => queue.noteModified(file.path)));
		this.registerEvent(vault.on('rename', (file, oldPath) => queue.noteRenamed(oldPath, file.path)));
		this.registerEvent(vault.on('delete', (file) => queue.noteDeleted(file.path)));
	}

	private refreshStatusBar(): void {
		if (this.sync !== null) this.statusBar?.update(this.sync.status());
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
