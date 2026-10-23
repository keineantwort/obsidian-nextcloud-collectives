import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { ButtonComponent, TextComponent } from 'obsidian';
import type NextcloudCollectivesPlugin from '../main';
import { isInsecureRemoteUrl, normalizeServerUrl } from '../api/connection';
import { describeConnectionError, formatConnectionSuccess } from './connectionMessages';
import { strategyWarning } from './behaviourMessages';
import { settingsManualUrl } from './manualLinks';
import { isSyncDebounceSec, isSyncIntervalMinutes, isAttachmentFolderPattern, isConflictStrategy, isLocalDeleteBehaviour, isMaxAttachmentSizeMb, isNewFolderBehaviour, isRemoteDeleteBehaviour } from './types';

export class NcSettingTab extends PluginSettingTab {
	/** Fields that the browser login fills in. */
	private usernameField: TextComponent | null = null;
	private passwordField: TextComponent | null = null;
	/** Set while a browser login waits; hide() cancels it so no invisible flow keeps polling. */
	private cancelLogin: (() => void) | null = null;
	/** Re-evaluates whether the connection test can run; replaced on every display(). */
	private updateTestAvailability: () => void = () => {};

	hide(): void {
		this.cancelLogin?.();
	}

	constructor(app: App, private readonly plugin: NextcloudCollectivesPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		const { plugin } = this;
		const settings = plugin.settings;
		const t = plugin.t;
		containerEl.empty();

		const helpSetting = new Setting(containerEl).setName(t('settings.help.name'));
		helpSetting.descEl.appendText(`${t('settings.help.desc')} `);
		helpSetting.descEl.createEl('a', { text: t('settings.help.link'), href: settingsManualUrl(plugin.locale) });

		new Setting(containerEl).setName(t('settings.heading.connection')).setHeading();

		let urlInput!: HTMLInputElement;

		new Setting(containerEl)
			.setName(t('settings.serverUrl.name'))
			.setDesc(t('settings.serverUrl.desc'))
			.addText((text) => {
				urlInput = text.inputEl;
				text
					.setPlaceholder('https://cloud.example.com')
					.setValue(settings.serverUrl)
					.onChange((value) => { updateUrlWarning(value); updateTestAvailability(); });
				// Saved on commit (blur/Enter), not per keystroke: an automatic sync must never send the app password
				// to a half-typed server address.
				text.inputEl.addEventListener('change', () => { void (async () => {
					settings.serverUrl = text.inputEl.value.trim();
					await plugin.saveSettings();
				})(); });
				applyPlainInputAttributes(text.inputEl);
				// type="url" is not styled like the other text fields on mobile; inputmode still brings up the URL keyboard.
				text.inputEl.inputMode = 'url';
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
				this.usernameField = text;
				text
					.setValue(settings.username)
					.onChange(async (value) => {
						settings.username = value.trim();
						updateTestAvailability();
						await plugin.saveSettings();
					});
				applyPlainInputAttributes(text.inputEl);
			});

		// Username first; then the two alternatives for the app password: browser sign-in or typing it in.
		this.displayLogin(containerEl);

		new Setting(containerEl)
			.setName(t('settings.appPassword.name'))
			.setDesc(t('settings.appPassword.desc'))
			.addText((text) => {
				this.passwordField = text;
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
					updateTestAvailability();
				})(); });
			});

		let testButton: ButtonComponent | null = null;
		let running = false;
		/** The test only makes sense once URL, username and app password are all set. */
		function updateTestAvailability(): void {
			const ready = urlInput.value.trim() !== '' && settings.username !== '' && plugin.hasStoredAppPassword();
			testButton?.setDisabled(running || !ready);
		}
		this.updateTestAvailability = updateTestAvailability;

		const testSetting = new Setting(containerEl)
			.setName(t('settings.test.name'))
			.setDesc(t('settings.test.desc'));
		const resultEl = containerEl.createDiv({ cls: 'nc-connection-result', attr: { role: 'status', 'aria-live': 'polite' } });

		testSetting.addButton((btn) => {
			testButton = btn;
			btn.setButtonText(t('settings.test.button')).setCta().onClick(async () => {
				running = true;
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
					running = false;
					btn.setButtonText(t('settings.test.button'));
					updateTestAvailability();
				}
			});
		});
		updateTestAvailability();

		new Setting(containerEl).setName(t('settings.heading.automation')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.syncInterval.name'))
			.setDesc(t('settings.syncInterval.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.setValue(String(settings.syncIntervalMinutes));
				text.inputEl.addEventListener('change', () => { void (async () => {
					const value = Number(text.inputEl.value);
					if (text.inputEl.value.trim() === '' || !isSyncIntervalMinutes(value)) {
						new Notice(t('settings.syncInterval.invalid'));
						text.setValue(String(settings.syncIntervalMinutes));
						return;
					}
					settings.syncIntervalMinutes = value;
					await plugin.saveSettings();
				})(); });
				text.inputEl.setAttribute('aria-label', t('settings.syncInterval.name'));
			});

		new Setting(containerEl)
			.setName(t('settings.syncOnStartup.name'))
			.setDesc(t('settings.syncOnStartup.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
					settings.syncOnStartup = value;
					await plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.syncOnSave.name'))
			.setDesc(t('settings.syncOnSave.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.syncOnSave).onChange(async (value) => {
					settings.syncOnSave = value;
					await plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.syncDebounce.name'))
			.setDesc(t('settings.syncDebounce.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.setValue(String(settings.syncOnSaveDebounceSec));
				text.inputEl.addEventListener('change', () => { void (async () => {
					const value = Number(text.inputEl.value);
					if (text.inputEl.value.trim() === '' || !isSyncDebounceSec(value)) {
						new Notice(t('settings.syncDebounce.invalid'));
						text.setValue(String(settings.syncOnSaveDebounceSec));
						return;
					}
					settings.syncOnSaveDebounceSec = value;
					await plugin.saveSettings();
				})(); });
				text.inputEl.setAttribute('aria-label', t('settings.syncDebounce.name'));
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

		const patternSetting = new Setting(containerEl)
			.setName(t('settings.attachmentFolder.name'))
			.setDesc(t('settings.attachmentFolder.desc'));
		patternSetting.addText((text) => {
			text.setValue(settings.attachmentFolderPattern);
			// Saved on commit; an unusable pattern is refused and the field shows the saved value again.
			text.inputEl.addEventListener('change', () => { void (async () => {
				const value = text.inputEl.value;
				if (!isAttachmentFolderPattern(value)) {
					new Notice(t('settings.attachmentFolder.invalid'));
					text.setValue(settings.attachmentFolderPattern);
					return;
				}
				settings.attachmentFolderPattern = value.trim().replace(/^\/+|\/+$/g, '');
				await plugin.saveSettings();
			})(); });
			text.inputEl.setAttribute('aria-label', t('settings.attachmentFolder.name'));
			applyPlainInputAttributes(text.inputEl);
		});

		new Setting(containerEl)
			.setName(t('settings.maxAttachmentSize.name'))
			.setDesc(t('settings.maxAttachmentSize.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.setValue(String(settings.maxAttachmentSizeMb));
				text.inputEl.addEventListener('change', () => { void (async () => {
					const value = Number(text.inputEl.value);
					if (!isMaxAttachmentSizeMb(value)) {
						new Notice(t('settings.maxAttachmentSize.invalid'));
						text.setValue(String(settings.maxAttachmentSizeMb));
						return;
					}
					settings.maxAttachmentSizeMb = value;
					await plugin.saveSettings();
				})(); });
				text.inputEl.setAttribute('aria-label', t('settings.maxAttachmentSize.name'));
			});

		new Setting(containerEl)
			.setName(t('settings.deleteRemoteAttachments.name'))
			.setDesc(t('settings.deleteRemoteAttachments.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.deleteRemoteAttachments).onChange(async (value) => {
					settings.deleteRemoteAttachments = value;
					await plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.hideProperties.name'))
			.setDesc(t('settings.hideProperties.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.hidePluginProperties).onChange(async (value) => {
					settings.hidePluginProperties = value;
					await plugin.saveSettings();
					plugin.refreshEmojiTitles();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.folderNoteFirst.name'))
			.setDesc(t('settings.folderNoteFirst.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.folderNoteFirst).onChange(async (value) => {
					settings.folderNoteFirst = value;
					await plugin.saveSettings();
					plugin.refreshEmojiTitles();
				});
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

		new Setting(containerEl).setName(t('settings.heading.diagnostics')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.log.name'))
			.setDesc(t('settings.log.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.log.button')).onClick(() => { plugin.showLog(); });
			});

		new Setting(containerEl)
			.setName(t('settings.debugLogging.name'))
			.setDesc(t('settings.debugLogging.desc'))
			.addToggle((toggle) => {
				toggle.setValue(settings.debugLogging).onChange(async (value) => {
					settings.debugLogging = value;
					await plugin.saveSettings();
				});
			});
	}

	/** Login Flow v2: a button that opens the Nextcloud login page; username and app password are filled in afterwards. */
	private displayLogin(containerEl: HTMLElement): void {
		const { plugin } = this;
		const t = plugin.t;
		const setting = new Setting(containerEl).setName(t('settings.login.name')).setDesc(t('settings.login.desc'));
		const statusEl = containerEl.createDiv({ cls: 'nc-login-status', attr: { role: 'status', 'aria-live': 'polite' } });
		let cancelled = false;
		let running = false;
		setting.addButton((btn) => {
			btn.setButtonText(t('settings.login.button')).onClick(async () => {
				if (running) {
					cancelled = true;
					return;
				}
				// Plain http would send the sign-in and the new app password unencrypted.
				try {
					if (isInsecureRemoteUrl(normalizeServerUrl(plugin.settings.serverUrl))) {
						statusEl.setText(t('settings.login.insecure'));
						return;
					}
				} catch {
					// An invalid or missing URL is reported by the login itself.
				}
				running = true;
				cancelled = false;
				this.cancelLogin = () => { cancelled = true; };
				btn.setButtonText(t('settings.login.cancel'));
				statusEl.empty();
				statusEl.setText(t('settings.login.waiting'));
				try {
					const outcome = await plugin.loginWithBrowser((start) => {
						// The login URL is shown as a link too: a pop-up blocker may swallow window.open.
						window.open(start.loginUrl);
						statusEl.empty();
						statusEl.createSpan({ text: t('settings.login.waiting') + ' ' });
						statusEl.createEl('a', { text: t('settings.login.openAgain'), href: start.loginUrl });
					}, () => cancelled);
					if (outcome.kind === 'done') {
						this.usernameField?.setValue(outcome.user);
						this.passwordField?.setPlaceholder(t('settings.appPassword.placeholderStored'));
						this.updateTestAvailability();
						statusEl.setText(t('settings.login.success', { user: outcome.user }));
						return;
					}
					statusEl.setText(outcome.kind === 'cancelled' ? t('settings.login.cancelled') : t('settings.login.timeout'));
				} catch (err) {
					statusEl.setText(t('settings.login.failed', { reason: describeConnectionError(err, t) }));
				} finally {
					running = false;
					this.cancelLogin = null;
					btn.setButtonText(t('settings.login.button'));
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
