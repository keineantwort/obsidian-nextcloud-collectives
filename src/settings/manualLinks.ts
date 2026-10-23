import type { Locale } from '../i18n';

/** The user manual on GitHub, one folder per UI language (ADR 0025). */
export const MANUAL_BASE_URL = 'https://github.com/keineantwort/obsidian-nextcloud-collectives/blob/main/docs/user';

/** Link to the settings reference of the manual in the UI language. */
export function settingsManualUrl(locale: Locale): string {
	return `${MANUAL_BASE_URL}/${locale}/settings.md`;
}
