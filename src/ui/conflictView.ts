// Pure helpers for the conflict modal: texts, diff collapsing and focus rules. No 'obsidian' import.
import type { Translator } from '../i18n';
import type { ConflictEntry } from '../sync/conflicts';
import type { DiffLine } from '../util/diff';

export type DiffRow = { kind: 'same' | 'removed' | 'added'; text: string } | { kind: 'skipped'; count: number };

export interface ConflictDescription {
	/** Basename of localPath without ".md". */
	name: string;
	/** Full localPath, shown muted. */
	path: string;
	explanation: string;
	keepLocalEffect: string;
	takeRemoteEffect: string;
	/** Trash note, or null when there is no conflict copy. */
	trashNote: string | null;
	laterEffect: string;
}

/** Unchanged lines shown next to each change. */
const DEFAULT_CONTEXT = 3;

/** Stable key of a conflict entry; the same pageId in two collectives gives two keys. */
export function entryKey(e: ConflictEntry): string {
	return `${String(e.collectiveId)}:${String(e.pageId)}`;
}

/** Splits a vault path at the last '/'; the folder is '' for a file in the root. */
export function splitPath(path: string): { folder: string; file: string } {
	const index = path.lastIndexOf('/');
	if (index === -1) return { folder: '', file: path };
	return { folder: path.slice(0, index), file: path.slice(index + 1) };
}

export function describeConflict(e: ConflictEntry, t: Translator): ConflictDescription {
	const name = splitPath(e.localPath).file.replace(/\.md$/, '');
	const copy = e.conflictPath === null ? '' : splitPath(e.conflictPath).file;
	const collision = e.status === 'collision';
	let explanation: string;
	if (collision) {
		explanation = copy === '' ? t('conflicts.explain.collisionNoCopy') : t('conflicts.explain.collision', { copy });
	} else {
		explanation = copy === '' ? t('conflicts.explain.conflictNoCopy') : t('conflicts.explain.conflict', { copy });
	}
	return {
		name,
		path: e.localPath,
		explanation,
		keepLocalEffect: collision ? t('conflicts.effect.keepLocalCollision') : t('conflicts.effect.keepLocal'),
		takeRemoteEffect: collision ? t('conflicts.effect.takeRemoteCollision') : t('conflicts.effect.takeRemote'),
		trashNote: copy === '' ? null : t('conflicts.effect.trash', { copy }),
		laterEffect: t('conflicts.effect.later'),
	};
}

/** Shown in place of the diff when the conflict copy is missing from the vault (or there is none). */
export function remoteUnavailableMessage(e: ConflictEntry, t: Translator): string {
	if (e.conflictPath === null) return t('conflicts.diff.noCopy');
	return t('conflicts.diff.remoteMissing', { copy: splitPath(e.conflictPath).file });
}

export function hasChanges(lines: readonly DiffLine[]): boolean {
	return lines.some((line) => line.kind !== 'same');
}

/**
 * Collapses runs of 'same' lines, keeping `context` lines next to each change. A run is only hidden if at least
 * two of its lines would be hidden. A run at the start keeps its last lines, a run at the end its first lines,
 * a run between two changes both. An input without any change keeps its first `context` lines.
 */
export function diffRows(lines: readonly DiffLine[], context: number = DEFAULT_CONTEXT): DiffRow[] {
	const rows: DiffRow[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;
		if (line.kind !== 'same') {
			rows.push({ kind: line.kind, text: line.text });
			i++;
			continue;
		}
		let end = i;
		while (end < lines.length && lines[end]?.kind === 'same') end++;
		const runLength = end - i;
		const atStart = i === 0;
		const atEnd = end === lines.length;
		let keepHead = !atStart || atEnd ? context : 0;
		let keepTail = !atEnd ? context : 0;
		keepHead = Math.min(keepHead, runLength);
		keepTail = Math.min(keepTail, runLength - keepHead);
		const hidden = runLength - keepHead - keepTail;
		const pushSame = (from: number, to: number): void => {
			for (let k = from; k < to; k++) rows.push({ kind: 'same', text: lines[k]?.text ?? '' });
		};
		if (hidden >= 2) {
			pushSame(i, i + keepHead);
			rows.push({ kind: 'skipped', count: hidden });
			pushSame(end - keepTail, end);
		} else {
			pushSame(i, end);
		}
		i = end;
	}
	return rows;
}

/** Index to focus after one entry was removed; null when the list is empty. */
export function nextFocusIndex(resolvedIndex: number, remaining: number): number | null {
	if (remaining === 0) return null;
	return Math.min(resolvedIndex, remaining - 1);
}

/** Live-region text after a choice. `reappeared` = the server changed again, so the page is open once more. */
export function resolutionAnnouncement(name: string, remaining: number, reappeared: boolean, t: Translator): string {
	if (reappeared) return t('conflicts.reappeared', { name });
	if (remaining === 0) return t('conflicts.allResolved');
	const left = remaining === 1 ? t('conflicts.remaining.one') : t('conflicts.remaining.other', { count: remaining });
	return t('conflicts.resolved', { name, remaining: left });
}
