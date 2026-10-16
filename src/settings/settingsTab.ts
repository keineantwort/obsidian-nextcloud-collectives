import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type NextcloudCollectivesPlugin from '../main';
import { describeConnectionError, formatConnectionSuccess } from './connectionMessages';

export class NcSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: NextcloudCollectivesPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		const { plugin } = this;
		const settings = plugin.settings;
		const t = plugin.t;
		containerEl.empty();

		new Setting(containerEl).setName(t('settings.heading.connection')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.serverUrl.name'))
			.setDesc(t('settings.serverUrl.desc'))
			.addText((text) => {
				text
					.setPlaceholder('https://cloud.example.com')
					.setValue(settings.serverUrl)
					.onChange(async (value) => {
						settings.serverUrl = value.trim();
						await plugin.saveSettings();
					});
				applyPlainInputAttributes(text.inputEl);
				text.inputEl.type = 'url';
			});

		new Setting(containerEl)
			.setName(t('settings.username.name'))
			.addText((text) => {
				text
					.setValue(settings.username)
					.onChange(async (value) => {
						settings.username = value.trim();
						await plugin.saveSettings();
					});
				applyPlainInputAttributes(text.inputEl);
			});

		new Setting(containerEl)
			.setName(t('settings.appPassword.name'))
			.setDesc(t('settings.appPassword.desc'))
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				applyPlainInputAttributes(text.inputEl);
				text.setPlaceholder(plugin.hasStoredAppPassword() ? t('settings.appPassword.placeholderStored') : t('settings.appPassword.placeholderEmpty'));
				// Save on commit (blur/Enter), not on every keystroke; the field never shows the stored password.
				// The element is discarded by containerEl.empty() on the next display(), so the listener does not outlive it.
				text.inputEl.addEventListener('change', () => { void (async () => {
					const value = text.inputEl.value;
					if (value === '') return;
					try {
						await plugin.storeAppPassword(value);
					} catch {
						// Keep the typed value so the user can retry; the error itself may contain the secret, so it is not shown.
						new Notice(t('settings.appPassword.saveFailed'));
						return;
					}
					text.setValue('');
					text.setPlaceholder(t('settings.appPassword.placeholderStored'));
				})(); });
			});

		const testSetting = new Setting(containerEl)
			.setName(t('settings.test.name'))
			.setDesc(t('settings.test.desc'));
		const resultEl = containerEl.createDiv({ cls: 'nc-connection-result', attr: { role: 'status', 'aria-live': 'polite' } });

		testSetting.addButton((btn) => {
			btn.setButtonText(t('settings.test.button')).setCta().onClick(async () => {
				btn.setDisabled(true).setButtonText(t('settings.test.buttonRunning'));
				resultEl.setText(t('settings.test.statusRunning'));
				resultEl.removeClass('is-success', 'is-error');
				try {
					const result = await plugin.testConnection();
					resultEl.setText(formatConnectionSuccess(result, t));
					resultEl.addClass('is-success');
				} catch (err) {
					resultEl.setText(describeConnectionError(err, t));
					resultEl.addClass('is-error');
				} finally {
					btn.setDisabled(false).setButtonText(t('settings.test.button'));
				}
			});
		});
	}
}

/** Disables mobile keyboard auto-correction for values that are identifiers or URLs. */
function applyPlainInputAttributes(input: HTMLInputElement): void {
	input.setAttribute('autocapitalize', 'off');
	input.setAttribute('autocorrect', 'off');
	input.spellcheck = false;
}
