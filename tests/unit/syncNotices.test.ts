import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import type { PullResult } from '../../src/sync/types';
import { alreadyRunningNotice, describePullOutcome, describeSyncError, formatPullResult } from '../../src/ui/syncNotices';
import { ApiChangedError, AuthError, ConfigError, NetworkError, ServerError } from '../../src/util/errors';

const en = createTranslator('en');
const de = createTranslator('de');

const EMPTY: PullResult = { created: 0, updated: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0 };

function result(partial: Partial<PullResult>): PullResult {
	return { ...EMPTY, ...partial };
}

describe('formatPullResult', () => {
	it('says that no pages were found when every counter is 0', () => {
		const spec = formatPullResult(EMPTY, en);

		expect(spec).toEqual({ lines: ['Sync complete. No pages found in your collectives.'], level: 'info' });
	});

	it('says the page is up to date for a single unchanged page', () => {
		const spec = formatPullResult(result({ unchanged: 1 }), en);

		expect(spec).toEqual({ lines: ['Sync complete. The page is up to date.'], level: 'info' });
	});

	it('says how many pages are up to date', () => {
		const spec = formatPullResult(result({ unchanged: 12 }), en);

		expect(spec).toEqual({ lines: ['Sync complete. All 12 pages are up to date.'], level: 'info' });
	});

	it('lists the non-zero counters on one line', () => {
		const spec = formatPullResult(result({ created: 3, unchanged: 12 }), en);

		expect(spec).toEqual({ lines: ['Sync complete. New: 3 · Unchanged: 12'], level: 'info' });
	});

	it('omits counters that are 0', () => {
		const spec = formatPullResult(result({ created: 1, updated: 0, metaUpdated: 0, unchanged: 0 }), en);

		expect(spec.lines[0]).toBe('Sync complete. New: 1');
		expect(spec.lines.join('\n')).not.toContain('Updated: 0');
	});

	it('lists updated and metadata-only counters in German', () => {
		const spec = formatPullResult(result({ updated: 2, metaUpdated: 1 }), de);

		expect(spec.lines[0]).toBe('Synchronisierung abgeschlossen. Aktualisiert: 2 · Nur Metadaten: 1');
	});

	it('puts a single conflict on its own line, with the conflict label, as a warning', () => {
		const spec = formatPullResult(result({ conflicts: 1 }), en);

		expect(spec.lines).toHaveLength(2);
		expect(spec.lines[1]).toContain('Conflict');
		expect(spec.lines[1]).toBe(
			'1 conflict: your file was kept, and the server version was saved next to it with “Conflict” in its name.',
		);
		expect(spec.level).toBe('warning');
	});

	it('uses the German conflict label in German', () => {
		const spec = formatPullResult(result({ conflicts: 1 }), de);

		expect(spec.lines[1]).toContain('Konflikt');
		expect(spec.lines[1]).toContain('„Konflikt“');
	});

	it('pluralises several conflicts', () => {
		const spec = formatPullResult(result({ conflicts: 2 }), en);

		expect(spec.lines[1]).toContain('2 conflicts');
		expect(spec.level).toBe('warning');
	});

	it('states only the completion in the first line when there are only conflicts', () => {
		const spec = formatPullResult(result({ conflicts: 1 }), en);

		expect(spec.lines[0]).toBe('Sync complete.');
	});

	it('reports a single failed page as a warning', () => {
		const spec = formatPullResult(result({ failed: 1 }), en);

		expect(spec.lines[1]).toBe('1 page could not be synced. It will be retried on the next sync.');
		expect(spec.level).toBe('warning');
	});

	it('reports several failed pages as a warning', () => {
		const spec = formatPullResult(result({ failed: 3 }), de);

		expect(spec.lines[1]).toBe('3 Seiten konnten nicht synchronisiert werden. Sie werden bei der nächsten Synchronisierung erneut versucht.');
		expect(spec.level).toBe('warning');
	});

	it('keeps conflicts and failures on separate lines with the summary first', () => {
		const spec = formatPullResult(result({ created: 1, conflicts: 1, failed: 2 }), en);

		expect(spec.lines).toHaveLength(3);
		expect(spec.lines[0]).toBe('Sync complete. New: 1');
		expect(spec.lines[1]).toContain('conflict');
		expect(spec.lines[2]).toContain('2 pages could not be synced');
		expect(spec.level).toBe('warning');
	});

	it('uses the info level when nothing went wrong', () => {
		expect(formatPullResult(result({ created: 2, updated: 1 }), en).level).toBe('info');
	});
});

describe('describePullOutcome', () => {
	it('shows a cancelled run as an info notice', () => {
		const spec = describePullOutcome({ kind: 'cancelled' }, en);

		expect(spec).toEqual({ lines: ['Sync cancelled. Nothing was changed.'], level: 'info' });
	});

	it('shows a server mismatch as a sticky error that names the stored server', () => {
		const spec = describePullOutcome({ kind: 'serverMismatch', stateServer: 'https://old.example.com' }, en);

		expect(spec.level).toBe('error');
		expect(spec.lines).toHaveLength(1);
		expect(spec.lines[0]).toContain('https://old.example.com');
	});

	it('formats a finished run through formatPullResult', () => {
		const spec = describePullOutcome({ kind: 'done', result: result({ created: 1 }), skips: [] }, en);

		expect(spec).toEqual({ lines: ['Sync complete. New: 1'], level: 'info' });
	});
});

describe('describeSyncError', () => {
	it('adds the settings hint for an authentication error', () => {
		const spec = describeSyncError(new AuthError(401), en);

		expect(spec.level).toBe('error');
		expect(spec.lines[0]).toMatch(/^Sync stopped\. /);
		expect(spec.lines[1]).toBe('You can change this in the plugin settings.');
	});

	it('adds the settings hint for a configuration error', () => {
		const spec = describeSyncError(new ConfigError('appPassword', 'missing'), en);

		expect(spec.lines).toHaveLength(2);
		expect(spec.lines[1]).toBe('You can change this in the plugin settings.');
	});

	it('gives no settings hint for a network error', () => {
		const spec = describeSyncError(new NetworkError('x'), en);

		expect(spec.lines).toHaveLength(1);
		expect(spec.lines[0]).toContain('cannot be reached');
	});

	it('uses the sync text for an unexpected API response, not the connection text', () => {
		const spec = describeSyncError(new ApiChangedError('x'), en);

		expect(spec.lines[0]).toContain('Unexpected response from the server. The server URL may be wrong');
		expect(spec.lines[0]).not.toContain('Is the server URL correct');
	});

	it('uses the sync unknown text and never the raw message of an unknown error', () => {
		const spec = describeSyncError(new Error('secret-token'), en);

		expect(spec.lines[0]).toBe('Sync stopped. Unknown error during sync.');
		expect(spec.lines.join('\n')).not.toContain('secret-token');
	});

	it('includes the HTTP status of a server error', () => {
		const spec = describeSyncError(new ServerError(503), en);

		expect(spec.lines[0]).toContain('503');
	});
});

describe('alreadyRunningNotice', () => {
	it('is an info notice', () => {
		expect(alreadyRunningNotice(de)).toEqual({ lines: ['Es läuft bereits eine Synchronisierung.'], level: 'info' });
	});
});
