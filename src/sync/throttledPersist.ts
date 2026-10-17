// Throttled state writes (PLAN §14 M9): the executor reports every changed operation; serializing and writing the whole
// state each time is O(N²) for a first sync with N pages. Lazy saves are written at most once per interval; saves that
// protect against duplicates (new IDs on the server, conflict copies) and the end of a run are written at once.
import type { SyncState } from './state';

export type PersistMode = 'now' | 'lazy';

export interface ThrottledPersist {
	persist(state: SyncState, mode?: PersistMode): Promise<void>;
	/** Writes the last reported state if a lazy save is still pending. Call at the end of a run and before an abort. */
	flush(): Promise<void>;
}

/** Interval between lazy writes (ms). A crash loses at most this much progress; the next run derives it again. */
export const LAZY_INTERVAL_MS = 1000;

export function createThrottledPersist(
	save: (state: SyncState) => Promise<unknown>,
	now: () => number = () => Date.now(),
	intervalMs: number = LAZY_INTERVAL_MS,
): ThrottledPersist {
	let pending: SyncState | null = null;
	let lastWriteAt = Number.NEGATIVE_INFINITY;
	const write = async (state: SyncState): Promise<void> => {
		pending = null;
		lastWriteAt = now();
		await save(state);
	};
	return {
		async persist(state, mode = 'now') {
			if (mode === 'lazy' && now() - lastWriteAt < intervalMs) {
				pending = state;
				return;
			}
			await write(state);
		},
		async flush() {
			if (pending !== null) await write(pending);
		},
	};
}
