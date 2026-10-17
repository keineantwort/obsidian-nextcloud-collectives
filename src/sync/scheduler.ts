// Automatic sync triggers (PLAN §7.1): start, interval, debounce after saving, foreground. Obsidian-free; timers are injected.
// The scheduler only decides when to ask for a run; the controller serializes the runs (mutex with re-run flag).

export type AutoTrigger = 'startup' | 'interval' | 'save' | 'foreground';

export interface SchedulerConfig {
	/** Minutes between runs; 0 = no interval. */
	intervalMinutes: number;
	syncOnStartup: boolean;
	syncOnSave: boolean;
	/** Seconds after the last change before a run starts. */
	debounceSec: number;
}

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

/** A foreground event within this time after the last automatic request is ignored (mobile OSes fire it often). */
export const FOREGROUND_MIN_GAP_MS = 30_000;

/** Pause between the ready layout and the startup sync: Obsidian is busy indexing then (mobile first of all). */
export const STARTUP_DELAY_MS = 2000;

export class SyncScheduler {
	private config: SchedulerConfig | null = null;
	private interval: unknown = null;
	private debounce: unknown = null;
	private startup: unknown = null;
	private lastRequestAt = Number.NEGATIVE_INFINITY;
	private started = false;

	constructor(
		private readonly request: (trigger: AutoTrigger) => void,
		private readonly timers: Timers,
		private readonly now: () => number = () => Date.now(),
	) {}

	/** Applies new settings: restarts the interval and drops a pending debounce that is no longer wanted. */
	configure(config: SchedulerConfig): void {
		this.config = config;
		this.clearInterval();
		if (!this.started) return;
		if (config.intervalMinutes > 0) {
			this.interval = this.timers.setInterval(() => { this.fire('interval'); }, config.intervalMinutes * 60_000);
		}
		if (!config.syncOnSave) this.clearDebounce();
	}

	/** Called once the layout is ready: arms the interval and runs the startup sync if wanted. */
	start(): void {
		this.started = true;
		if (this.config === null) return;
		this.configure(this.config);
		if (this.config.syncOnStartup) {
			this.startup = this.timers.setTimeout(() => {
				this.startup = null;
				this.fire('startup');
			}, STARTUP_DELAY_MS);
		}
	}

	/** A synced note changed: the run starts after the quiet period; every further change restarts it. */
	noteChanged(): void {
		if (!this.started || this.config === null || !this.config.syncOnSave) return;
		this.clearDebounce();
		this.debounce = this.timers.setTimeout(() => {
			this.debounce = null;
			this.fire('save');
		}, this.config.debounceSec * 1000);
	}

	/** The app came to the foreground again. */
	noteForeground(): void {
		if (!this.started || this.config === null) return;
		if (this.now() - this.lastRequestAt < FOREGROUND_MIN_GAP_MS) return;
		this.fire('foreground');
	}

	stop(): void {
		this.started = false;
		this.clearInterval();
		this.clearDebounce();
		if (this.startup !== null) this.timers.clearTimeout(this.startup);
		this.startup = null;
	}

	private fire(trigger: AutoTrigger): void {
		this.lastRequestAt = this.now();
		this.request(trigger);
	}

	private clearInterval(): void {
		if (this.interval !== null) this.timers.clearInterval(this.interval);
		this.interval = null;
	}

	private clearDebounce(): void {
		if (this.debounce !== null) this.timers.clearTimeout(this.debounce);
		this.debounce = null;
	}
}
