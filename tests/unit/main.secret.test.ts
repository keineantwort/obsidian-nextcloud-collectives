import { describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import NextcloudCollectivesPlugin from '../../src/main';
import { DEFAULT_SETTINGS, type NcSettings } from '../../src/settings/types';
import { SECRET_ID_PREFIX, isOwnSecretId, isValidSecretId } from '../../src/settings/secretId';
import { ConfigError, NetworkError } from '../../src/util/errors';

interface SetupOptions {
	/** When given, saveData does not finish until this promise resolves (holds the settings save open). */
	saveGate?: Promise<void>;
	/** When given, the first setSecret call throws this error instead of storing the value. */
	firstSetSecretError?: Error;
}

interface Harness {
	plugin: NextcloudCollectivesPlugin;
	secrets: Map<string, string>;
	saved: NcSettings[];
	events: string[];
}

/** Builds a plugin with a Map-backed secret storage and records saves and secret writes in order. */
function setup(initial: Partial<NcSettings> = {}, secrets: Record<string, string> = {}, options: SetupOptions = {}): Harness {
	const events: string[] = [];
	const secretMap = new Map(Object.entries(secrets));
	let setSecretFailure = options.firstSetSecretError;
	const app = {
		secretStorage: {
			setSecret(id: string, value: string): void {
				events.push('setSecret');
				if (setSecretFailure) {
					const failure = setSecretFailure;
					setSecretFailure = undefined;
					throw failure;
				}
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
		if (options.saveGate) await options.saveGate;
		saved.push(structuredClone(data) as NcSettings);
	};
	plugin.settings = { ...DEFAULT_SETTINGS, ...initial };
	return { plugin, secrets: secretMap, saved, events };
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
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

	it('reuses an own secret ID without saving settings', async () => {
		const { plugin, secrets, events } = setup({ appPasswordSecretId: 'nextcloud-collectives-00ff' });

		await plugin.storeAppPassword('pw-1');

		expect(secrets.get('nextcloud-collectives-00ff')).toBe('pw-1');
		expect(plugin.settings.appPasswordSecretId).toBe('nextcloud-collectives-00ff');
		expect(events).toEqual(['setSecret']);
	});

	it('replaces a foreign but valid secret ID with a new own ID and never writes under the foreign ID', async () => {
		const { plugin, secrets, events } = setup({ appPasswordSecretId: 'my-old-id' });

		await plugin.storeAppPassword('pw-1');

		const id = plugin.settings.appPasswordSecretId;
		expect(isOwnSecretId(id)).toBe(true);
		expect(id).not.toBe('my-old-id');
		expect(secrets.get(id)).toBe('pw-1');
		expect(secrets.has('my-old-id')).toBe(false);
		expect(events).toEqual(['save', 'setSecret']);
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

	it('is false for a foreign but valid secret ID even if a value exists under that string', () => {
		const { plugin } = setup({ appPasswordSecretId: 'my-old-id' }, { 'my-old-id': 'pw-1' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is false when the own ID is set but no secret is stored under it', () => {
		const { plugin } = setup({ appPasswordSecretId: 'nextcloud-collectives-00ff' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is false when the stored secret under an own ID is an empty string', () => {
		const { plugin } = setup({ appPasswordSecretId: 'nextcloud-collectives-00ff' }, { 'nextcloud-collectives-00ff': '' });

		expect(plugin.hasStoredAppPassword()).toBe(false);
	});

	it('is true when a non-empty secret is stored under an own ID', () => {
		const { plugin } = setup({ appPasswordSecretId: 'nextcloud-collectives-00ff' }, { 'nextcloud-collectives-00ff': 'pw-1' });

		expect(plugin.hasStoredAppPassword()).toBe(true);
	});

	it('is true after a password was stored', async () => {
		const { plugin } = setup();

		await plugin.storeAppPassword('pw-1');

		expect(plugin.hasStoredAppPassword()).toBe(true);
	});
});

describe('testConnection secret selection', () => {
	const connection = { serverUrl: 'https://cloud.example.com', username: 'alice' };

	it('treats a foreign secret ID as missing and never uses its stored secret', async () => {
		const { plugin } = setup({ ...connection, appPasswordSecretId: 'other-plugin-token' }, { 'other-plugin-token': 'stolen' });

		const err = await captureError(plugin.testConnection());

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'appPassword' });
	});

	it('uses the secret stored under an own ID (the stubbed transport then fails)', async () => {
		const { plugin } = setup({ ...connection, appPasswordSecretId: 'nextcloud-collectives-00ff' }, { 'nextcloud-collectives-00ff': 'pw-1' });

		const err = await captureError(plugin.testConnection());

		expect(err).toBeInstanceOf(NetworkError);
	});

	it('waits for a password store that is still saving settings, so the new password is used', async () => {
		const gate = deferred();
		const { plugin, secrets } = setup(connection, {}, { saveGate: gate.promise });
		void plugin.storeAppPassword('pw-1');
		// Precondition: the store is blocked before the secret is written.
		expect(secrets.size).toBe(0);
		const attempt = captureError(plugin.testConnection());

		gate.resolve();

		expect(await attempt).toBeInstanceOf(NetworkError);
	});

	it('still runs after a failed password store and does not surface the storage error', async () => {
		const storageError = new Error('keychain locked');
		const { plugin } = setup(connection, {}, { firstSetSecretError: storageError });
		await expect(plugin.storeAppPassword('pw-1')).rejects.toBe(storageError);

		const err = await captureError(plugin.testConnection());

		expect(err).toBeInstanceOf(ConfigError);
		expect(err).toMatchObject({ field: 'appPassword' });
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
