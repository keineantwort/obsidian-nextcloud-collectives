import { describe, expect, it } from 'vitest';
import { settingsManualUrl } from '../../src/settings/manualLinks';

describe('settingsManualUrl', () => {
	it('links to the settings reference in the UI language', () => {
		expect(settingsManualUrl('en')).toBe('https://github.com/keineantwort/obsidian-nextcloud-collectives/blob/main/docs/user/en/settings.md');
		expect(settingsManualUrl('de')).toBe('https://github.com/keineantwort/obsidian-nextcloud-collectives/blob/main/docs/user/de/settings.md');
	});
});
