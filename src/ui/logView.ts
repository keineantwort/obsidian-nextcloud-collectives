// Text form of the log, shared by the log modal and the copy button. Pure: no Obsidian, no DOM.
import type { LogEntry } from '../util/logger';

/** `2026-10-18T09:37:28.000Z INFO  Sync failed error=NetworkError` – one line per entry; line breaks in values are escaped. */
export function formatLogEntry(entry: LogEntry): string {
	const data = entry.data === undefined
		? ''
		: Object.entries(entry.data).map(([key, value]) => ` ${key}=${String(value)}`).join('');
	const level = entry.level.toUpperCase().padEnd(5);
	return `${new Date(entry.at).toISOString()} ${level} ${entry.message}${data}`.replace(/\r?\n/g, '\\n');
}

/** The whole log as text, oldest entry first. Empty string for an empty log. */
export function formatLog(entries: readonly LogEntry[]): string {
	return entries.map(formatLogEntry).join('\n');
}
