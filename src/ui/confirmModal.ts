// Confirmation dialog for destructive and surprising changes (PLAN §7.4). Resolves with an answer per question.
// The only confirmation UI that imports 'obsidian'; texts and answers come from confirmView.ts.
import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from '../i18n';
import type { Decision, Proposal } from '../sync/types';
import { buildConfirmRows, decisionsFor, laterDecisions } from './confirmView';
import type { ConfirmRow } from './confirmView';

const TITLE_ID = 'nc-confirm-title';

/**
 * Asks the questions of one plan. Closing the dialog (Esc, close button, back gesture) postpones all of them.
 * Resolves exactly once.
 */
export function confirmProposals(app: App, t: Translator, proposals: Proposal[]): Promise<ReadonlyMap<string, Decision>> {
	return new Promise((resolve) => {
		new ConfirmModal(app, t, buildConfirmRows(proposals, t), resolve).open();
	});
}

class ConfirmModal extends Modal {
	private settled = false;
	private readonly boxes = new Map<string, HTMLInputElement>();

	constructor(
		app: App,
		private readonly t: Translator,
		private readonly rows: ConfirmRow[],
		private readonly onDecision: (answers: ReadonlyMap<string, Decision>) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { t, contentEl, modalEl, titleEl } = this;
		this.setTitle(t('confirm.title'));
		modalEl.addClass('nc-confirm');

		// Dialog semantics: only set what Obsidian does not already provide.
		titleEl.id = TITLE_ID;
		if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
		modalEl.setAttribute('aria-modal', 'true');
		modalEl.setAttribute('aria-labelledby', TITLE_ID);

		const list = contentEl.createEl('ul', { cls: 'nc-confirm-list' });
		this.rows.forEach((row, index) => this.renderRow(list, row, index));

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons).setButtonText(t('confirm.later')).onClick(() => this.settle(laterDecisions(this.rows)));
		new ButtonComponent(buttons).setButtonText(t('confirm.checkAll')).onClick(() => this.setAll(true));
		new ButtonComponent(buttons).setButtonText(t('confirm.uncheckAll')).onClick(() => this.setAll(false));
		new ButtonComponent(buttons).setButtonText(t('confirm.apply')).setCta().onClick(() => this.settle(decisionsFor(this.rows, this.checked())));
	}

	private renderRow(list: HTMLElement, row: ConfirmRow, index: number): void {
		const item = list.createEl('li', { cls: row.warning === null ? 'nc-confirm-item' : 'nc-confirm-item is-warning' });
		const boxId = `nc-confirm-box-${index}`;
		// The whole row is the label: text on the left, the box on the right, centred to all lines of the row.
		const label = item.createEl('label', { cls: 'nc-confirm-row', attr: { for: boxId } });
		const text = label.createDiv({ cls: 'nc-confirm-text' });
		text.createDiv({ cls: 'nc-confirm-label', text: row.label });
		if (row.warning !== null) text.createDiv({ cls: 'nc-confirm-warning', text: row.warning, attr: { role: 'alert' } });
		for (const detail of row.details) text.createDiv({ cls: 'nc-confirm-detail', text: detail });
		// Nothing is checked at first: every destructive step needs the user's own tick.
		const box = label.createEl('input', { attr: { type: 'checkbox', id: boxId } });
		this.boxes.set(row.id, box);
	}

	private checked(): Set<string> {
		return new Set([...this.boxes].filter(([, box]) => box.checked).map(([id]) => id));
	}

	private setAll(value: boolean): void {
		for (const box of this.boxes.values()) box.checked = value;
	}

	onClose(): void {
		this.contentEl.empty();
		this.answer(laterDecisions(this.rows)); // Esc, close button, back gesture; no-op after an answer
	}

	private settle(answers: ReadonlyMap<string, Decision>): void {
		this.answer(answers);
		this.close();
	}

	private answer(answers: ReadonlyMap<string, Decision>): void {
		if (this.settled) return;
		this.settled = true;
		this.onDecision(answers);
	}
}
