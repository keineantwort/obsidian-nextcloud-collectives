import { describe, expect, it } from 'vitest';
import { lineDiff } from '../../src/util/diff';
import type { DiffLine } from '../../src/util/diff';

/** Compact form of a diff for readable assertions: 's:text', '-:text' (removed), '+:text' (added). */
function compact(lines: DiffLine[]): string[] {
	const marker = { same: 's', removed: '-', added: '+' } as const;
	return lines.map((line) => `${marker[line.kind]}:${line.text}`);
}

describe('lineDiff', () => {
	it('reports every line as same for identical texts', () => {
		expect(compact(lineDiff('a\nb\nc', 'a\nb\nc') ?? [])).toEqual(['s:a', 's:b', 's:c']);
	});

	it('reports a pure insertion as an added line between the same lines', () => {
		expect(compact(lineDiff('a\nc', 'a\nb\nc') ?? [])).toEqual(['s:a', '+:b', 's:c']);
	});

	it('reports a pure deletion as a removed line between the same lines', () => {
		expect(compact(lineDiff('a\nb\nc', 'a\nc') ?? [])).toEqual(['s:a', '-:b', 's:c']);
	});

	it('lists a replaced line as removed before added', () => {
		expect(compact(lineDiff('x\nold\ny', 'x\nnew\ny') ?? [])).toEqual(['s:x', '-:old', '+:new', 's:y']);
	});

	it('lists all removed lines of a multi-line replacement before its added lines', () => {
		expect(compact(lineDiff('a\nold1\nold2\nz', 'a\nnew1\nz') ?? [])).toEqual(['s:a', '-:old1', '-:old2', '+:new1', 's:z']);
	});

	it('treats CRLF and LF line endings as the same lines', () => {
		expect(compact(lineDiff('a\r\nb', 'a\nb') ?? [])).toEqual(['s:a', 's:b']);
	});

	it('reports no added or removed lines for two empty texts', () => {
		const diff = lineDiff('', '') ?? [];

		expect(diff.filter((line) => line.kind !== 'same')).toEqual([]);
	});

	it('reports the text of an added line when the old text is empty', () => {
		const diff = lineDiff('', 'x') ?? [];

		expect(diff.filter((line) => line.kind === 'added').map((line) => line.text)).toEqual(['x']);
		expect(diff.some((line) => line.kind === 'same')).toBe(false);
	});

	it('still diffs a large text with one changed line under a small maxCells, because the common prefix and suffix are trimmed', () => {
		const before = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
		const after = [...before];
		after[500] = 'changed';

		const diff = lineDiff(before.join('\n'), after.join('\n'), 10);

		expect(diff).not.toBeNull();
		expect(diff?.filter((line) => line.kind === 'removed').map((line) => line.text)).toEqual(['line 500']);
		expect(diff?.filter((line) => line.kind === 'added').map((line) => line.text)).toEqual(['changed']);
		expect(diff?.filter((line) => line.kind === 'same')).toHaveLength(999);
	});

	it('returns null when the changed middle exceeds maxCells', () => {
		const a = Array.from({ length: 50 }, (_, i) => `left ${i}`).join('\n');
		const b = Array.from({ length: 50 }, (_, i) => `right ${i}`).join('\n');

		expect(lineDiff(a, b, 100)).toBeNull();
	});
});
