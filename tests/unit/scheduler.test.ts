import { describe, expect, it } from 'vitest';
import { FOREGROUND_MIN_GAP_MS, STARTUP_DELAY_MS, SyncScheduler } from '../../src/sync/scheduler';
import type { AutoTrigger, SchedulerConfig, Timers } from '../../src/sync/scheduler';

/** Fake clock: timers fire only when the test advances time. */
function fakeClock() {
	let now = 0;
	let nextId = 1;
	const timeouts = new Map<number, { at: number; fn: () => void }>();
	const intervals = new Map<number, { every: number; next: number; fn: () => void }>();
	const timers: Timers = {
		setTimeout: (fn, ms) => { const id = nextId++; timeouts.set(id, { at: now + ms, fn }); return id; },
		clearTimeout: (h) => { timeouts.delete(h as number); },
		setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { every: ms, next: now + ms, fn }); return id; },
		clearInterval: (h) => { intervals.delete(h as number); },
	};
	const advance = (ms: number): void => {
		const target = now + ms;
		for (;;) {
			const due = [
				...[...timeouts.entries()].filter(([, t]) => t.at <= target).map(([id, t]) => ({ id, at: t.at, kind: 'to' as const })),
				...[...intervals.entries()].filter(([, t]) => t.next <= target).map(([id, t]) => ({ id, at: t.next, kind: 'iv' as const })),
			].sort((a, b) => a.at - b.at)[0];
			if (due === undefined) break;
			now = due.at;
			if (due.kind === 'to') {
				const t = timeouts.get(due.id);
				timeouts.delete(due.id);
				t?.fn();
			} else {
				const t = intervals.get(due.id);
				if (t) { t.next += t.every; t.fn(); }
			}
		}
		now = target;
	};
	return { timers, advance, now: () => now };
}

const CONFIG: SchedulerConfig = { intervalMinutes: 5, syncOnStartup: true, syncOnSave: true, debounceSec: 10 };

function setup(config: SchedulerConfig = CONFIG) {
	const clock = fakeClock();
	const fired: AutoTrigger[] = [];
	const scheduler = new SyncScheduler((t) => fired.push(t), clock.timers, clock.now);
	scheduler.configure(config);
	return { clock, fired, scheduler };
}

describe('SyncScheduler: start and interval', () => {
	it('requests a startup sync shortly after start, not at once', () => {
		const { clock, fired, scheduler } = setup();
		scheduler.start();
		expect(fired).toEqual([]);
		clock.advance(STARTUP_DELAY_MS);
		expect(fired).toEqual(['startup']);
	});

	it('requests no startup sync when stopped before the delay is over', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, intervalMinutes: 0 });
		scheduler.start();
		scheduler.stop();
		clock.advance(STARTUP_DELAY_MS * 2);
		expect(fired).toEqual([]);
	});

	it('requests no startup sync if the setting is off', () => {
		const { fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false });
		scheduler.start();
		expect(fired).toEqual([]);
	});

	it('requests a sync every interval after start, not before', () => {
		const { clock, fired, scheduler } = setup();
		scheduler.start();
		clock.advance(5 * 60_000 - 1);
		expect(fired).toEqual(['startup']);
		clock.advance(1);
		expect(fired).toEqual(['startup', 'interval']);
		clock.advance(5 * 60_000);
		expect(fired).toEqual(['startup', 'interval', 'interval']);
	});

	it('requests no interval sync with interval 0', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, intervalMinutes: 0, syncOnStartup: false });
		scheduler.start();
		clock.advance(24 * 60 * 60_000);
		expect(fired).toEqual([]);
	});

	it('applies a new interval from configure on', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false });
		scheduler.start();
		scheduler.configure({ ...CONFIG, syncOnStartup: false, intervalMinutes: 1 });
		clock.advance(60_000);
		expect(fired).toEqual(['interval']);
	});

	it('stops the interval with intervalMinutes 0 set later', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false });
		scheduler.start();
		scheduler.configure({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		clock.advance(60 * 60_000);
		expect(fired).toEqual([]);
	});

	it('does nothing before start (layout not ready)', () => {
		const { clock, fired, scheduler } = setup();
		scheduler.noteChanged();
		scheduler.noteForeground();
		clock.advance(60 * 60_000);
		expect(fired).toEqual([]);
	});

	it('stops all triggers on stop', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false });
		scheduler.start();
		scheduler.noteChanged();
		scheduler.stop();
		clock.advance(60 * 60_000);
		expect(fired).toEqual([]);
	});
});

describe('SyncScheduler: debounce after changes', () => {
	it('requests one sync after the quiet period', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		scheduler.start();
		scheduler.noteChanged();
		clock.advance(9_999);
		expect(fired).toEqual([]);
		clock.advance(1);
		expect(fired).toEqual(['save']);
	});

	it('restarts the quiet period with every change', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		scheduler.start();
		scheduler.noteChanged();
		clock.advance(8_000);
		scheduler.noteChanged();
		clock.advance(8_000);
		expect(fired).toEqual([]);
		clock.advance(2_000);
		expect(fired).toEqual(['save']);
	});

	it('ignores changes with syncOnSave off', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0, syncOnSave: false });
		scheduler.start();
		scheduler.noteChanged();
		clock.advance(60_000);
		expect(fired).toEqual([]);
	});

	it('drops a pending debounce when syncOnSave is turned off', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		scheduler.start();
		scheduler.noteChanged();
		scheduler.configure({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0, syncOnSave: false });
		clock.advance(60_000);
		expect(fired).toEqual([]);
	});

	it('uses the configured debounce time', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0, debounceSec: 3 });
		scheduler.start();
		scheduler.noteChanged();
		clock.advance(3_000);
		expect(fired).toEqual(['save']);
	});
});

describe('SyncScheduler: foreground', () => {
	it('requests a sync when the app comes back after a while', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		scheduler.start();
		clock.advance(FOREGROUND_MIN_GAP_MS);
		scheduler.noteForeground();
		expect(fired).toEqual(['foreground']);
	});

	it('ignores foreground events right after another request', () => {
		const { clock, fired, scheduler } = setup();
		scheduler.start();
		clock.advance(STARTUP_DELAY_MS);
		clock.advance(FOREGROUND_MIN_GAP_MS - 1);
		scheduler.noteForeground();
		expect(fired).toEqual(['startup']);
	});

	it('ignores a burst of foreground events', () => {
		const { clock, fired, scheduler } = setup({ ...CONFIG, syncOnStartup: false, intervalMinutes: 0 });
		scheduler.start();
		clock.advance(FOREGROUND_MIN_GAP_MS);
		scheduler.noteForeground();
		scheduler.noteForeground();
		expect(fired).toEqual(['foreground']);
	});
});
