import { describe, expect, it } from 'vitest';
import { FUNDING_URL, settingsManualUrl } from '../../src/settings/manualLinks';

describe('settingsManualUrl', () => {
	it('links to the settings reference in the UI language', () => {
		expect(settingsManualUrl('en')).toBe('https://github.com/keineantwort/obsidian-nextcloud-collectives/blob/main/docs/user/en/settings.md');
		expect(settingsManualUrl('de')).toBe('https://github.com/keineantwort/obsidian-nextcloud-collectives/blob/main/docs/user/de/settings.md');
	});
});

describe('FUNDING_URL', () => {
	it('is the Ko-fi page and matches fundingUrl in manifest.json', async () => {
		const { readFile } = await import('node:fs/promises');
		const manifest = JSON.parse(await readFile('manifest.json', 'utf8')) as { fundingUrl?: string };
		expect(FUNDING_URL).toBe('https://ko-fi.com/keineantwort');
		expect(manifest.fundingUrl).toBe(FUNDING_URL);
	});
});
