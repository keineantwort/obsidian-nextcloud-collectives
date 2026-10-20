// Log view (PLAN §12): the ring buffer of the session as selectable text with a copy button. All texts from the translator.
import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from '../i18n';
import type { Logger } from '../util/logger';
import { formatLog } from './logView';

export function openLogModal(app: App, t: Translator, log: Logger): void {
	new LogModal(app, t, log).open();
}

class LogModal extends Modal {
	constructor(app: App, private readonly t: Translator, private readonly log: Logger) { super(app); }

	onOpen(): void {
		const { t, contentEl } = this;
		const text = formatLog(this.log.entries());
		this.setTitle(t('log.title'));
		this.modalEl.addClass('nc-log');
		contentEl.createEl('p', { text: t('log.desc') });
		// A read-only textarea: selectable and scrollable on desktop and mobile, and announced as one text field.
		const area = contentEl.createEl('textarea', { cls: 'nc-log-text', attr: { readonly: 'true', rows: '16', 'aria-label': t('log.title') } });
		area.value = text === '' ? t('log.empty') : text;
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const copy = buttons.createEl('button', { cls: 'mod-cta', text: t('log.copy') });
		copy.disabled = text === '';
		copy.addEventListener('click', () => {
			navigator.clipboard.writeText(text).then(
				() => { new Notice(t('log.copied')); },
				() => { new Notice(t('log.copyFailed')); },
			);
		});
		buttons.createEl('button', { text: t('log.close') }).addEventListener('click', () => { this.close(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
