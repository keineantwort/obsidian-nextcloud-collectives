import type { Translator } from '../i18n';
import type { Skip, SyncResult, SyncRunOutcome } from '../sync/types';
import { describeConnectionError } from '../settings/connectionMessages';
import { ApiChangedError, AuthError, ConfigError } from '../util/errors';

/** 'info' = auto-hide (Obsidian default duration); 'warning'/'error' = stays until dismissed (WCAG 2.2.1). */
export type NoticeLevel = 'info' | 'warning' | 'error';
/** One notice; each line is rendered as its own block. Plain text only, never HTML. */
export interface SyncNoticeSpec { lines: string[]; level: NoticeLevel; }

const DETAIL_SEPARATOR = ' · ';

/** Notice text for a finished sync. Conflicts and failures get their own sentence on a separate line. */
export function formatSyncResult(result: SyncResult, pages: number, t: Translator, skips: readonly Skip[] = []): SyncNoticeSpec {
	const changed =
		result.created + result.updated + result.pushed + result.metaUpdated + result.conflicts + result.failed +
		result.uploaded + result.moved + result.trashed + result.removed + result.restored;
	const lines: string[] = [];
	if (changed === 0) {
		lines.push(upToDate(pages, t));
	} else {
		const details: string[] = [];
		if (result.created > 0) details.push(t('sync.result.created', { count: result.created }));
		if (result.updated > 0) details.push(t('sync.result.updated', { count: result.updated }));
		if (result.pushed > 0) details.push(t('sync.result.pushed', { count: result.pushed }));
		if (result.metaUpdated > 0) details.push(t('sync.result.metaUpdated', { count: result.metaUpdated }));
		if (result.uploaded > 0) details.push(t('sync.result.uploaded', { count: result.uploaded }));
		if (result.moved > 0) details.push(t('sync.result.moved', { count: result.moved }));
		if (result.trashed > 0) details.push(t('sync.result.trashed', { count: result.trashed }));
		if (result.removed > 0) details.push(t('sync.result.removed', { count: result.removed }));
		if (result.restored > 0) details.push(t('sync.result.restored', { count: result.restored }));
		if (result.unchanged > 0) details.push(t('sync.result.unchanged', { count: result.unchanged }));
		// Only conflicts/failures changed: the first line still confirms completion, without a trailing empty detail list.
		lines.push(t('sync.result.done', { details: details.join(DETAIL_SEPARATOR) }).trim());
	}
	if (result.conflicts > 0) {
		const label = t('sync.conflictFileLabel');
		lines.push(result.conflicts === 1
			? t('sync.result.conflicts.one', { label })
			: t('sync.result.conflicts.other', { count: result.conflicts, label }));
		lines.push(t('sync.result.conflicts.hint'));
	}
	if (result.failed > 0) {
		lines.push(result.failed === 1 ? t('sync.result.failed.one') : t('sync.result.failed.other', { count: result.failed }));
	}
	const hints = skipHints(skips, t);
	lines.push(...hints);
	const level: NoticeLevel = result.conflicts > 0 || result.failed > 0 || hints.length > 0 ? 'warning' : 'info';
	return { lines, level };
}

/** One line per kind of skip that the user should know about; quiet skips (deferred questions, ignored folders) have none. */
function skipHints(skips: readonly Skip[], t: Translator): string[] {
	const count = (reason: Skip['reason']): number => skips.filter((skip) => skip.reason === reason).length;
	const lines: string[] = [];
	if (count('unknownId') > 0) lines.push(t('sync.skip.unknownId', { count: count('unknownId') }));
	if (count('remoteMoveWins') > 0) lines.push(t('sync.skip.remoteMoveWins', { count: count('remoteMoveWins') }));
	if (count('renameForbidden') > 0) lines.push(t('sync.skip.renameForbidden'));
	if (count('deleteForbidden') > 0) lines.push(t('sync.skip.deleteForbidden'));
	return lines;
}

/** Notice for every non-throwing outcome of runSync(). */
export function describeSyncOutcome(outcome: SyncRunOutcome, t: Translator): SyncNoticeSpec {
	switch (outcome.kind) {
		case 'done': return formatSyncResult(outcome.result, outcome.pages, t, outcome.skips);
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

/** Idle run: every page in the state is up to date, so the count is the number of linked pages, not the unchanged counter. */
function upToDate(count: number, t: Translator): string {
	if (count === 0) return t('sync.result.upToDate.none');
	return count === 1 ? t('sync.result.upToDate.one') : t('sync.result.upToDate.other', { count });
}
