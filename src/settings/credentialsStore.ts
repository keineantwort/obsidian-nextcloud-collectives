import { buildSecretId, isOwnSecretId } from './secretId';

/** Secret storage of Obsidian (app.secretStorage). */
export interface SecretStore { setSecret(id: string, value: string): void; getSecret(id: string): string | null; }

/** Access to the secret ID kept in the plugin settings. */
export interface SecretIdHost {
	/** Current secret ID from the settings. */
	getSecretId(): string;
	/** Stores a new secret ID in the settings and persists them. */
	setSecretId(id: string): Promise<void>;
}

/** Stores and reads the app password. The password only lives in secret storage, under an ID this plugin generated. */
export class CredentialsStore {
	/** Last password write; read() waits for it so a just-entered password is used. Never rejects. */
	private pendingWrite: Promise<void> = Promise.resolve();
	private readonly secrets: SecretStore;
	private readonly host: SecretIdHost;
	private readonly randomBytes: (n: number) => Uint8Array;

	constructor(
		secrets: SecretStore,
		host: SecretIdHost,
		randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
	) {
		this.secrets = secrets;
		this.host = host;
		this.randomBytes = randomBytes;
	}

	/**
	 * Stores the app password in secret storage. Empty input is ignored.
	 * The secret is only written under an ID this plugin generated; any other ID in the settings
	 * (e.g. one chosen earlier in the Obsidian UI or planted in data.json) is replaced by a new one.
	 */
	store(password: string): Promise<void> {
		const write = this.writePassword(password);
		this.pendingWrite = write.catch(() => undefined);
		return write;
	}

	private async writePassword(password: string): Promise<void> {
		if (password === '') return;
		let id = this.host.getSecretId();
		if (!isOwnSecretId(id)) {
			id = buildSecretId(this.randomBytes(8));
			// Persist the ID before the secret is written, so the secret is never stored under an unknown ID.
			await this.host.setSecretId(id);
		}
		this.secrets.setSecret(id, password);
	}

	/** True if a non-empty app password is stored for the current secret ID. */
	hasPassword(): boolean {
		const id = this.host.getSecretId();
		if (!isOwnSecretId(id)) return false;
		const stored = this.secrets.getSecret(id);
		return stored !== null && stored !== '';
	}

	/**
	 * Waits for a pending store() (never rejects because of it), then returns the password under an own secret ID, or null.
	 * A foreign ID in the settings yields null, so no foreign secret is ever read.
	 */
	async read(): Promise<string | null> {
		await this.pendingWrite;
		const id = this.host.getSecretId();
		return isOwnSecretId(id) ? this.secrets.getSecret(id) : null;
	}
}
