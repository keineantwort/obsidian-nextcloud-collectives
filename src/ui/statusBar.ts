// Status bar item (desktop only): the view model is pure and tested; StatusBar only maps it onto the DOM.
// No 'obsidian' import, so the pure part runs in the unit tests.
import type { Translator } from '../i18n';

export type LastRun = { kind: 'success'; at: number } | { kind: 'failed'; at: number } | null;
export interface StatusBarInput { running: boolean; lastRun: LastRun; openConflicts: number; }
export type StatusBarAction = 'openConflicts' | 'sync' | 'none';
export interface StatusBarView { text: string; ariaLabel: string; clickable: boolean; action: StatusBarAction; }

/** Local time as zero-padded 24h "HH:mm". */
export function formatClock(ms: number): string {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Visible text, accessible label and click action for the current state. Precedence: running > failed > conflicts > success > never. */
export function statusBarView(input: StatusBarInput, t: Translator): StatusBarView {
	const time = input.lastRun ? formatClock(input.lastRun.at) : '';
	const conflicts = input.openConflicts;

	let stateSentence: string;
	if (input.running) stateSentence = t('statusBar.label.running');
	else if (input.lastRun?.kind === 'failed') stateSentence = t('statusBar.label.failed', { time });
	else if (input.lastRun?.kind === 'success') stateSentence = t('statusBar.label.success', { time });
	else stateSentence = t('statusBar.label.never');

	let conflictSentence = '';
	if (conflicts === 1) conflictSentence = t('statusBar.label.conflicts.one');
	else if (conflicts > 1) conflictSentence = t('statusBar.label.conflicts.other', { count: conflicts });

	let action: StatusBarAction;
	if (conflicts > 0) action = 'openConflicts';
	else if (input.running) action = 'none';
	else action = 'sync';

	let actionSentence = '';
	if (action === 'openConflicts') actionSentence = t('statusBar.action.openConflicts');
	else if (action === 'sync') actionSentence = t('statusBar.action.sync');

	let text: string;
	if (input.running) text = t('statusBar.text.running');
	else if (input.lastRun?.kind === 'failed') text = t('statusBar.text.failed');
	else if (conflicts > 0) text = t('statusBar.text.conflicts', { count: conflicts });
	else if (input.lastRun?.kind === 'success') text = t('statusBar.text.success', { time });
	else text = t('statusBar.text.never');

	return {
		text,
		ariaLabel: [stateSentence, conflictSentence, actionSentence].filter((s) => s !== '').join(' '),
		clickable: action !== 'none',
		action,
	};
}

type ClickAction = Exclude<StatusBarAction, 'none'>;

/** Status bar item in the DOM. Always role=button; the inactive state is announced with aria-disabled. */
export class StatusBar {
	private action: StatusBarAction = 'none';

	constructor(
		private readonly el: HTMLElement,
		private readonly t: Translator,
		private readonly onAction: (action: ClickAction) => void,
	) {
		el.classList.add('nc-status-bar-item');
		el.setAttribute('role', 'button');
		el.setAttribute('tabindex', '0');
		el.setAttribute('data-tooltip-position', 'top'); // Obsidian shows aria-label as tooltip
		el.addEventListener('click', () => this.fire());
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.fire();
			}
		});
	}

	update(input: StatusBarInput): void {
		const view = statusBarView(input, this.t);
		this.action = view.action;
		this.el.textContent = view.text;
		this.el.setAttribute('aria-label', view.ariaLabel);
		this.el.classList.toggle('mod-clickable', view.clickable);
		if (view.clickable) this.el.removeAttribute('aria-disabled');
		else this.el.setAttribute('aria-disabled', 'true');
	}

	private fire(): void {
		if (this.action !== 'none') this.onAction(this.action);
	}
}
