// Picker for the emoji of a page (command "Set page emoji", also opened when the emoji property is added to a note).
// The only emoji UI that imports 'obsidian'; the rules (one emoji, the offered emojis) are in mapping/emoji.ts.
import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { Translator } from '../i18n';
import { EMOJI_GROUPS, parseEmoji } from '../mapping/emoji';

/** Asks for the emoji. Resolves with the emoji, null for "no emoji", undefined if the user cancelled. Resolves exactly once. */
export function pickEmoji(app: App, t: Translator, current: string | null): Promise<string | null | undefined> {
	return new Promise((resolve) => {
		new EmojiModal(app, t, current, resolve).open();
	});
}

class EmojiModal extends Modal {
	private settled = false;
	private input: HTMLInputElement | null = null;
	private message: HTMLElement | null = null;
	private ok: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly t: Translator,
		private readonly current: string | null,
		private readonly onDone: (emoji: string | null | undefined) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { t, contentEl, modalEl } = this;
		this.setTitle(t('emoji.title'));
		modalEl.addClass('nc-emoji-modal');

		const row = contentEl.createDiv({ cls: 'nc-emoji-row' });
		row.createEl('label', { text: t('emoji.input.label'), attr: { for: 'nc-emoji-input' } });
		const input = row.createEl('input', { type: 'text', cls: 'nc-emoji-input', attr: { id: 'nc-emoji-input', 'aria-describedby': 'nc-emoji-message', placeholder: '🙂' } });
		input.value = this.current ?? '';
		input.addEventListener('input', () => { this.validate(); });
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') this.submit();
		});
		this.input = input;
		this.message = contentEl.createDiv({ cls: 'nc-emoji-message', attr: { id: 'nc-emoji-message', role: 'status', 'aria-live': 'polite' } });

		for (const group of EMOJI_GROUPS) {
			const grid = contentEl.createDiv({ cls: 'nc-emoji-grid', attr: { role: 'group', 'aria-label': t(`emoji.group.${group.name}`) } });
			for (const emoji of group.emojis) {
				const button = grid.createEl('button', { cls: 'nc-emoji-choice', text: emoji, attr: { type: 'button', 'aria-label': emoji } });
				button.addEventListener('click', () => {
					input.value = emoji;
					this.validate();
					input.focus();
				});
			}
		}

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons).setButtonText(t('emoji.cancel')).onClick(() => { this.settle(undefined); });
		new ButtonComponent(buttons).setButtonText(t('emoji.remove')).onClick(() => { this.settle(null); });
		this.ok = new ButtonComponent(buttons).setButtonText(t('emoji.apply')).setCta().onClick(() => { this.submit(); });
		this.validate();
		input.focus();
		input.select();
	}

	/** Shows whether the text is one emoji; the button is only available for a valid text. */
	private validate(): boolean {
		const parsed = parseEmoji(this.input?.value ?? '');
		this.message?.setText(parsed.valid ? '' : this.t('emoji.invalid'));
		this.input?.toggleClass('is-invalid', !parsed.valid);
		this.input?.setAttribute('aria-invalid', String(!parsed.valid));
		this.ok?.setDisabled(!parsed.valid);
		return parsed.valid;
	}

	private submit(): void {
		if (!this.validate()) return;
		this.settle(parseEmoji(this.input?.value ?? '').emoji);
	}

	private settle(emoji: string | null | undefined): void {
		if (this.settled) return;
		this.settled = true;
		this.onDone(emoji);
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
