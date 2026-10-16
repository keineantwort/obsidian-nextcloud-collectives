// Persistence of the sync state through a narrow file port (Obsidian adapter in main.ts). Writes only on change.
import type { Logger } from '../util/logger';
import { parseSyncState, serializeSyncState } from './state';
import type { SyncState } from './state';

/** Plain text file access; implemented over app.vault.adapter in main.ts. */
export interface StateFile {
	read(): Promise<string | null>;
	write(text: string): Promise<void>;
}

export class StateStore {
	/** Serialized state as last loaded or written; null if none is known. */
	private lastText: string | null = null;

	/** `log` is optional; without it an invalid stored state is only reported through the return value. */
	constructor(private readonly file: StateFile, private readonly log?: Logger) {}

	/** Parsed state, or null if missing/invalid (invalid → also logged). */
	async load(): Promise<SyncState | null> {
		const text = await this.file.read();
		if (text === null) {
			this.lastText = null;
			return null;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			this.log?.warn('Sync state is not valid JSON; starting without state');
			this.lastText = null;
			return null;
		}
		const state = parseSyncState(raw);
		if (state === null) {
			this.log?.warn('Sync state has an unexpected format; starting without state');
			this.lastText = null;
			return null;
		}
		this.lastText = serializeSyncState(state);
		return state;
	}

	/** Writes only if serializeSyncState(state) differs from the last loaded/written text. Returns true if written. */
	async save(state: SyncState): Promise<boolean> {
		const text = serializeSyncState(state);
		if (text === this.lastText) return false;
		await this.file.write(text);
		this.lastText = text;
		return true;
	}
}
