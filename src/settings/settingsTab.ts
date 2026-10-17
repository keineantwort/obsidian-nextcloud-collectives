import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type NextcloudCollectivesPlugin from '../main';
import { isInsecureRemoteUrl, normalizeServerUrl } from '../api/connection';
import { describeConnectionError, formatConnectionSuccess } from './connectionMessages';
import { strategyWarning } from './behaviourMessages';
import { isConflictStrategy, isLocalDeleteBehaviour, isNewFolderBehaviour, isRemoteDeleteBehaviour, isTagsProperty } from './types';

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
						updateUrlWarning(value);
						await plugin.saveSettings();
					});
				applyPlainInputAttributes(text.inputEl);
				text.inputEl.type = 'url';
			});

		const urlWarningEl = containerEl.createDiv({ cls: 'nc-url-warning', attr: { role: 'status', 'aria-live': 'polite' } });
		/** Warns about plain http to a remote host. Invalid URLs show nothing here; the connection test reports them. */
		function updateUrlWarning(raw: string): void {
			let insecure = false;
			try {
				insecure = isInsecureRemoteUrl(normalizeServerUrl(raw));
			} catch {
				insecure = false;
			}
			urlWarningEl.setText(insecure ? t('settings.serverUrl.insecureWarning') : '');
		}
		updateUrlWarning(settings.serverUrl);

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

		new Setting(containerEl).setName(t('settings.heading.behaviour')).setHeading();

		const strategySetting = new Setting(containerEl)
			.setName(t('settings.conflictStrategy.name'))
			.setDesc(t('settings.conflictStrategy.desc'));
		strategySetting.descEl.id = 'nc-conflict-strategy-desc';
		const strategyWarningEl = containerEl.createDiv({
			cls: 'nc-strategy-warning',
			attr: { id: 'nc-conflict-strategy-warning', role: 'status', 'aria-live': 'polite' },
		});
		strategySetting.addDropdown((dd) => {
			dd.addOptions({
				conflictFile: t('settings.conflictStrategy.option.conflictFile'),
				preferLocal: t('settings.conflictStrategy.option.preferLocal'),
				preferRemote: t('settings.conflictStrategy.option.preferRemote'),
			})
				.setValue(settings.conflictStrategy)
				.onChange(async (value) => {
					if (!isConflictStrategy(value)) return;
					settings.conflictStrategy = value;
					strategyWarningEl.setText(strategyWarning(value, t));
					await plugin.saveSettings();
				});
			dd.selectEl.setAttribute('aria-label', t('settings.conflictStrategy.name'));
			dd.selectEl.setAttribute('aria-describedby', 'nc-conflict-strategy-desc nc-conflict-strategy-warning');
		});
		strategyWarningEl.setText(strategyWarning(settings.conflictStrategy, t));

		new Setting(containerEl)
			.setName(t('settings.newFolder.name'))
			.setDesc(t('settings.newFolder.desc'))
			.addDropdown((dd) => {
				dd.addOptions({
					createCollective: t('settings.newFolder.option.createCollective'),
					ask: t('settings.newFolder.option.ask'),
					ignore: t('settings.newFolder.option.ignore'),
				})
					.setValue(settings.newFolderBehaviour)
					.onChange(async (value) => {
						if (!isNewFolderBehaviour(value)) return;
						settings.newFolderBehaviour = value;
						await plugin.saveSettings();
					});
				dd.selectEl.setAttribute('aria-label', t('settings.newFolder.name'));
			});

		new Setting(containerEl)
			.setName(t('settings.localDelete.name'))
			.setDesc(t('settings.localDelete.desc'))
			.addDropdown((dd) => {
				dd.addOptions({
					ask: t('settings.localDelete.option.ask'),
					trashRemote: t('settings.localDelete.option.trashRemote'),
				})
					.setValue(settings.localDeleteBehaviour)
					.onChange(async (value) => {
						if (!isLocalDeleteBehaviour(value)) return;
						settings.localDeleteBehaviour = value;
						await plugin.saveSettings();
					});
				dd.selectEl.setAttribute('aria-label', t('settings.localDelete.name'));
			});

		new Setting(containerEl)
			.setName(t('settings.remoteDelete.name'))
			.setDesc(t('settings.remoteDelete.desc'))
			.addDropdown((dd) => {
				dd.addOptions({
					obsidianTrash: t('settings.remoteDelete.option.obsidianTrash'),
					keepUnlinked: t('settings.remoteDelete.option.keepUnlinked'),
				})
					.setValue(settings.remoteDeleteBehaviour)
					.onChange(async (value) => {
						if (!isRemoteDeleteBehaviour(value)) return;
						settings.remoteDeleteBehaviour = value;
						await plugin.saveSettings();
					});
				dd.selectEl.setAttribute('aria-label', t('settings.remoteDelete.name'));
			});

		new Setting(containerEl)
			.setName(t('settings.emojiTitles.name'))
			.setDesc(t('settings.emojiTitles.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.showEmojiInTitles).onChange(async (value) => {
					settings.showEmojiInTitles = value;
					await plugin.saveSettings();
					plugin.refreshEmojiTitles();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.tagsProperty.name'))
			.setDesc(t('settings.tagsProperty.desc'))
			.addDropdown((dd) => {
				dd.addOptions({
					nc_tags: t('settings.tagsProperty.option.nc_tags'),
					tags: t('settings.tagsProperty.option.tags'),
				})
					.setValue(settings.tagsProperty)
					.onChange(async (value) => {
						if (!isTagsProperty(value)) return;
						settings.tagsProperty = value;
						await plugin.saveSettings();
					});
				dd.selectEl.setAttribute('aria-label', t('settings.tagsProperty.name'));
			});
	}
}

/** Disables mobile keyboard auto-correction for values that are identifiers or URLs. */
function applyPlainInputAttributes(input: HTMLInputElement): void {
	input.setAttribute('autocapitalize', 'off');
	input.setAttribute('autocorrect', 'off');
	input.spellcheck = false;
}
