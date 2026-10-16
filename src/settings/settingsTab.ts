import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type NextcloudCollectivesPlugin from '../main';
import { describeConnectionError, formatConnectionSuccess } from './connectionMessages';

export class NcSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: NextcloudCollectivesPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		const { plugin } = this;
		const settings = plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName('Verbindung').setHeading();

		new Setting(containerEl)
			.setName('Server-URL')
			.setDesc('Adresse deines Nextcloud-Servers. Ein Vault ist fest an einen Server gebunden – für einen anderen Server bitte einen neuen Vault anlegen.')
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
			.setName('Benutzername')
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
			.setName('App-Passwort')
			.setDesc('In Nextcloud unter „Persönliche Einstellungen › Sicherheit“ ein App-Passwort erstellen. Es wird im sicheren Speicher von Obsidian abgelegt, nicht in den Plugin-Einstellungen.')
			.addComponent((el) => new SecretComponent(this.app, el)
				.setValue(settings.appPasswordSecretId)
				.onChange(async (id) => {
					settings.appPasswordSecretId = id ?? '';
					await plugin.saveSettings();
				}));

		const testSetting = new Setting(containerEl)
			.setName('Verbindung testen')
			.setDesc('Prüft Server-URL, Benutzername und App-Passwort.');
		const resultEl = containerEl.createDiv({ cls: 'nc-connection-result', attr: { role: 'status', 'aria-live': 'polite' } });

		testSetting.addButton((btn) => {
			btn.setButtonText('Verbindung testen').setCta().onClick(async () => {
				btn.setDisabled(true).setButtonText('Wird geprüft …');
				resultEl.setText('Verbindung wird geprüft …');
				resultEl.removeClass('is-success', 'is-error');
				try {
					const result = await plugin.testConnection();
					resultEl.setText(formatConnectionSuccess(result));
					resultEl.addClass('is-success');
				} catch (err) {
					resultEl.setText(describeConnectionError(err));
					resultEl.addClass('is-error');
				} finally {
					btn.setDisabled(false).setButtonText('Verbindung testen');
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
