import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { formatClock, statusBarView } from '../../src/ui/statusBar';
import type { LastRun } from '../../src/ui/statusBar';

const en = createTranslator('en');
const de = createTranslator('de');
const at = new Date(2026, 9, 16, 9, 5).getTime();
const success: LastRun = { kind: 'success', at };
const failed: LastRun = { kind: 'failed', at };

describe('formatClock', () => {
	it('formats local time as zero-padded HH:mm', () => {
		expect(formatClock(at)).toBe('09:05');
		expect(formatClock(new Date(2026, 0, 1, 0, 0).getTime())).toBe('00:00');
		expect(formatClock(new Date(2026, 0, 1, 23, 59).getTime())).toBe('23:59');
	});
});

describe('statusBarView', () => {
	it('shows a dash and asks for a sync when nothing ran yet', () => {
		const view = statusBarView({ running: false, lastRun: null, openConflicts: 0 }, en);

		expect(view).toEqual({
			text: 'NC –',
			ariaLabel: 'Nextcloud Collectives: not synced since Obsidian started. Click to sync now.',
			clickable: true,
			action: 'sync',
		});
	});

	it('shows the time of the last successful sync', () => {
		const view = statusBarView({ running: false, lastRun: success, openConflicts: 0 }, en);

		expect(view.text).toBe('NC ✓ 09:05');
		expect(view.ariaLabel).toBe('Nextcloud Collectives: last sync at 09:05. Click to sync now.');
		expect(view.action).toBe('sync');
	});

	it('shows the open conflicts instead of the success state and opens them on click', () => {
		const view = statusBarView({ running: false, lastRun: success, openConflicts: 2 }, en);

		expect(view.text).toBe('NC ⚠︎ 2');
		expect(view.ariaLabel).toBe('Nextcloud Collectives: last sync at 09:05. 2 open conflicts. Click to show conflicts.');
		expect(view.action).toBe('openConflicts');
		expect(view.clickable).toBe(true);
	});

	it('uses the singular for one open conflict', () => {
		const view = statusBarView({ running: false, lastRun: success, openConflicts: 1 }, en);

		expect(view.ariaLabel).toContain('1 open conflict.');
	});

	it('shows the running state without a click action when no conflict is open', () => {
		const view = statusBarView({ running: true, lastRun: null, openConflicts: 0 }, en);

		expect(view).toEqual({
			text: 'NC ⟳',
			ariaLabel: 'Nextcloud Collectives: sync in progress.',
			clickable: false,
			action: 'none',
		});
	});

	it('keeps the conflict click action while a sync is running', () => {
		const view = statusBarView({ running: true, lastRun: success, openConflicts: 2 }, en);

		expect(view.text).toBe('NC ⟳');
		expect(view.ariaLabel.endsWith('2 open conflicts. Click to show conflicts.')).toBe(true);
		expect(view.clickable).toBe(true);
		expect(view.action).toBe('openConflicts');
	});

	it('shows the failed state with a click to sync again', () => {
		const view = statusBarView({ running: false, lastRun: failed, openConflicts: 0 }, en);

		expect(view).toEqual({
			text: 'NC ✕',
			ariaLabel: 'Nextcloud Collectives: the last sync at 09:05 failed. Click to sync now.',
			clickable: true,
			action: 'sync',
		});
	});

	it('opens the conflicts rather than syncing after a failed run with a conflict', () => {
		const view = statusBarView({ running: false, lastRun: failed, openConflicts: 1 }, en);

		expect(view.text).toBe('NC ✕');
		expect(view.action).toBe('openConflicts');
		expect(view.ariaLabel).toContain('1 open conflict.');
	});

	it('uses the German texts for a successful run with two conflicts', () => {
		const view = statusBarView({ running: false, lastRun: success, openConflicts: 2 }, de);

		expect(view.ariaLabel).toBe(
			'Nextcloud Collectives: zuletzt synchronisiert um 09:05. 2 offene Konflikte. Klicken, um die Konflikte anzuzeigen.',
		);
	});

	it('has no unfilled placeholder in any state, in English and German', () => {
		const states = [
			{ running: false, lastRun: null, openConflicts: 0 },
			{ running: false, lastRun: success, openConflicts: 0 },
			{ running: false, lastRun: success, openConflicts: 1 },
			{ running: false, lastRun: success, openConflicts: 3 },
			{ running: true, lastRun: null, openConflicts: 0 },
			{ running: true, lastRun: success, openConflicts: 2 },
			{ running: false, lastRun: failed, openConflicts: 0 },
			{ running: false, lastRun: failed, openConflicts: 1 },
		];
		for (const t of [en, de]) {
			for (const input of states) {
				const view = statusBarView(input, t);
				expect(view.text).not.toContain('{');
				expect(view.ariaLabel).not.toContain('{');
			}
		}
	});
});
