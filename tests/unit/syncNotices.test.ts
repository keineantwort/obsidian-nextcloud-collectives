import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { emptyResult } from '../../src/sync/types';
import type { SyncResult } from '../../src/sync/types';
import { alreadyRunningNotice, describeSyncOutcome, describeSyncError, formatSyncResult } from '../../src/ui/syncNotices';
import { ApiChangedError, AuthError, ConfigError, NetworkError, ServerError } from '../../src/util/errors';

const en = createTranslator('en');
const de = createTranslator('de');

const EMPTY: SyncResult = emptyResult();

function result(partial: Partial<SyncResult>): SyncResult {
	return { ...EMPTY, ...partial };
}

describe('formatSyncResult', () => {
	it('says that no pages were found when every counter is 0', () => {
		const spec = formatSyncResult(EMPTY, 0, en);

		expect(spec).toEqual({ lines: ['Sync complete. No pages found in your collectives.'], level: 'info' });
	});

	it('says the page is up to date for a single unchanged page', () => {
		const spec = formatSyncResult(result({ unchanged: 1 }), 1, en);

		expect(spec).toEqual({ lines: ['Sync complete. The page is up to date.'], level: 'info' });
	});

	it('says how many pages are up to date', () => {
		const spec = formatSyncResult(result({ unchanged: 12 }), 12, en);

		expect(spec).toEqual({ lines: ['Sync complete. All 12 pages are up to date.'], level: 'info' });
	});

	it('reports the linked pages on an idle run where every counter is 0', () => {
		const spec = formatSyncResult(EMPTY, 12, en);

		expect(spec).toEqual({ lines: ['Sync complete. All 12 pages are up to date.'], level: 'info' });
		expect(spec.lines.join('\n')).not.toContain('No pages found');
	});

	it('lists the non-zero counters on one line', () => {
		const spec = formatSyncResult(result({ created: 3, unchanged: 12 }), 0, en);

		expect(spec).toEqual({ lines: ['Sync complete. New: 3 · Unchanged: 12'], level: 'info' });
	});

	it('omits counters that are 0', () => {
		const spec = formatSyncResult(result({ created: 1, updated: 0, metaUpdated: 0, unchanged: 0 }), 0, en);

		expect(spec.lines[0]).toBe('Sync complete. New: 1');
		expect(spec.lines.join('\n')).not.toContain('Updated: 0');
	});

	it('lists updated and metadata-only counters in German', () => {
		const spec = formatSyncResult(result({ updated: 2, metaUpdated: 1 }), 0, de);

		expect(spec.lines[0]).toBe('Synchronisierung abgeschlossen. Aktualisiert: 2 · Nur Metadaten: 1');
	});

	it('reports emoji and tags sent to the server, and does not call a run with only those idle', () => {
		expect(formatSyncResult(result({ metaPushed: 2 }), 5, en).lines).toEqual(['Sync complete. Emoji/tags sent: 2']);
		expect(formatSyncResult(result({ metaPushed: 1 }), 0, de).lines[0]).toBe('Synchronisierung abgeschlossen. Emoji/Tags gesendet: 1');
	});

	it('warns about notes whose emoji is not a single emoji', () => {
		const spec = formatSyncResult(result({ metaInvalid: 2 }), 5, en);

		expect(spec.level).toBe('warning');
		expect(spec.lines.join('\n')).toContain('2 notes have an emoji property that is not a single emoji');
		expect(formatSyncResult(result({ metaInvalid: 1 }), 5, de).lines.join('\n')).toContain('Eine Notiz hat ein Emoji-Feld');
	});

	it('puts a single conflict on its own line, with the conflict label, as a warning', () => {
		const spec = formatSyncResult(result({ conflicts: 1 }), 0, en);

		expect(spec.lines).toHaveLength(3);
		expect(spec.lines[1]).toContain('Conflict');
		expect(spec.lines[1]).toBe(
			'1 conflict: your file was kept, and the server version was saved next to it with “Conflict” in its name.',
		);
		expect(spec.level).toBe('warning');
	});

	it('adds the hint to the command for deciding conflicts right after the conflict line', () => {
		const spec = formatSyncResult(result({ conflicts: 1 }), 0, en);

		expect(spec.lines[2]).toBe('Use the command “Show conflicts” to decide which version to keep.');
	});

	it('adds the same hint in German after the conflict line', () => {
		const spec = formatSyncResult(result({ conflicts: 2 }), 0, de);

		expect(spec.lines[2]).toBe('Mit dem Befehl „Konflikte anzeigen“ entscheidest du, welche Fassung bleibt.');
	});

	it('shows no conflict hint when there are no conflicts', () => {
		const spec = formatSyncResult(result({ created: 1, failed: 1 }), 0, en);

		expect(spec.lines.join('\n')).not.toContain('Show conflicts');
	});

	it('uses the German conflict label in German', () => {
		const spec = formatSyncResult(result({ conflicts: 1 }), 0, de);

		expect(spec.lines[1]).toContain('Konflikt');
		expect(spec.lines[1]).toContain('„Konflikt“');
	});

	it('pluralises several conflicts', () => {
		const spec = formatSyncResult(result({ conflicts: 2 }), 0, en);

		expect(spec.lines[1]).toContain('2 conflicts');
		expect(spec.level).toBe('warning');
	});

	it('states only the completion in the first line when there are only conflicts', () => {
		const spec = formatSyncResult(result({ conflicts: 1 }), 0, en);

		expect(spec.lines[0]).toBe('Sync complete.');
	});

	it('reports a single failed page as a warning', () => {
		const spec = formatSyncResult(result({ failed: 1 }), 0, en);

		expect(spec.lines[1]).toBe('1 page could not be synced. It will be retried on the next sync.');
		expect(spec.level).toBe('warning');
	});

	it('reports several failed pages as a warning', () => {
		const spec = formatSyncResult(result({ failed: 3 }), 0, de);

		expect(spec.lines[1]).toBe('3 Seiten konnten nicht synchronisiert werden. Sie werden bei der nächsten Synchronisierung erneut versucht.');
		expect(spec.level).toBe('warning');
	});

	it('keeps conflicts and failures on separate lines with the summary first', () => {
		const spec = formatSyncResult(result({ created: 1, conflicts: 1, failed: 2 }), 0, en);

		expect(spec.lines).toHaveLength(4);
		expect(spec.lines[0]).toBe('Sync complete. New: 1');
		expect(spec.lines[1]).toContain('conflict');
		expect(spec.lines[2]).toContain('Show conflicts');
		expect(spec.lines[3]).toContain('2 pages could not be synced');
		expect(spec.level).toBe('warning');
	});

	it('uses the info level when nothing went wrong', () => {
		expect(formatSyncResult(result({ created: 2, updated: 1 }), 0, en).level).toBe('info');
	});
});

describe('describeSyncOutcome', () => {
	it('shows a cancelled run as an info notice', () => {
		const spec = describeSyncOutcome({ kind: 'cancelled' }, en);

		expect(spec).toEqual({ lines: ['Sync cancelled. Nothing was changed.'], level: 'info' });
	});

	it('shows a server mismatch as a sticky error that names the stored server', () => {
		const spec = describeSyncOutcome({ kind: 'serverMismatch', stateServer: 'https://old.example.com' }, en);

		expect(spec.level).toBe('error');
		expect(spec.lines).toHaveLength(1);
		expect(spec.lines[0]).toContain('https://old.example.com');
	});

	it('shows an account mismatch as a sticky error that names the stored account (en)', () => {
		const spec = describeSyncOutcome({ kind: 'accountMismatch', stateUser: 'bob-id', stateServer: 'https://cloud.example.com' }, en);

		expect(spec).toEqual({
			lines: [
				'This vault is already synced with another Nextcloud account (bob-id) on this server. A vault is bound to one account – to use a different account, create a new vault. Nothing was changed.',
			],
			level: 'error',
		});
	});

	it('shows an account mismatch as a sticky error that names the stored account (de)', () => {
		const spec = describeSyncOutcome({ kind: 'accountMismatch', stateUser: 'bob-id', stateServer: 'https://cloud.example.com' }, de);

		expect(spec).toEqual({
			lines: [
				'Dieser Vault wird bereits mit einem anderen Nextcloud-Konto (bob-id) auf diesem Server synchronisiert. Ein Vault ist fest an ein Konto gebunden – für ein anderes Konto bitte einen neuen Vault anlegen. Es wurde nichts geändert.',
			],
			level: 'error',
		});
	});

	it('formats a finished run through formatSyncResult', () => {
		const spec = describeSyncOutcome({ kind: 'done', result: result({ created: 1 }), skips: [], openConflicts: 0, pages: 1 }, en);

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

describe('formatSyncResult: uploads', () => {
	it('reports pushed pages as their own detail in English', () => {
		const spec = formatSyncResult(result({ pushed: 2 }), 0, en);

		expect(spec).toEqual({ lines: ['Sync complete. Uploaded: 2'], level: 'info' });
	});

	it('reports pushed pages as their own detail in German', () => {
		const spec = formatSyncResult(result({ pushed: 2 }), 0, de);

		expect(spec.lines[0]).toBe('Synchronisierung abgeschlossen. Hochgeladen: 2');
	});

	it('counts a pushed page as a change, so the run is not reported as up to date', () => {
		const spec = formatSyncResult(result({ pushed: 1, unchanged: 12 }), 0, en);

		expect(spec.lines[0]).toContain('Uploaded: 1');
		expect(spec.lines[0]).not.toContain('up to date');
	});

	it('shows the upload of a finished run through describeSyncOutcome', () => {
		const spec = describeSyncOutcome({ kind: 'done', result: result({ pushed: 1 }), skips: [], openConflicts: 0, pages: 1 }, en);

		expect(spec).toEqual({ lines: ['Sync complete. Uploaded: 1'], level: 'info' });
	});
});

describe('formatSyncResult: structure', () => {
	const t = createTranslator('en');

	it('lists moves, trash and restores in the details', () => {
		const spec = formatSyncResult(result({ moved: 2, trashed: 1, removed: 3, restored: 1 }), 10, t);

		expect(spec.lines).toEqual(['Sync complete. Moved or renamed: 2 · Moved to the Collectives trash: 1 · Removed here: 3 · Restored: 1']);
		expect(spec.level).toBe('info');
	});

	it('is no idle run when only structure changed', () => {
		expect(formatSyncResult(result({ moved: 1 }), 10, t).lines[0]).not.toContain('up to date');
	});

	it('adds a warning line for files with an unknown page id and for pages moved on both sides', () => {
		const spec = formatSyncResult(result({}), 3, t, [
			{ reason: 'unknownId', pageId: 5 as never, path: 'a.md' },
			{ reason: 'unknownId', pageId: 6 as never, path: 'b.md' },
			{ reason: 'remoteMoveWins', pageId: 7 as never },
		]);

		expect(spec.lines).toEqual([
			'Sync complete. All 3 pages are up to date.',
			'2 notes carry a page ID that is not on the server. They were left alone.',
			'1 page was moved on both sides. The server’s location was used.',
		]);
		expect(spec.level).toBe('warning');
	});

	it('says nothing about postponed questions and ignored folders', () => {
		const spec = formatSyncResult(result({}), 3, t, [{ reason: 'deferred', proposalId: 'deletePage:1' }, { reason: 'folderIgnored', path: 'Neu' }]);

		expect(spec.lines).toEqual(['Sync complete. All 3 pages are up to date.']);
		expect(spec.level).toBe('info');
	});
});

describe('formatSyncResult: attachments', () => {
	it('reports transferred attachments as their own detail in English and German', () => {
		expect(formatSyncResult(result({ attachments: 3 }), 0, en)).toEqual({ lines: ['Sync complete. Attachments: 3'], level: 'info' });
		expect(formatSyncResult(result({ attachments: 3 }), 0, de).lines[0]).toBe('Synchronisierung abgeschlossen. Anhänge: 3');
	});

	it('counts transferred attachments as a change, so the run is not reported as up to date', () => {
		expect(formatSyncResult(result({ attachments: 1 }), 5, en).lines[0]).not.toContain('up to date');
	});
});
