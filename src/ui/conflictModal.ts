// Conflict list: per page a short reason, the diff and the three actions (PLAN §9). Consequences are tooltips and descriptions.
// The only UI file for conflicts that imports 'obsidian'; all texts come from the translator, all DOM is built with createEl.
import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from '../i18n';
import type { ConflictChoice, ConflictEntry } from '../sync/conflicts';
import { lineDiff } from '../util/diff';
import type { DiffLine } from '../util/diff';
import { describeConflict, diffRows, entryKey, hasChanges, nextFocusIndex, remoteUnavailableMessage, resolutionAnnouncement } from './conflictView';

/** What the modal needs from the plugin; main.ts keeps the list of open conflicts and runs the resolutions. */
export interface ConflictModalSource {
	/** Current open conflicts; called on open and after every resolution. */
	entries(): ConflictEntry[];
	/**
	 * Local and remote text of the page, both in canonical remote format. local is null if the local file is not in the
	 * vault (e.g. renamed); remote is null if there is no readable copy.
	 */
	loadTexts(entry: ConflictEntry): Promise<{ local: string | null; remote: string | null }>;
	/** true = applied; false = entry no longer open; rejects = could not apply. */
	resolve(entry: ConflictEntry, choice: ConflictChoice): Promise<boolean>;
}

type DiffState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'localMissing' } | { kind: 'ready'; lines: DiffLine[] | null; remoteMissing: boolean };

/** Elements of one entry that the modal updates after loading or resolving. */
interface EntryView {
	details: HTMLDetailsElement;
	diff: HTMLElement;
}

const TITLE_ID = 'nc-conflicts-title';
const DESC_ID = 'nc-conflicts-desc';
const MARKER: Record<DiffLine['kind'], string> = { same: ' ', removed: '−', added: '+' };

export function openConflictModal(app: App, t: Translator, source: ConflictModalSource): void {
	new ConflictModal(app, t, source).open();
}

class ConflictModal extends Modal {
	private closed = false;
	private busy = false;
	private entries: ConflictEntry[] = [];
	private readonly diffCache = new Map<string, DiffState>();
	private readonly views = new Map<string, EntryView>();
	/** Per rendered entry, in list order; rebuilt on every render. */
	private actions: { keepLocal: ButtonComponent; takeRemote: ButtonComponent; later: ButtonComponent }[] = [];
	private headings: HTMLElement[] = [];
	private listEl: HTMLElement | null = null;
	private statusEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private readonly idPrefix = 'nc-conflict-' + Date.now().toString(36);

	constructor(app: App, private readonly t: Translator, private readonly source: ConflictModalSource) {
		super(app);
	}

	onOpen(): void {
		const { t, contentEl, modalEl, titleEl } = this;
		this.setTitle(t('conflicts.title'));
		modalEl.addClass('nc-conflict-modal');

		// Dialog semantics: only set what Obsidian does not already provide.
		titleEl.id = TITLE_ID;
		if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
		modalEl.setAttribute('aria-modal', 'true');
		modalEl.setAttribute('aria-labelledby', TITLE_ID);
		modalEl.setAttribute('aria-describedby', DESC_ID);

		contentEl.createEl('p', { cls: 'nc-conflicts-intro', text: t('conflicts.intro'), attr: { id: DESC_ID } });
		this.statusEl = contentEl.createDiv({ cls: 'nc-conflicts-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.bodyEl = contentEl.createDiv({ cls: 'nc-conflicts-body' });

		this.entries = this.source.entries();
		this.render();
		this.actions[0]?.later.buttonEl.focus();
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
	}

	/** Rebuilds the list (or the done view when nothing is open). */
	private render(): void {
		this.bodyEl.empty();
		this.actions = [];
		this.headings = [];
		this.views.clear();
		this.listEl = null;
		if (this.entries.length === 0) {
			this.renderDone();
			return;
		}
		const list = this.bodyEl.createEl('ul', { cls: 'nc-conflicts-list' });
		this.listEl = list;
		this.entries.forEach((entry, index) => this.renderEntry(list, entry, index));
		// The first entry is open and loaded right away, so its diff is visible without a click.
		const first = this.entries[0];
		if (first !== undefined) this.ensureDiff(first);
	}

	private renderEntry(list: HTMLElement, entry: ConflictEntry, index: number): void {
		const { t } = this;
		const p = this.idPrefix;
		const key = entryKey(entry);
		const description = describeConflict(entry, t);

		const item = list.createEl('li', { cls: 'nc-conflict' });
		const heading = item.createEl('h3', {
			cls: 'nc-conflict-name',
			text: description.name,
			attr: { id: `${p}-${index}-name`, tabindex: '-1' },
		});
		this.headings[index] = heading;
		item.createDiv({ cls: 'nc-conflict-path', text: description.path });
		if (description.explanation !== null) item.createEl('p', { cls: 'nc-conflict-explanation', text: description.explanation });

		const details = item.createEl('details', { cls: 'nc-conflict-details' });
		details.open = index === 0;
		details.createEl('summary', { text: t('conflicts.diff.summary') });
		const diff = details.createDiv({ cls: 'nc-diff-body' });
		details.addEventListener('toggle', () => {
			if (details.open) this.ensureDiff(entry);
		});
		this.views.set(key, { details, diff });

		const buttons = item.createDiv({ cls: 'nc-conflict-actions' });
		const keepLocalId = `${p}-${index}-keep`;
		const takeRemoteId = `${p}-${index}-remote`;
		const laterId = `${p}-${index}-later`;
		const keepLocal = this.createAction(buttons, t('conflicts.keepLocal'), description.keepLocalHint, keepLocalId,
			() => { void this.choose(index, 'keepLocal'); });
		const takeRemote = this.createAction(buttons, t('conflicts.takeRemote'), description.takeRemoteHint, takeRemoteId,
			() => { void this.choose(index, 'takeRemote'); });
		const later = this.createAction(buttons, t('conflicts.later'), description.laterHint, laterId,
			() => { this.later(index); });
		// Hidden copies of the hints, referenced by aria-describedby.
		item.createSpan({ cls: 'nc-visually-hidden', text: description.keepLocalHint, attr: { id: keepLocalId } });
		item.createSpan({ cls: 'nc-visually-hidden', text: description.takeRemoteHint, attr: { id: takeRemoteId } });
		item.createSpan({ cls: 'nc-visually-hidden', text: description.laterHint, attr: { id: laterId } });
		this.actions[index] = { keepLocal, takeRemote, later };
	}

	/** One action button; its consequence is the tooltip and, through aria-describedby, the accessible description. */
	private createAction(buttons: HTMLElement, label: string, hint: string, hintId: string, onClick: () => void): ButtonComponent {
		const button = new ButtonComponent(buttons)
			.setButtonText(label)
			.setDisabled(this.busy)
			.setTooltip(hint)
			.onClick(onClick);
		button.buttonEl.setAttribute('aria-describedby', hintId);
		return button;
	}

	/** Done view: shown when no conflict is open; the modal stays open until the user closes it. */
	private renderDone(): void {
		const { t } = this;
		const done = this.bodyEl.createDiv({ cls: 'nc-conflicts-done' });
		done.createEl('p', { text: t('conflicts.allResolved') });
		const buttons = done.createDiv({ cls: 'modal-button-container' });
		const close = new ButtonComponent(buttons)
			.setButtonText(t('conflicts.close'))
			.setCta()
			.onClick(() => this.close());
		this.statusEl.setText(t('conflicts.allResolved'));
		close.buttonEl.focus();
	}

	/** Loads the diff of an entry once; a cached state is only shown again. */
	private ensureDiff(entry: ConflictEntry): void {
		const key = entryKey(entry);
		if (this.diffCache.has(key)) {
			this.renderDiff(entry);
			return;
		}
		this.diffCache.set(key, { kind: 'loading' });
		this.renderDiff(entry);
		void this.loadDiff(entry);
	}

	private async loadDiff(entry: ConflictEntry): Promise<void> {
		const key = entryKey(entry);
		let state: DiffState;
		try {
			const { local, remote } = await this.source.loadTexts(entry);
			if (local === null) state = { kind: 'localMissing' };
			else if (remote === null) state = { kind: 'ready', lines: null, remoteMissing: true };
			else state = { kind: 'ready', lines: lineDiff(local, remote), remoteMissing: false };
		} catch {
			// Only the error class would help here, and the modal shows the same message for every failure.
			state = { kind: 'failed' };
		}
		// The entry may have been resolved while loading; then its cache entry is gone and the result is dropped.
		if (this.closed || this.diffCache.get(key)?.kind !== 'loading') return;
		this.diffCache.set(key, state);
		this.renderDiff(entry);
	}

	/** Fills the diff area of one entry from its cached state. */
	private renderDiff(entry: ConflictEntry): void {
		const { t } = this;
		const view = this.views.get(entryKey(entry));
		const state = this.diffCache.get(entryKey(entry));
		if (view === undefined || state === undefined) return;
		const container = view.diff;
		container.empty();

		if (state.kind === 'loading') {
			container.createEl('p', { cls: 'nc-diff-message', text: t('conflicts.diff.loading') });
			return;
		}
		if (state.kind === 'failed') {
			container.createEl('p', { cls: 'nc-diff-message', text: t('conflicts.diff.loadFailed') });
			return;
		}
		if (state.kind === 'localMissing') {
			container.createEl('p', { cls: 'nc-diff-message', text: t('conflicts.diff.localMissing') });
			return;
		}
		if (state.remoteMissing) {
			container.createEl('p', { cls: 'nc-diff-message', text: remoteUnavailableMessage(entry, t) });
			return;
		}
		if (state.lines === null) {
			container.createEl('p', { cls: 'nc-diff-message', text: t('conflicts.diff.tooLarge') });
			return;
		}
		if (!hasChanges(state.lines)) {
			container.createEl('p', { cls: 'nc-diff-message', text: t('conflicts.diff.identical') });
			return;
		}

		const legend = container.createDiv({ cls: 'nc-diff-legend' });
		const legendLocal = legend.createSpan();
		legendLocal.createSpan({ cls: 'nc-diff-marker', text: MARKER.removed, attr: { 'aria-hidden': 'true' } });
		legendLocal.createSpan({ text: ' ' + t('conflicts.diff.legendLocal') });
		const legendRemote = legend.createSpan();
		legendRemote.createSpan({ cls: 'nc-diff-marker', text: MARKER.added, attr: { 'aria-hidden': 'true' } });
		legendRemote.createSpan({ text: ' ' + t('conflicts.diff.legendRemote') });

		const region = container.createDiv({
			cls: 'nc-diff',
			attr: { role: 'region', 'aria-label': t('conflicts.diff.label'), tabindex: '0' },
		});
		for (const row of diffRows(state.lines)) {
			if (row.kind === 'skipped') {
				region.createDiv({ cls: ['nc-diff-line', 'is-skipped'], text: t('conflicts.diff.skipped', { count: row.count }) });
				continue;
			}
			const line = region.createDiv({ cls: ['nc-diff-line', `is-${row.kind}`] });
			line.createSpan({ cls: 'nc-diff-marker', text: MARKER[row.kind], attr: { 'aria-hidden': 'true' } });
			if (row.kind === 'removed') line.createSpan({ cls: 'nc-visually-hidden', text: t('conflicts.diff.srLocal') + ' ' });
			if (row.kind === 'added') line.createSpan({ cls: 'nc-visually-hidden', text: t('conflicts.diff.srRemote') + ' ' });
			line.createSpan({ cls: 'nc-diff-text', text: row.text === '' ? ' ' : row.text });
		}
	}

	/** Applies one choice through the source; the list is updated and focus moves on, with the state announced. */
	private async choose(index: number, choice: ConflictChoice): Promise<void> {
		const entry = this.entries[index];
		if (this.busy || entry === undefined) return;
		const { t } = this;
		const key = entryKey(entry);
		const name = describeConflict(entry, t).name;

		this.setBusy(true);
		this.statusEl.removeClass('is-error');
		this.statusEl.setText(t('conflicts.busy'));
		this.headings[index]?.focus();

		let applied: boolean;
		try {
			applied = await this.source.resolve(entry, choice);
		} catch {
			if (this.closed) return;
			this.setBusy(false);
			this.statusEl.setText(t('conflicts.resolveFailed'));
			this.statusEl.addClass('is-error');
			this.actions[index]?.[choice].buttonEl.focus();
			return;
		}
		if (this.closed) return;

		this.setBusy(false);
		// A follow-up run may have replaced other conflict copies too, so no cached diff is trusted after a resolution.
		this.diffCache.clear();
		this.entries = this.source.entries();
		this.render();

		const remaining = this.entries.length;
		const nextIndex = nextFocusIndex(index, remaining);
		if (!applied) {
			this.statusEl.setText(t('conflicts.stale'));
			if (nextIndex !== null) this.headings[nextIndex]?.focus();
			return;
		}
		const reIndex = this.entries.findIndex((e) => entryKey(e) === key);
		if (reIndex >= 0) {
			const reEntry = this.entries[reIndex];
			const view = this.views.get(key);
			if (reEntry !== undefined && view !== undefined) {
				this.statusEl.setText(resolutionAnnouncement(name, remaining, true, t));
				view.details.open = true;
				this.ensureDiff(reEntry);
				this.headings[reIndex]?.focus();
			}
			return;
		}
		this.statusEl.setText(resolutionAnnouncement(name, remaining, false, t));
		if (nextIndex !== null) this.headings[nextIndex]?.focus();
	}

	/** Leaves one entry open for later: closes its details, opens and focuses the next one, or closes the modal after the last. */
	private later(index: number): void {
		const entry = this.entries[index];
		if (entry === undefined) return;
		const view = this.views.get(entryKey(entry));
		if (view !== undefined) view.details.open = false;
		const next = this.entries[index + 1];
		if (next === undefined) {
			this.close();
			return;
		}
		const nextView = this.views.get(entryKey(next));
		if (nextView !== undefined) nextView.details.open = true;
		this.ensureDiff(next);
		this.headings[index + 1]?.focus();
	}

	/** Busy state while a choice is applied: list announced as busy, every action disabled. */
	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.listEl?.setAttribute('aria-busy', String(busy));
		for (const action of this.actions) {
			action.keepLocal.setDisabled(busy);
			action.takeRemote.setDisabled(busy);
			action.later.setDisabled(busy);
		}
	}
}
