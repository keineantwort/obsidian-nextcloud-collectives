import { describe, expect, it } from 'vitest';
import { CredentialsStore, type SecretIdHost, type SecretStore } from '../../src/settings/credentialsStore';
import { buildSecretId, isOwnSecretId } from '../../src/settings/secretId';

const OWN_ID = 'nextcloud-collectives-00ff';
const FIXED_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
const GENERATED_ID = 'nextcloud-collectives-deadbeef01020304';

interface FakeOptions {
	/** Secret ID currently held by the settings host. */
	secretId?: string;
	/** Secrets already stored, keyed by secret ID. */
	secrets?: Record<string, string>;
	/** When set, the first setSecret call throws this error and stores nothing. */
	setSecretError?: Error;
	/** When set, setSecretId rejects with this error and the ID is not changed. */
	setSecretIdError?: Error;
	/** When set, setSecretId waits for this promise before it updates the held ID. */
	idWriteGate?: Promise<void>;
}

interface Harness {
	store: CredentialsStore;
	/** Secret storage content, keyed by secret ID. */
	secrets: Map<string, string>;
	/** Ordered record of setSecretId and setSecret calls, e.g. 'setSecret(<id>)'. */
	events: string[];
	/** Every ID passed to setSecretId, in call order. */
	idWrites: string[];
	/** The secret ID the settings host holds right now. */
	currentId: () => string;
}

/** Builds a CredentialsStore over a Map-backed secret storage and a recording settings host. */
function harness(options: FakeOptions = {}): Harness {
	const events: string[] = [];
	const idWrites: string[] = [];
	const secrets = new Map(Object.entries(options.secrets ?? {}));
	let heldId = options.secretId ?? '';
	let pendingSetSecretError = options.setSecretError;

	const host: SecretIdHost = {
		getSecretId: () => heldId,
		async setSecretId(id: string): Promise<void> {
			events.push(`setSecretId(${id})`);
			idWrites.push(id);
			if (options.idWriteGate) await options.idWriteGate;
			if (options.setSecretIdError) throw options.setSecretIdError;
			heldId = id;
		},
	};

	const secretStore: SecretStore = {
		setSecret(id: string, value: string): void {
			events.push(`setSecret(${id})`);
			if (pendingSetSecretError) {
				const failure = pendingSetSecretError;
				pendingSetSecretError = undefined;
				throw failure;
			}
			secrets.set(id, value);
		},
		getSecret: (id: string) => secrets.get(id) ?? null,
	};

	const store = new CredentialsStore(secretStore, host, () => FIXED_BYTES);
	return { store, secrets, events, idWrites, currentId: () => heldId };
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

describe('CredentialsStore.store', () => {
	it('ignores an empty password: writes no secret, changes no ID and persists nothing', async () => {
		const h = harness({ secretId: OWN_ID, secrets: { [OWN_ID]: 'old' } });

		await h.store.store('');

		expect(h.secrets.get(OWN_ID)).toBe('old');
		expect(h.secrets.size).toBe(1);
		expect(h.idWrites).toEqual([]);
		expect(h.events).toEqual([]);
		expect(h.currentId()).toBe(OWN_ID);
	});

	it('generates an own ID from the random bytes when no ID is set and stores the password under it', async () => {
		const h = harness();

		await h.store.store('pw-1');

		expect(h.currentId()).toBe(GENERATED_ID);
		expect(buildSecretId(FIXED_BYTES)).toBe(GENERATED_ID);
		expect(h.secrets.get(GENERATED_ID)).toBe('pw-1');
	});

	it('persists the generated ID before the secret is written', async () => {
		const h = harness();

		await h.store.store('pw-1');

		expect(h.events).toEqual([`setSecretId(${GENERATED_ID})`, `setSecret(${GENERATED_ID})`]);
	});

	it('rejects with the host error and writes no secret when the ID cannot be persisted', async () => {
		const idError = new Error('settings disk full');
		const h = harness({ setSecretIdError: idError });

		const err = await captureError(h.store.store('pw-1'));

		expect(err).toBe(idError);
		expect(h.secrets.size).toBe(0);
		expect(h.events).toEqual([`setSecretId(${GENERATED_ID})`]);
	});

	it('reuses an own ID without persisting the ID again', async () => {
		const h = harness({ secretId: OWN_ID });

		await h.store.store('pw-1');

		expect(h.idWrites).toEqual([]);
		expect(h.currentId()).toBe(OWN_ID);
		expect(h.secrets.get(OWN_ID)).toBe('pw-1');
		expect(h.events).toEqual([`setSecret(${OWN_ID})`]);
	});

	it.each(['foreign-id', 'nextcloud-collectives-', 'Not Valid!'])(
		'replaces the non-own ID %j with a new own ID and leaves the secret under it untouched',
		async (foreignId) => {
			const h = harness({ secretId: foreignId, secrets: { [foreignId]: 'foreign-secret' } });
			expect(isOwnSecretId(foreignId)).toBe(false);

			await h.store.store('pw-1');

			expect(h.currentId()).toBe(GENERATED_ID);
			expect(h.idWrites).toEqual([GENERATED_ID]);
			expect(h.secrets.get(foreignId)).toBe('foreign-secret');
			expect(h.secrets.get(GENERATED_ID)).toBe('pw-1');
		},
	);

	it('keeps the same ID across two stores and overwrites the secret under it', async () => {
		const h = harness();

		await h.store.store('pw-1');
		await h.store.store('pw-2');

		expect(h.idWrites).toEqual([GENERATED_ID]);
		expect(h.currentId()).toBe(GENERATED_ID);
		expect(h.secrets.get(GENERATED_ID)).toBe('pw-2');
	});
});

describe('CredentialsStore.hasPassword', () => {
	it.each<[string, FakeOptions]>([
		['no ID is set', {}],
		['a foreign ID holds a value', { secretId: 'foreign-id', secrets: { 'foreign-id': 'stolen' } }],
		['an own ID has no stored secret', { secretId: OWN_ID }],
		['an own ID holds an empty secret', { secretId: OWN_ID, secrets: { [OWN_ID]: '' } }],
	])('is false when %s', (_label, options) => {
		const h = harness(options);

		expect(h.store.hasPassword()).toBe(false);
	});

	it('is true when a non-empty secret is stored under an own ID', () => {
		const h = harness({ secretId: OWN_ID, secrets: { [OWN_ID]: 'pw-1' } });

		expect(h.store.hasPassword()).toBe(true);
	});

	it('is true after a password was stored', async () => {
		const h = harness();

		await h.store.store('pw-1');

		expect(h.store.hasPassword()).toBe(true);
	});
});

describe('CredentialsStore.read', () => {
	it('returns the password stored under an own ID', async () => {
		const h = harness({ secretId: OWN_ID, secrets: { [OWN_ID]: 'pw-1' } });

		await expect(h.store.read()).resolves.toBe('pw-1');
	});

	it('returns null for a foreign ID even if a value is stored under that string', async () => {
		const h = harness({ secretId: 'foreign-id', secrets: { 'foreign-id': 'stolen' } });

		await expect(h.store.read()).resolves.toBeNull();
	});

	it('returns null when no ID is set', async () => {
		const h = harness();

		await expect(h.store.read()).resolves.toBeNull();
	});

	it('waits for a pending store and returns the newly stored password', async () => {
		const gate = deferred();
		const h = harness({ idWriteGate: gate.promise });
		const writing = h.store.store('pw-1');
		// Precondition: the ID write is still held open, so no secret exists yet.
		expect(h.secrets.size).toBe(0);

		const reading = h.store.read();
		gate.resolve();
		await writing;

		await expect(reading).resolves.toBe('pw-1');
	});

	it('resolves with null while a store fails, because the secret write threw', async () => {
		const storageError = new Error('keychain locked');
		const h = harness({ setSecretError: storageError });

		const writing = captureError(h.store.store('pw-1'));
		const reading = h.store.read();

		await expect(writing).resolves.toBe(storageError);
		await expect(reading).resolves.toBeNull();
	});

	it('rejects store() with the storage error and read() still resolves afterwards', async () => {
		const storageError = new Error('keychain locked');
		const h = harness({ setSecretError: storageError });

		const err = await captureError(h.store.store('pw-1'));

		expect(err).toBe(storageError);
		await expect(h.store.read()).resolves.toBeNull();
	});
});
