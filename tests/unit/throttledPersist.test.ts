import { describe, expect, it } from 'vitest';
import { emptyState } from '../../src/sync/state';
import type { SyncState } from '../../src/sync/state';
import { createThrottledPersist } from '../../src/sync/throttledPersist';

function setup(interval = 1000) {
	let now = 0;
	const saved: SyncState[] = [];
	const persist = createThrottledPersist(async (s) => { saved.push(s); }, () => now, interval);
	return { persist, saved, setNow: (ms: number) => { now = ms; } };
}

describe('createThrottledPersist', () => {
	const state = emptyState('https://nc.example', 'u');

	it('writes the first lazy save at once', async () => {
		const { persist, saved } = setup();
		await persist.persist(state, 'lazy');
		expect(saved).toHaveLength(1);
	});

	it('writes lazy saves inside the interval only once', async () => {
		const { persist, saved, setNow } = setup();
		setNow(5000);
		for (let i = 0; i < 500; i++) {
			setNow(5000 + i);
			await persist.persist(state, 'lazy');
		}
		expect(saved).toHaveLength(1);
	});

	it('writes a lazy save again after the interval', async () => {
		const { persist, saved, setNow } = setup();
		setNow(5000);
		await persist.persist(state, 'lazy');
		setNow(6000);
		await persist.persist(state, 'lazy');
		expect(saved).toHaveLength(2);
	});

	it('writes an immediate save inside the interval', async () => {
		const { persist, saved, setNow } = setup();
		setNow(5000);
		await persist.persist(state, 'lazy');
		await persist.persist(state, 'now');
		await persist.persist(state);
		expect(saved).toHaveLength(3);
	});

	it('flush writes a pending lazy save once and nothing otherwise', async () => {
		const { persist, saved, setNow } = setup();
		setNow(5000);
		await persist.persist(state, 'lazy');
		setNow(5001);
		await persist.persist(state, 'lazy');
		expect(saved).toHaveLength(1);
		await persist.flush();
		expect(saved).toHaveLength(2);
		await persist.flush();
		expect(saved).toHaveLength(2);
	});

	it('flush after an immediate save does not write again', async () => {
		const { persist, saved, setNow } = setup();
		setNow(5000);
		await persist.persist(state, 'lazy');
		setNow(5001);
		await persist.persist(state, 'lazy');
		await persist.persist(state, 'now');
		await persist.flush();
		expect(saved).toHaveLength(2);
	});
});
