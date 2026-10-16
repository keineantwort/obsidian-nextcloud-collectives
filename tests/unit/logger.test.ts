import { describe, expect, it } from 'vitest';
import { Logger } from '../../src/util/logger';

describe('Logger ring buffer', () => {
	it('keeps only the last `capacity` entries, oldest first', () => {
		const logger = new Logger(3, () => 0);
		for (const message of ['m1', 'm2', 'm3', 'm4', 'm5']) logger.info(message);
		expect(logger.entries().map((e) => e.message)).toEqual(['m3', 'm4', 'm5']);
	});

	it('keeps at most 500 entries by default', () => {
		const logger = new Logger(undefined, () => 0);
		for (let i = 1; i <= 501; i++) logger.debug(`m${i}`);
		const entries = logger.entries();
		expect(entries).toHaveLength(500);
		expect(entries[0]?.message).toBe('m2');
	});

	it('records the level of each method', () => {
		const logger = new Logger(10, () => 0);
		logger.debug('a');
		logger.info('b');
		logger.warn('c');
		logger.error('d');
		expect(logger.entries().map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
	});

	it('takes the timestamp from the injected clock', () => {
		let t = 1000;
		const logger = new Logger(10, () => t);
		logger.info('first');
		t = 2000;
		logger.info('second');
		expect(logger.entries().map((e) => e.at)).toEqual([1000, 2000]);
	});

	it('stores the data object of a warning unchanged', () => {
		const logger = new Logger(10, () => 1000);
		logger.warn('Seite übersprungen', { pageId: 5, ok: true, note: null });
		expect(logger.entries()[0]).toEqual({
			at: 1000,
			level: 'warn',
			message: 'Seite übersprungen',
			data: { pageId: 5, ok: true, note: null },
		});
	});
});
