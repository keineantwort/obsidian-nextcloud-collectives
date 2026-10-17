// Prompt for the new name of a page (menu and command "Rename page"). Obsidian has no text prompt of its own.
import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from '../i18n';

/**
 * Asks for a name. `check` returns a message for a name that cannot be used, or null. Resolves with the name, or undefined if
 * the user cancelled. Resolves exactly once.
 */
export function promptName(app: App, t: Translator, current: string, check: (name: string) => string | null): Promise<string | undefined> {
	return new Promise((resolve) => {
		new NameModal(app, t, current, check, resolve).open();
	});
}

class NameModal extends Modal {
	private settled = false;
	private input: HTMLInputElement | null = null;
	private message: HTMLElement | null = null;
	private ok: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly t: Translator,
		private readonly current: string,
		private readonly check: (name: string) => string | null,
		private readonly onDone: (name: string | undefined) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { t, contentEl, modalEl } = this;
		this.setTitle(t('rename.title'));
		modalEl.addClass('nc-rename-modal');
		const row = contentEl.createDiv({ cls: 'nc-rename-row' });
		row.createEl('label', { text: t('rename.input.label'), attr: { for: 'nc-rename-input' } });
		const input = row.createEl('input', { type: 'text', cls: 'nc-rename-input', attr: { id: 'nc-rename-input', 'aria-describedby': 'nc-rename-message' } });
		input.value = this.current;
		input.addEventListener('input', () => { this.validate(); });
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') this.submit();
		});
		this.input = input;
		this.message = contentEl.createDiv({ cls: 'nc-rename-message', attr: { id: 'nc-rename-message', role: 'status', 'aria-live': 'polite' } });
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons).setButtonText(t('rename.cancel')).onClick(() => { this.settle(undefined); });
		this.ok = new ButtonComponent(buttons).setButtonText(t('rename.apply')).setCta().onClick(() => { this.submit(); });
		this.validate();
		input.focus();
		input.select();
	}

	private validate(): boolean {
		const problem = this.check(this.input?.value ?? '');
		this.message?.setText(problem ?? '');
		this.input?.toggleClass('is-invalid', problem !== null);
		this.input?.setAttribute('aria-invalid', String(problem !== null));
		this.ok?.setDisabled(problem !== null);
		return problem === null;
	}

	private submit(): void {
		if (this.validate()) this.settle(this.input?.value ?? '');
	}

	private settle(name: string | undefined): void {
		if (this.settled) return;
		this.settled = true;
		this.onDone(name);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.onDone(undefined);
		}
	}
}
