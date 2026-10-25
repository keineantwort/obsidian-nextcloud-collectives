import { App, Notice, PluginSettingTab, SettingGroup } from 'obsidian';
import type { ButtonComponent, SettingDefinition, SettingDefinitionItem, TextComponent } from 'obsidian';
import type NextcloudCollectivesPlugin from '../main';
import { isInsecureRemoteUrl, normalizeServerUrl } from '../api/connection';
import { describeConnectionError, formatConnectionSuccess } from './connectionMessages';
import { strategyWarning } from './behaviourMessages';
import { settingsManualUrl } from './manualLinks';
import type { MessageKey } from '../i18n';
import type { NcSettings } from './types';
import { isSyncDebounceSec, isSyncIntervalMinutes, isAttachmentFolderPattern, isConflictStrategy, isLocalDeleteBehaviour, isMaxAttachmentSizeMb, isNewFolderBehaviour, isRemoteDeleteBehaviour } from './types';

export class NcSettingTab extends PluginSettingTab {
	/** Fields that the browser login fills in. */
	private usernameField: TextComponent | null = null;
	private passwordField: TextComponent | null = null;
	/** Set while a browser login waits; hide() cancels it so no invisible flow keeps polling. */
	private cancelLogin: (() => void) | null = null;
	private urlInput: HTMLInputElement | null = null;
	private testButton: ButtonComponent | null = null;
	private testRunning = false;

	constructor(app: App, private readonly plugin: NextcloudCollectivesPlugin) { super(app, plugin); }

	hide(): void {
		this.cancelLogin?.();
	}

	/**
	 * The settings as definitions: Obsidian ≥ 1.13 renders and indexes them for its settings search (ADR 0031).
	 * Every row uses `render` because the rows are not plain values: they save on commit, validate with notices,
	 * keep the app password out of data.json and run the login and the connection test.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const { plugin } = this;
		const t = plugin.t;
		return [
			{ type: 'group', items: [this.helpDefinition()] },
			{
				type: 'group',
				heading: t('settings.heading.connection'),
				items: [
					this.serverUrlDefinition(),
					this.usernameDefinition(),
					this.loginDefinition(),
					this.appPasswordDefinition(),
					this.testDefinition(),
				],
			},
			{
				type: 'group',
				heading: t('settings.heading.automation'),
				items: [
					this.numberDefinition('settings.syncInterval', 'syncIntervalMinutes', isSyncIntervalMinutes),
					this.toggleDefinition('settings.syncOnStartup', 'syncOnStartup'),
					this.toggleDefinition('settings.syncOnForeground', 'syncOnForeground'),
					this.toggleDefinition('settings.syncOnSave', 'syncOnSave'),
					this.numberDefinition('settings.syncDebounce', 'syncOnSaveDebounceSec', isSyncDebounceSec),
				],
			},
			{
				type: 'group',
				heading: t('settings.heading.behaviour'),
				items: [
					this.conflictStrategyDefinition(),
					this.dropdownDefinition('settings.newFolder', 'newFolderBehaviour', ['createCollective', 'ask', 'ignore'], isNewFolderBehaviour),
					this.dropdownDefinition('settings.localDelete', 'localDeleteBehaviour', ['ask', 'trashRemote'], isLocalDeleteBehaviour),
					this.dropdownDefinition('settings.remoteDelete', 'remoteDeleteBehaviour', ['obsidianTrash', 'keepUnlinked'], isRemoteDeleteBehaviour),
					this.attachmentFolderDefinition(),
					this.numberDefinition('settings.maxAttachmentSize', 'maxAttachmentSizeMb', isMaxAttachmentSizeMb, false),
					this.toggleDefinition('settings.deleteRemoteAttachments', 'deleteRemoteAttachments'),
					this.toggleDefinition('settings.hideProperties', 'hidePluginProperties', () => { plugin.refreshEmojiTitles(); }),
					this.toggleDefinition('settings.folderNoteFirst', 'folderNoteFirst', () => { plugin.refreshEmojiTitles(); }),
					this.toggleDefinition('settings.emojiTitles', 'showEmojiInTitles', () => { plugin.refreshEmojiTitles(); }),
				],
			},
			{
				type: 'group',
				heading: t('settings.heading.diagnostics'),
				items: [
					{
						name: t('settings.log.name'),
						desc: t('settings.log.desc'),
						render: (setting) => {
							setting.addButton((btn) => {
								btn.setButtonText(t('settings.log.button')).onClick(() => { plugin.showLog(); });
							});
						},
					},
					this.toggleDefinition('settings.debugLogging', 'debugLogging'),
				],
			},
		];
	}

	/**
	 * Fallback for Obsidian < 1.13, which never calls getSettingDefinitions(): renders the same definitions
	 * (group by group, row by row) so that both versions show identical settings.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const item of this.getSettingDefinitions()) {
			if (!('type' in item) || item.type !== 'group') continue;
			const group = new SettingGroup(containerEl);
			if (item.heading) group.setHeading(item.heading);
			for (const row of item.items ?? []) {
				if (!('render' in row) || !row.render) continue;
				group.addSetting((setting) => {
					setting.setName(row.name);
					if (row.desc) setting.setDesc(row.desc);
					row.render(setting, group);
				});
			}
		}
	}

	private helpDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.help.name'),
			desc: t('settings.help.desc'),
			render: (setting) => {
				setting.descEl.appendText(' ');
				setting.descEl.createEl('a', { text: t('settings.help.link'), href: settingsManualUrl(plugin.locale) });
			},
		};
	}

	private serverUrlDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.serverUrl.name'),
			desc: t('settings.serverUrl.desc'),
			aliases: ['nextcloud', 'url', 'https'],
			render: (setting) => {
				const settings = plugin.settings;
				const urlWarningEl = setting.infoEl.createDiv({ cls: 'nc-url-warning', attr: { role: 'status', 'aria-live': 'polite' } });
				/** Warns about plain http to a remote host. Invalid URLs show nothing here; the connection test reports them. */
				const updateUrlWarning = (raw: string): void => {
					let insecure = false;
					try {
						insecure = isInsecureRemoteUrl(normalizeServerUrl(raw));
					} catch {
						insecure = false;
					}
					urlWarningEl.setText(insecure ? t('settings.serverUrl.insecureWarning') : '');
				};
				setting.addText((text) => {
					this.urlInput = text.inputEl;
					text
						.setPlaceholder('https://cloud.example.com')
						.setValue(settings.serverUrl)
						.onChange((value) => { updateUrlWarning(value); this.updateTestAvailability(); });
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
				updateUrlWarning(settings.serverUrl);
			},
		};
	}

	private usernameDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.username.name'),
			aliases: ['user', 'login'],
			render: (setting) => {
				const settings = plugin.settings;
				setting.addText((text) => {
					this.usernameField = text;
					text
						.setValue(settings.username)
						.onChange(async (value) => {
							settings.username = value.trim();
							this.updateTestAvailability();
							await plugin.saveSettings();
						});
					applyPlainInputAttributes(text.inputEl);
				});
			},
		};
	}

	private appPasswordDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.appPassword.name'),
			desc: t('settings.appPassword.desc'),
			aliases: ['password', 'token', 'secret'],
			render: (setting) => {
				setting.addText((text) => {
					this.passwordField = text;
					text.inputEl.type = 'password';
					text.inputEl.autocomplete = 'off';
					applyPlainInputAttributes(text.inputEl);
					text.setPlaceholder(plugin.hasStoredAppPassword() ? t('settings.appPassword.placeholderStored') : t('settings.appPassword.placeholderEmpty'));
					// Save on commit (blur/Enter), not on every keystroke; the field never shows the stored password.
					// The element is discarded when the tab is rendered again, so the listener does not outlive it.
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
						this.updateTestAvailability();
					})(); });
				});
			},
		};
	}

	/** The test only makes sense once URL, username and app password are all set. */
	private updateTestAvailability(): void {
		const ready = (this.urlInput?.value.trim() ?? '') !== '' && this.plugin.settings.username !== '' && this.plugin.hasStoredAppPassword();
		this.testButton?.setDisabled(this.testRunning || !ready);
	}

	private testDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.test.name'),
			desc: t('settings.test.desc'),
			aliases: ['connection', 'check'],
			render: (setting) => {
				const resultEl = setting.infoEl.createDiv({ cls: 'nc-connection-result', attr: { role: 'status', 'aria-live': 'polite' } });
				setting.addButton((btn) => {
					this.testButton = btn;
					btn.setButtonText(t('settings.test.button')).setCta().onClick(async () => {
						this.testRunning = true;
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
							this.testRunning = false;
							btn.setButtonText(t('settings.test.button'));
							this.updateTestAvailability();
						}
					});
				});
				this.updateTestAvailability();
			},
		};
	}

	private toggleDefinition(
		prefix: 'settings.syncOnStartup' | 'settings.syncOnForeground' | 'settings.syncOnSave' | 'settings.deleteRemoteAttachments' | 'settings.hideProperties' | 'settings.folderNoteFirst' | 'settings.emojiTitles' | 'settings.debugLogging',
		key: BooleanSettingKey,
		afterChange?: () => void,
	): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t(`${prefix}.name`),
			desc: t(`${prefix}.desc`),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(plugin.settings[key]).onChange(async (value) => {
						plugin.settings[key] = value;
						await plugin.saveSettings();
						afterChange?.();
					});
				});
			},
		};
	}

	/**
	 * A number field saved on commit. An invalid value is refused with a notice and the field shows the saved value again.
	 * `emptyIsInvalid`: an empty field would read as 0, which is valid for the sync interval but must not be taken as typed.
	 */
	private numberDefinition(
		prefix: 'settings.syncInterval' | 'settings.syncDebounce' | 'settings.maxAttachmentSize',
		key: NumberSettingKey,
		isValid: (value: number) => boolean,
		emptyIsInvalid = true,
	): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t(`${prefix}.name`),
			desc: t(`${prefix}.desc`),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = 'number';
					text.setValue(String(plugin.settings[key]));
					text.inputEl.addEventListener('change', () => { void (async () => {
						const value = Number(text.inputEl.value);
						if ((emptyIsInvalid && text.inputEl.value.trim() === '') || !isValid(value)) {
							new Notice(t(`${prefix}.invalid`));
							text.setValue(String(plugin.settings[key]));
							return;
						}
						plugin.settings[key] = value;
						await plugin.saveSettings();
					})(); });
					text.inputEl.setAttribute('aria-label', t(`${prefix}.name`));
				});
			},
		};
	}

	private dropdownDefinition<K extends DropdownSettingKey>(
		prefix: 'settings.newFolder' | 'settings.localDelete' | 'settings.remoteDelete',
		key: K,
		options: Array<NcSettings[K]>,
		isValid: (value: string) => value is NcSettings[K],
	): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t(`${prefix}.name`),
			desc: t(`${prefix}.desc`),
			render: (setting) => {
				setting.addDropdown((dd) => {
					for (const option of options) dd.addOption(option, t(`${prefix}.option.${option}` as MessageKey));
					dd.setValue(plugin.settings[key])
						.onChange(async (value) => {
							if (!isValid(value)) return;
							plugin.settings[key] = value;
							await plugin.saveSettings();
						});
					dd.selectEl.setAttribute('aria-label', t(`${prefix}.name`));
				});
			},
		};
	}

	private conflictStrategyDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.conflictStrategy.name'),
			desc: t('settings.conflictStrategy.desc'),
			aliases: ['conflict', 'merge'],
			render: (setting) => {
				const settings = plugin.settings;
				setting.descEl.id = 'nc-conflict-strategy-desc';
				const strategyWarningEl = setting.infoEl.createDiv({
					cls: 'nc-strategy-warning',
					attr: { id: 'nc-conflict-strategy-warning', role: 'status', 'aria-live': 'polite' },
				});
				setting.addDropdown((dd) => {
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
			},
		};
	}

	private attachmentFolderDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.attachmentFolder.name'),
			desc: t('settings.attachmentFolder.desc'),
			render: (setting) => {
				const settings = plugin.settings;
				setting.addText((text) => {
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
			},
		};
	}

	/** Login Flow v2: a button that opens the Nextcloud login page; username and app password are filled in afterwards. */
	private loginDefinition(): SettingDefinition {
		const { plugin } = this;
		const t = plugin.t;
		return {
			name: t('settings.login.name'),
			desc: t('settings.login.desc'),
			aliases: ['browser', 'sign in', 'login flow'],
			render: (setting) => {
				const statusEl = setting.infoEl.createDiv({ cls: 'nc-login-status', attr: { role: 'status', 'aria-live': 'polite' } });
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
			},
		};
	}
}

type BooleanSettingKey = { [K in keyof NcSettings]: NcSettings[K] extends boolean ? K : never }[keyof NcSettings];
type NumberSettingKey = { [K in keyof NcSettings]: NcSettings[K] extends number ? K : never }[keyof NcSettings];
type DropdownSettingKey = 'newFolderBehaviour' | 'localDeleteBehaviour' | 'remoteDeleteBehaviour';

/** Disables mobile keyboard auto-correction for values that are identifiers or URLs. */
function applyPlainInputAttributes(input: HTMLInputElement): void {
	input.setAttribute('autocapitalize', 'off');
	input.setAttribute('autocorrect', 'off');
	input.spellcheck = false;
}
