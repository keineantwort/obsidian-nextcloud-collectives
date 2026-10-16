import { describe, expect, it } from 'vitest';
import { decideContent } from '../../src/sync/decide';
import type { ConflictStrategy, ContentInput } from '../../src/sync/decide';
import type { PageStatus } from '../../src/sync/state';

// Hashes are opaque strings here; only their equality matters to the decision.
const BASE = 'hash-base';
const LOCAL = 'hash-local';
const REMOTE = 'hash-remote';
const STRATEGIES: ConflictStrategy[] = ['conflictFile', 'preferLocal', 'preferRemote'];

/** Input where neither side changed since the base; override the sides a test needs. */
function input(over: Partial<ContentInput> = {}): ContentInput {
	return { baseHash: BASE, localHash: BASE, remoteHash: BASE, status: 'synced', strategy: 'conflictFile', ...over };
}

describe('decideContent: neither side changed', () => {
	it('returns none when local and remote both still equal the base', () => {
		expect(decideContent(input())).toBe('none');
	});
});

describe('decideContent: only one side changed', () => {
	it.each(STRATEGIES)('pushes when only the local side changed (strategy %s)', (strategy) => {
		expect(decideContent(input({ localHash: LOCAL, strategy }))).toBe('push');
	});

	it.each(STRATEGIES)('pulls when only the remote side changed (strategy %s)', (strategy) => {
		expect(decideContent(input({ remoteHash: REMOTE, strategy }))).toBe('pull');
	});
});

describe('decideContent: both sides changed', () => {
	it.each(STRATEGIES)('adopts the base when local and remote changed to the same text (strategy %s)', (strategy) => {
		expect(decideContent(input({ localHash: LOCAL, remoteHash: LOCAL, strategy }))).toBe('adoptBase');
	});

	it('reports a conflict for different changes with strategy conflictFile', () => {
		expect(decideContent(input({ localHash: LOCAL, remoteHash: REMOTE, strategy: 'conflictFile' }))).toBe('conflict');
	});

	it('pushes the local text over the remote change with strategy preferLocal', () => {
		expect(decideContent(input({ localHash: LOCAL, remoteHash: REMOTE, strategy: 'preferLocal' }))).toBe('push');
	});

	it('pulls the remote text over the local change with strategy preferRemote', () => {
		expect(decideContent(input({ localHash: LOCAL, remoteHash: REMOTE, strategy: 'preferRemote' }))).toBe('pull');
	});
});

describe('decideContent: unknown base (baseHash \'\')', () => {
	it('adopts the base when both sides hold the same text', () => {
		expect(decideContent(input({ baseHash: '', localHash: LOCAL, remoteHash: LOCAL }))).toBe('adoptBase');
	});

	it('reports a conflict when both sides hold different texts', () => {
		expect(decideContent(input({ baseHash: '', localHash: LOCAL, remoteHash: REMOTE, strategy: 'conflictFile' }))).toBe('conflict');
	});

	it('pushes the local text when the remote hash is empty and the local text is real', () => {
		expect(decideContent(input({ baseHash: '', localHash: LOCAL, remoteHash: '', strategy: 'conflictFile' }))).toBe('push');
	});
});

describe('decideContent: status gate for conflict and collision pages', () => {
	it.each<PageStatus>(['conflict', 'collision'])('never pushes a local-only change on a %s page', (status) => {
		expect(decideContent(input({ status, localHash: LOCAL }))).toBe('none');
	});

	it.each<PageStatus>(['conflict', 'collision'])('still adopts the base on a %s page when both sides are equal', (status) => {
		expect(decideContent(input({ status, localHash: LOCAL, remoteHash: LOCAL, strategy: 'preferLocal' }))).toBe('adoptBase');
	});

	it.each<PageStatus>(['conflict', 'collision'])(
		'reports a conflict on a %s page with strategy preferLocal when both sides changed',
		(status) => {
			expect(decideContent(input({ status, localHash: LOCAL, remoteHash: REMOTE, strategy: 'preferLocal' }))).toBe('conflict');
		},
	);

	it.each<PageStatus>(['conflict', 'collision'])(
		'reports a conflict on a %s page with strategy preferRemote when both sides changed',
		(status) => {
			expect(decideContent(input({ status, localHash: LOCAL, remoteHash: REMOTE, strategy: 'preferRemote' }))).toBe('conflict');
		},
	);

	it('still pushes a local-only change on a synced page', () => {
		expect(decideContent(input({ status: 'synced', localHash: LOCAL }))).toBe('push');
	});
});
