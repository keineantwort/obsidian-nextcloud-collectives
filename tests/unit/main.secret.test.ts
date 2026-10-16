import { describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import NextcloudCollectivesPlugin from '../../src/main';
import { DEFAULT_SETTINGS, type NcSettings } from '../../src/settings/types';
import { SECRET_ID_PREFIX, isValidSecretId } from '../../src/settings/secretId';

interface Harness {
	plugin: NextcloudCollectivesPlugin;
	secrets: Map<string, string>;
	saved: NcSettings[];
	events: string[];
}

/** Builds a plugin with a Map-backed secret storage and records saves and secret writes in order. */
function setup(initial: Partial<NcSettings> = {}, secrets: Record<string, string> = {}): Harness {
	const events: string[] = [];
	const secretMap = new Map(Object.entries(secrets));
	const app = {
		secretStorage: {
			setSecret(id: string, value: string): void {
				events.push('setSecret');
				secretMap.set(id, value);
			},
			getSecret(id: string): string | null {
				return secretMap.get(id) ?? null;
			},
		},
	};
	// The stub Plugin ignores app and manifest; the fake app only covers what storeAppPassword uses.
	const plugin = new NextcloudCollectivesPlugin(app as unknown as App, {} as PluginManifest);
	const saved: NcSettings[] = [];
	plugin.saveData = async (data: unknown) => {
		events.push('save');
		saved.push(structuredClone(data) as NcSettings);
	};
	plugin.settings = { ...DEFAULT_SETTINGS, ...initial };
	return { plugin, secrets: secretMap, saved, events };
}

describe('storeAppPassword', () => {
	it('ignores an empty password: stores nothing, leaves settings and persistence untouched', async () => {
		const { plugin, secrets, saved, events } = setup();

		await plugin.storeAppPassword('');

		expect(secrets.size).toBe(0);
		expect(plugin.settings).toStrictEqual(DEFAULT_SETTINGS);
		expect(events).toEqual([]);
		expect(saved).toEqual([]);
	});

	it('generates a valid prefixed secret ID on first use and stores the password under it', async () => {
		const { plugin, secrets, saved } = setup();

		await plugin.storeAppPassword('pw-1');

		const id = plugin.settings.appPasswordSecretId;
		expect(id.startsWith(SECRET_ID_PREFIX)).toBe(true);
		expect(isValidSecretId(id)).toBe(true);
		expect(secrets.get(id)).toBe('pw-1');
		expect(saved[saved.length - 1]?.appPasswordSecretId).toBe(id);
	});

	it('persists the new ID before the secret is written', async () => {
		const { plugin, events } = setup();

		await plugin.storeAppPassword('pw-1');

		expect(events).toEqual(['save', 'setSecret']);
	});

	it('reuses an existing valid secret ID without saving settings', async () => {
		const { plugin, secrets, events } = setup({ appPasswordSecretId: 'my-old-id' });

		await plugin.storeAppPassword('pw-1');

		expect(secrets.get('my-old-id')).toBe('pw-1');
		expect(plugin.settings.appPasswordSecretId).toBe('my-old-id');
		expect(events).toEqual(['setSecret']);
	});

	it('replaces an invalid stored secret ID with a generated valid one', async () => {
		const { plugin, secrets } = setup({ appPasswordSecretId: 'Not Valid!' });

		await plugin.storeAppPassword('pw-1');

		const id = plugin.settings.appPasswordSecretId;
		expect(id).not.toBe('Not Valid!');
		expect(isValidSecretId(id)).toBe(true);
		expect(secrets.get(id)).toBe('pw-1');
	});

	it('keeps the same secret ID across two stores and creates no second ID', async () => {
		const { plugin, secrets, saved, events } = setup();

		await plugin.storeAppPassword('pw-1');
		const firstId = plugin.settings.appPasswordSecretId;
		await plugin.storeAppPassword('pw-2');

		expect(plugin.settings.appPasswordSecretId).toBe(firstId);
		expect(secrets.get(firstId)).toBe('pw-2');
		expect(saved).toHaveLength(1);
		expect(events).toEqual(['save', 'setSecret', 'setSecret']);
	});
});

describe('hasStoredAppPassword', () => {
	it('is false when no secret ID is set', () => {
		const { plugin } = setup({ appPasswordSecretId: '' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is false for an invalid secret ID even if a value exists under that string', () => {
		const { plugin } = setup({ appPasswordSecretId: 'Not Valid!' }, { 'Not Valid!': 'pw-1' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is false when the ID is valid but no secret is stored under it', () => {
		const { plugin } = setup({ appPasswordSecretId: 'my-id' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is false when the stored secret is an empty string', () => {
		const { plugin } = setup({ appPasswordSecretId: 'my-id' }, { 'my-id': '' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is true after a password was stored', async () => {
		const { plugin } = setup();

		await plugin.storeAppPassword('pw-1');

		expect(plugin.hasStoredAppPassword()).toBe(true);
	});
});

describe('loadSettings', () => {
	it('takes only known keys with the expected types and drops the password', async () => {
		const { plugin } = setup();
		plugin.loadData = () => Promise.resolve({
			serverUrl: 'https://x',
			username: 5,
			appPasswordSecretId: 'id-1',
			appPassword: 'leak',
		});

		await plugin.loadSettings();

		expect(plugin.settings).toStrictEqual({ serverUrl: 'https://x', username: '', appPasswordSecretId: 'id-1' });
	});

	it('falls back to defaults when no data was saved', async () => {
		const { plugin } = setup();
		plugin.loadData = () => Promise.resolve(null);

		await plugin.loadSettings();

		expect(plugin.settings).toStrictEqual(DEFAULT_SETTINGS);
	});
});

describe('password persistence', () => {
	it('never writes the password into any saved settings snapshot', async () => {
		const { plugin, saved } = setup();

		await plugin.storeAppPassword('pw-secret');
		await plugin.storeAppPassword('pw-secret');

		expect(saved.length).toBeGreaterThan(0);
		for (const snapshot of saved) {
			expect(JSON.stringify(snapshot)).not.toContain('pw-secret');
		}
	});
});
