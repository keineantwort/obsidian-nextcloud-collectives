import { describe, expect, it } from 'vitest';
import { formatLog, formatLogEntry } from '../../src/ui/logView';

describe('formatLogEntry', () => {
	it('prints time, padded level, message and data', () => {
		expect(formatLogEntry({ at: Date.UTC(2026, 9, 18, 9, 37, 28), level: 'info', message: 'Sync failed', data: { error: 'NetworkError', ms: 12, ok: false } }))
			.toBe('2026-10-18T09:37:28.000Z INFO  Sync failed error=NetworkError ms=12 ok=false');
	});
	it('works without data and with a long level', () => {
		expect(formatLogEntry({ at: 0, level: 'error', message: 'x' })).toBe('1970-01-01T00:00:00.000Z ERROR x');
	});
	it('keeps one entry on one line', () => {
		expect(formatLogEntry({ at: 0, level: 'warn', message: 'a\nb', data: { path: 'c\r\nd' } })).not.toMatch(/[\r\n]/);
	});
});

describe('formatLog', () => {
	it('joins the entries oldest first and is empty for an empty log', () => {
		const lines = formatLog([{ at: 0, level: 'info', message: 'one' }, { at: 1000, level: 'debug', message: 'two' }]).split('\n');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('one');
		expect(lines[1]).toContain('DEBUG two');
		expect(formatLog([])).toBe('');
	});
});
