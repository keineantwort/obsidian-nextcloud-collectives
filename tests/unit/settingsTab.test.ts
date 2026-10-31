import { describe, expect, it } from 'vitest';
import type { SettingDefinitionItem } from 'obsidian';
import type NextcloudCollectivesPlugin from '../../src/main';
import { createTranslator } from '../../src/i18n';
import { NcSettingTab } from '../../src/settings/settingsTab';

function definitionsFor(locale: 'en' | 'de'): SettingDefinitionItem[] {
	const plugin = { t: createTranslator(locale), locale, settings: {} } as unknown as NextcloudCollectivesPlugin;
	return new NcSettingTab({} as never, plugin).getSettingDefinitions();
}

function rows(items: SettingDefinitionItem[]) {
	return items.flatMap((item) => ('type' in item && item.type === 'group' ? item.items ?? [] : []));
}

describe('NcSettingTab.getSettingDefinitions (Obsidian settings search, ADR 0031)', () => {
	it('lists every setting of the tab by name, in tab order', () => {
		const names = rows(definitionsFor('en')).map((row) => row.name);
		expect(names).toEqual([
			'Help',
			'Server URL',
			'Username',
			'Sign in with the browser',
			'App password',
			'Test connection',
			'Sync interval (minutes)',
			'Sync on startup',
			'Sync when returning to Obsidian',
			'Sync after changes',
			'Wait after the last change (seconds)',
			'Conflicts',
			'New top-level folders',
			'Deleting notes in this vault',
			'Pages deleted on the server',
			'Attachment folder',
			'Largest attachment (MB)',
			'Delete attachments on the server',
			'Hide the plugin’s properties',
			'Show the page of a folder first',
			'Show page emoji in titles',
			'Log',
			'Detailed log',
			'Support',
		]);
	});

	it('groups the settings under the four headings', () => {
		const headings = definitionsFor('en').map((item) => ('heading' in item ? item.heading : undefined));
		expect(headings).toEqual([undefined, 'Connection', 'Automatic sync', 'Behaviour', 'Diagnostics', undefined]);
	});

	it('gives every row a render function and a description (except the username) so search can index it', () => {
		for (const row of rows(definitionsFor('en'))) {
			expect(typeof (row as { render?: unknown }).render, row.name).toBe('function');
			if (row.name !== 'Username') expect((row as { desc?: string }).desc, row.name).toBeTruthy();
		}
	});

	it('uses the German texts for the German locale', () => {
		const names = rows(definitionsFor('de')).map((row) => row.name);
		expect(names).not.toContain('Server URL');
		expect(new Set(names).size).toBe(names.length);
	});
});
