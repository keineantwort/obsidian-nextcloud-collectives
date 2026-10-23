// Content decision for one page (architecture §7.3): which side's text wins, given the base both sides were last synced from.
// Pure: no Obsidian, no network imports.
import type { PageStatus } from './state';

/** What to do with the text of a page when the local file and/or the remote page may have changed. */
export type ConflictStrategy = 'conflictFile' | 'preferLocal' | 'preferRemote';
export type ContentAction = 'none' | 'push' | 'pull' | 'adoptBase' | 'conflict';

export interface ContentInput {
	/** baseHash from the state; '' = base unknown. */
	baseHash: string;
	/** sha256Hex(toRemote(local file text)). */
	localHash: string;
	/** sha256Hex(canonicalRemote(remote text)); pass baseHash when the remote is known to be unchanged (no GET). */
	remoteHash: string;
	status: PageStatus;
	strategy: ConflictStrategy;
}

/** Action for a page where both sides changed and the strategy decides. */
const STRATEGY_ACTION: Record<ConflictStrategy, ContentAction> = {
	conflictFile: 'conflict',
	preferLocal: 'push',
	preferRemote: 'pull',
};

/**
 * Pure: decides the content action of one page. A page in status 'conflict' or 'collision' is never pushed (architecture §8)
 * and always reports a conflict when both sides changed, whatever the strategy.
 */
export function decideContent(input: ContentInput): ContentAction {
	const localChanged = input.localHash !== input.baseHash;
	const remoteChanged = input.remoteHash !== input.baseHash;
	if (!localChanged && !remoteChanged) return 'none';
	if (localChanged && !remoteChanged) return input.status === 'synced' ? 'push' : 'none';
	if (!localChanged) return 'pull';
	if (input.localHash === input.remoteHash) return 'adoptBase';
	return STRATEGY_ACTION[input.status === 'synced' ? input.strategy : 'conflictFile'];
}
