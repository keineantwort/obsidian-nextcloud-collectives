// Vault events for the sync run: which synced files the user changed since the last run (PLAN §7.2), and suppression
// of the modify events that the plugin's own writes raise. No 'obsidian' import: events come in through the plugin.
import { pathKey } from '../mapping/paths';
import type { VaultWriter } from './executor';

/** How long a plugin write suppresses modify events for its file (ms). Pattern from siosig/obsidian-nextcloudsync. */
const DEFAULT_TTL_MS = 5000;

export class DirtyQueue {
	/** pathKey → time (ms) of the last plugin write to that file. */
	private readonly suppressed = new Map<string, number>();
	/** pathKeys modified by the user since the last drain. */
	private dirty = new Set<string>();

	/** `now` in ms; `ttlMs` how long a suppression lasts (default 5000). */
	constructor(
		private readonly now: () => number = () => Date.now(),
		private readonly ttlMs: number = DEFAULT_TTL_MS,
	) {}

	/**
	 * Marks `path` as being written by the plugin: modify events for it are ignored until now() > suppressedAt + ttlMs.
	 * Not consumed by the first event (one write can raise several events).
	 */
	suppress(path: string): void {
		this.suppressed.set(pathKey(path), this.now());
	}

	/** Vault 'modify' event: adds pathKey(path) unless suppressed. Returns true if the change is the user's. */
	noteModified(path: string): boolean {
		const key = pathKey(path);
		if (this.isSuppressed(key)) return false;
		this.dirty.add(key);
		return true;
	}

	/** Vault 'create' event: not dirty (the scan finds new files), but tells whether the user made the file. */
	isUserWrite(path: string): boolean {
		return !this.isSuppressed(pathKey(path));
	}

	/** Vault 'rename' event: a dirty oldPath moves to newPath. */
	noteRenamed(oldPath: string, newPath: string): void {
		const oldKey = pathKey(oldPath);
		if (!this.dirty.has(oldKey)) return;
		this.dirty.delete(oldKey);
		this.dirty.add(pathKey(newPath));
	}

	/** Vault 'delete' event: drops path. */
	noteDeleted(path: string): void {
		this.dirty.delete(pathKey(path));
	}

	/** Puts keys back that a run took but did not finish with (failed or aborted run), so the next run sees them again. */
	requeue(keys: Iterable<string>): void {
		for (const key of keys) this.dirty.add(key);
	}

	/** Returns the dirty pathKeys and clears them. Events after drain() are collected for the next run. */
	drain(): Set<string> {
		const drained = this.dirty;
		this.dirty = new Set<string>();
		return drained;
	}

	private isSuppressed(key: string): boolean {
		const writtenAt = this.suppressed.get(key);
		return writtenAt !== undefined && this.now() <= writtenAt + this.ttlMs;
	}
}

/**
 * Wraps a VaultWriter so that create() and process() call queue.suppress(path) before writing. Other members pass
 * through unchanged; methods are called on the wrapped writer, so class-based writers keep their `this`.
 */
export function suppressingWriter<T extends VaultWriter>(vault: T, queue: DirtyQueue): T {
	return new Proxy(vault, {
		get(target, prop) {
			const value: unknown = Reflect.get(target, prop, target);
			if (typeof value !== 'function') return value;
			const writes = prop === 'create' || prop === 'process';
			return (...args: unknown[]) => {
				const path = args[0];
				if (writes && typeof path === 'string') queue.suppress(path);
				return Reflect.apply(value, target, args) as unknown;
			};
		},
	});
}
