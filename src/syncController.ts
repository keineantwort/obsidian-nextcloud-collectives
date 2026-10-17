// Orchestrates sync runs and conflict resolutions in the plugin: lock, dirty queue, run status, last state (PLAN §7.1, §8).
// Obsidian-facing: shows notices and dialogs. The sync itself lives in src/sync/.
import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import { obsidianRequest } from './api/obsidianRequest';
import type { Translator } from './i18n';
import { toRemote } from './mapping/frontmatter';
import type { PageId } from './api/types';
import type { LinkContext, LinkIndex } from './mapping/links';
import type { NcSettings } from './settings/types';
import { applyResolution, countConflicts, listConflicts, withCurrentPaths } from './sync/conflicts';
import type { ConflictChoice, ConflictEntry, ResolutionVault } from './sync/conflicts';
import { DirtyQueue, suppressingWriter } from './sync/dirtyQueue';
import { createObsidianVault } from './sync/obsidianVault';
import type { SyncState } from './sync/state';
import type { StateStore } from './sync/stateStore';
import { runSync } from './sync/syncRun';
import type { SyncRunOutcome } from './sync/syncRun';
import { openConflictModal } from './ui/conflictModal';
import type { ConflictModalSource } from './ui/conflictModal';
import { confirmProposals } from './ui/confirmModal';
import { confirmInitialSync } from './ui/initialSyncModal';
import { showSyncNotice } from './ui/showSyncNotice';
import type { LastRun } from './ui/statusBar';
import { alreadyRunningNotice, describeSyncError, describeSyncOutcome } from './ui/syncNotices';
import type { Logger } from './util/logger';

/** What the controller needs from the plugin. */
export interface ControllerHost {
	app: App;
	t: Translator;
	log: Logger;
	settings(): NcSettings;
	readPassword(): Promise<string | null>;
	stateStore(): StateStore;
	/** The run status or the open conflicts changed. */
	onStatusChange(): void;
}

/** Status the status bar shows. */
export interface SyncStatus {
	running: boolean;
	lastRun: LastRun;
	openConflicts: number;
}

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

export class SyncController {
	/** Sync runs and conflict resolutions take turns here, so a resolution never changes the state during a run. */
	private readonly lock = new SerialQueue();
	/** Vault changes by the user since the last sync run; the input for pushing local changes (PLAN §7.2). */
	readonly dirtyQueue = new DirtyQueue();
	/** True from a command or ribbon sync request until its run has finished; a second request shows a notice. */
	private syncRequested = false;
	private running = false;
	private lastRun: LastRun = null;
	/** Pages with an open conflict (PLAN §4); the status bar shows this number. */
	private openConflicts = 0;
	/** State as last loaded or written; the conflict list is built from it. */
	private lastState: SyncState | null = null;
	/** Page index of the last sync pass: conflict texts and hashes convert links like the sync (PLAN §9). */
	private lastLinks: LinkIndex | null = null;

	constructor(private readonly host: ControllerHost) {}

	status(): SyncStatus {
		return { running: this.running, lastRun: this.lastRun, openConflicts: this.openConflicts };
	}

	/**
	 * Runs a sync from the UI (command or ribbon) and shows the outcome as notice.
	 * A request while another one is queued or running shows a notice and does nothing.
	 */
	runFromUi(): Promise<void> {
		if (this.syncRequested) {
			showSyncNotice(alreadyRunningNotice(this.host.t));
			return Promise.resolve();
		}
		this.syncRequested = true;
		return this.lock.run(() => this.runOnce()).finally(() => { this.syncRequested = false; });
	}

	/** Reads the saved state once, so the status bar shows the open conflicts from the start. Errors are ignored. */
	async loadInitialState(): Promise<void> {
		await this.lock.run(() => this.refreshState());
		this.host.onStatusChange();
	}

	/** One sync run, called under the lock: shows progress and the outcome, and keeps the status and state current. */
	private async runOnce(): Promise<void> {
		const { app, t, log } = this.host;
		this.running = true;
		this.host.onStatusChange();
		let progress: Notice | null = new Notice(t('sync.running'), 0);
		const hideProgress = (): void => {
			progress?.hide();
			progress = null;
		};
		/** Shows a dialog: the "running" notice must not stay behind it. */
		const ask = async <T>(dialog: () => Promise<T>): Promise<T> => {
			hideProgress();
			const answer = await dialog();
			progress = new Notice(t('sync.running'), 0);
			return answer;
		};
		try {
			const outcome = await runSync({
				settings: this.host.settings(),
				readPassword: () => this.host.readPassword(),
				request: obsidianRequest,
				vault: suppressingWriter(createObsidianVault(app), this.dirtyQueue),
				dirty: () => this.dirtyQueue.drain(),
				stateStore: this.host.stateStore(),
				t,
				log,
				onLinks: (links) => {
					this.lastLinks = links;
				},
				confirmInitialSync: () => ask(() => confirmInitialSync(app, t)),
				confirm: (proposals) => ask(() => confirmProposals(app, t, proposals)),
			});
			hideProgress();
			this.recordOutcome(outcome);
			showSyncNotice(describeSyncOutcome(outcome, t));
		} catch (err) {
			hideProgress();
			this.lastRun = { kind: 'failed', at: Date.now() };
			// Log only the error class, never the message (may contain credentials or URLs with secrets).
			log.error('Sync failed', { error: err instanceof Error ? err.name : 'unknown' });
			showSyncNotice(describeSyncError(err, t));
		} finally {
			hideProgress();
			this.running = false;
			await this.refreshState();
			this.host.onStatusChange();
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

	/** Reloads lastState. A failed read keeps the previous value; the next run or resolution loads the state again. */
	private async refreshState(): Promise<void> {
		try {
			this.setLastState(await this.host.stateStore().load());
		} catch {
			// Nothing to show from a failed read; the state is loaded again on the next run or resolution.
		}
	}

	/** The only place that assigns lastState: the open conflict count is always derived from it. */
	private setLastState(state: SyncState | null): void {
		this.lastState = state;
		this.openConflicts = state === null ? 0 : countConflicts(state);
	}

	/** Opens the conflict list, or tells the user that there is none. */
	showConflicts(): void {
		if (this.conflictEntries().length === 0) {
			showSyncNotice({ lines: [this.host.t('conflicts.none')], level: 'info' });
			return;
		}
		openConflictModal(this.host.app, this.host.t, this.conflictSource());
	}

	/** Open conflicts with the current local paths: a page renamed by the user keeps its nc_page_id under the new name. */
	private conflictEntries(): ConflictEntry[] {
		if (this.lastState === null) return [];
		const vault = createObsidianVault(this.host.app);
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
		const vault = createObsidianVault(this.host.app);
		const links = this.linkContext(entry.pageId);
		const local = vault.exists(entry.localPath) ? toRemote(await vault.read(entry.localPath), links) : null;
		const copy = entry.conflictPath;
		if (copy === null || !vault.exists(copy)) return { local, remote: null };
		return { local, remote: toRemote(await vault.read(copy), links) };
	}

	/**
	 * Applies a conflict choice, then runs a sync. The change waits for a running sync (lock).
	 * Resolves true if the choice was applied, false if the entry was no longer open; rejects only if applying failed.
	 */
	private async resolveConflict(entry: ConflictEntry, choice: ConflictChoice): Promise<boolean> {
		const applied = await this.lock.run(() => this.applyChoice(entry, choice));
		if (applied) await this.runFromUi();
		return applied;
	}

	/** Under the lock: loads the state, applies the choice, saves the state and updates the conflict count. */
	private async applyChoice(entry: ConflictEntry, choice: ConflictChoice): Promise<boolean> {
		const store = this.host.stateStore();
		const state = await store.load();
		if (state === null) return false;
		const applied = await applyResolution({ vault: this.resolutionVault(), state, log: this.host.log, links: this.lastLinks ?? undefined }, entry.pageId, choice, {
			localPath: entry.localPath,
			expectedConflictPath: entry.conflictPath,
		});
		if (!applied) return false;
		await store.save(state);
		this.setLastState(state);
		this.host.onStatusChange();
		return true;
	}

	private linkContext(pageId: PageId): LinkContext | undefined {
		return this.lastLinks === null ? undefined : { index: this.lastLinks, sourceId: pageId };
	}

	/** Vault access for a conflict choice: notes through the vault API, the trash through the file manager. */
	private resolutionVault(): ResolutionVault {
		const { app } = this.host;
		const vault = createObsidianVault(app);
		return {
			read: (path) => vault.read(path),
			process: (path, fn) => vault.process(path, fn),
			exists: (path) => vault.exists(path),
			trash: async (path) => {
				const file = app.vault.getFileByPath(path);
				if (file !== null) await app.fileManager.trashFile(file);
			},
		};
	}
}
