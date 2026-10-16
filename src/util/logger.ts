export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	at: number;
	level: LogLevel;
	message: string;
	data?: Record<string, string | number | boolean | null>;
}

const DEFAULT_CAPACITY = 500;

/** In-memory ring buffer of log entries; the oldest entries are dropped first. Never log credentials. */
export class Logger {
	private readonly buffer: LogEntry[] = [];

	constructor(
		private readonly capacity: number = DEFAULT_CAPACITY,
		private readonly now: () => number = () => Date.now(),
	) {}

	debug(message: string, data?: LogEntry['data']): void {
		this.add('debug', message, data);
	}

	info(message: string, data?: LogEntry['data']): void {
		this.add('info', message, data);
	}

	warn(message: string, data?: LogEntry['data']): void {
		this.add('warn', message, data);
	}

	error(message: string, data?: LogEntry['data']): void {
		this.add('error', message, data);
	}

	/** All kept entries, oldest first. */
	entries(): LogEntry[] {
		return [...this.buffer];
	}

	private add(level: LogLevel, message: string, data: LogEntry['data']): void {
		const entry: LogEntry = data === undefined ? { at: this.now(), level, message } : { at: this.now(), level, message, data };
		this.buffer.push(entry);
		if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
	}
}
