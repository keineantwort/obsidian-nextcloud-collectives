import type { Translator } from '../i18n';
import type { SyncResult, SyncRunOutcome } from '../sync/types';
import { describeConnectionError } from '../settings/connectionMessages';
import { ApiChangedError, AuthError, ConfigError } from '../util/errors';

/** 'info' = auto-hide (Obsidian default duration); 'warning'/'error' = stays until dismissed (WCAG 2.2.1). */
export type NoticeLevel = 'info' | 'warning' | 'error';
/** One notice; each line is rendered as its own block. Plain text only, never HTML. */
export interface SyncNoticeSpec { lines: string[]; level: NoticeLevel; }

const DETAIL_SEPARATOR = ' · ';

/** Notice text for a finished pull. Conflicts and failures get their own sentence on a separate line. */
export function formatSyncResult(result: SyncResult, t: Translator): SyncNoticeSpec {
	const changed = result.created + result.updated + result.metaUpdated + result.conflicts + result.failed;
	const lines: string[] = [];
	if (changed === 0) {
		lines.push(upToDate(result.unchanged, t));
	} else {
		const details: string[] = [];
		if (result.created > 0) details.push(t('sync.result.created', { count: result.created }));
		if (result.updated > 0) details.push(t('sync.result.updated', { count: result.updated }));
		if (result.metaUpdated > 0) details.push(t('sync.result.metaUpdated', { count: result.metaUpdated }));
		if (result.unchanged > 0) details.push(t('sync.result.unchanged', { count: result.unchanged }));
		// Only conflicts/failures changed: the first line still confirms completion, without a trailing empty detail list.
		lines.push(t('sync.result.done', { details: details.join(DETAIL_SEPARATOR) }).trim());
	}
	if (result.conflicts > 0) {
		const label = t('sync.conflictFileLabel');
		lines.push(result.conflicts === 1
			? t('sync.result.conflicts.one', { label })
			: t('sync.result.conflicts.other', { count: result.conflicts, label }));
	}
	if (result.failed > 0) {
		lines.push(result.failed === 1 ? t('sync.result.failed.one') : t('sync.result.failed.other', { count: result.failed }));
	}
	const level: NoticeLevel = result.conflicts > 0 || result.failed > 0 ? 'warning' : 'info';
	return { lines, level };
}

/** Notice for every non-throwing outcome of runSync(). */
export function describeSyncOutcome(outcome: SyncRunOutcome, t: Translator): SyncNoticeSpec {
	switch (outcome.kind) {
		case 'done': return formatSyncResult(outcome.result, t);
		case 'cancelled': return { lines: [t('sync.cancelled')], level: 'info' };
		case 'serverMismatch': return { lines: [t('sync.serverMismatch', { server: outcome.stateServer })], level: 'error' };
		case 'accountMismatch': return { lines: [t('sync.accountMismatch', { user: outcome.stateUser })], level: 'error' };
	}
}

/** Notice for an error thrown by runSync(). Never includes raw error messages (they may contain credentials). */
export function describeSyncError(err: unknown, t: Translator): SyncNoticeSpec {
	const reason = err instanceof ApiChangedError ? t('sync.error.apiChanged') : describeConnectionError(err, t, 'sync.error.unknown');
	const lines = [t('sync.error.stopped', { reason })];
	if (err instanceof ConfigError || err instanceof AuthError) lines.push(t('sync.error.settingsHint'));
	return { lines, level: 'error' };
}

export function alreadyRunningNotice(t: Translator): SyncNoticeSpec {
	return { lines: [t('sync.alreadyRunning')], level: 'info' };
}

function upToDate(count: number, t: Translator): string {
	if (count === 0) return t('sync.result.upToDate.none');
	return count === 1 ? t('sync.result.upToDate.one') : t('sync.result.upToDate.other', { count });
}
