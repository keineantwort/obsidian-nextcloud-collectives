import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { MessageKey, Translator } from '../i18n';

const TITLE_ID = 'nc-initial-sync-title';
const DESC_ID = 'nc-initial-sync-desc';
const POINT_KEYS: readonly MessageKey[] = ['initialSync.point.folders', 'initialSync.point.conflicts', 'initialSync.point.localFiles'];

/**
 * Asks before the first sync into a non-empty vault. Resolves true = merge, false = cancel.
 * Closing via Esc, the close button or the mobile back gesture counts as cancel. Resolves exactly once.
 */
export function confirmInitialSync(app: App, t: Translator): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		new InitialSyncModal(app, t, resolve).open();
	});
}

class InitialSyncModal extends Modal {
	private settled = false;

	constructor(app: App, private readonly t: Translator, private readonly onDecision: (merge: boolean) => void) {
		super(app);
	}

	onOpen(): void {
		const { t, contentEl, modalEl, titleEl } = this;
		this.setTitle(t('initialSync.title'));
		modalEl.addClass('nc-initial-sync');

		// Dialog semantics: only set what Obsidian does not already provide.
		titleEl.id = TITLE_ID;
		if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
		modalEl.setAttribute('aria-modal', 'true');
		modalEl.setAttribute('aria-labelledby', TITLE_ID);
		modalEl.setAttribute('aria-describedby', DESC_ID);

		contentEl.createEl('p', { text: t('initialSync.intro'), attr: { id: DESC_ID } });
		const list = contentEl.createEl('ul', { cls: 'nc-initial-sync-points' });
		const label = t('sync.conflictFileLabel');
		for (const key of POINT_KEYS) list.createEl('li', { text: t(key, { label }) });
		contentEl.createEl('p', { cls: 'nc-initial-sync-recommendation', text: t('initialSync.recommendation') });

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = new ButtonComponent(buttons).setButtonText(t('initialSync.cancel')).onClick(() => this.decide(false));
		new ButtonComponent(buttons).setButtonText(t('initialSync.confirm')).setCta().onClick(() => this.decide(true));

		// Safer option first: Enter/Space on open cancels.
		cancel.buttonEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.settle(false); // Esc, close button, back gesture; no-op after decide()
	}

	private decide(merge: boolean): void {
		this.settle(merge);
		this.close();
	}

	private settle(merge: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.onDecision(merge);
	}
}
