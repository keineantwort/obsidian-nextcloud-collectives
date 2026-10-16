// Line-based diff for showing local and remote text side by side. Pure, no dependencies.

export interface DiffLine {
	kind: 'same' | 'removed' | 'added';
	text: string;
}

/** Default bound for the LCS table (rows × columns of the changed middle part). */
const DEFAULT_MAX_CELLS = 4_000_000;

/**
 * Line-based LCS diff from `a` (local) to `b` (remote). Lines are split on /\r?\n/. 'removed' = only in a,
 * 'added' = only in b. Common prefix and suffix are trimmed before the LCS table; if the remaining
 * (aLines * bLines) exceeds maxCells (default 4_000_000) → null (too large to show).
 * Within a changed block, all 'removed' lines come before the 'added' lines.
 */
export function lineDiff(a: string, b: string, maxCells: number = DEFAULT_MAX_CELLS): DiffLine[] | null {
	const aLines = a.split(/\r?\n/);
	const bLines = b.split(/\r?\n/);

	let prefix = 0;
	while (prefix < aLines.length && prefix < bLines.length && aLines[prefix] === bLines[prefix]) prefix++;

	let suffix = 0;
	while (
		suffix < aLines.length - prefix
		&& suffix < bLines.length - prefix
		&& aLines[aLines.length - 1 - suffix] === bLines[bLines.length - 1 - suffix]
	) suffix++;

	const aMiddle = aLines.slice(prefix, aLines.length - suffix);
	const bMiddle = bLines.slice(prefix, bLines.length - suffix);
	if (aMiddle.length * bMiddle.length > maxCells) return null;

	return [
		...sameLines(aLines.slice(0, prefix)),
		...diffMiddle(aMiddle, bMiddle),
		...sameLines(aLines.slice(aLines.length - suffix)),
	];
}

function sameLines(lines: string[]): DiffLine[] {
	return lines.map((text) => ({ kind: 'same', text }));
}

/** LCS table over the changed middle part, then a walk that emits each changed block as removed lines, then added lines. */
function diffMiddle(a: string[], b: string[]): DiffLine[] {
	// lcs[i][j] = length of the LCS of a[i..] and b[j..]; the row for i = a.length is all zeros.
	const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		const row = lcs[i] ?? [];
		const below = lcs[i + 1] ?? [];
		for (let j = b.length - 1; j >= 0; j--) {
			row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
		}
	}
	const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;

	const out: DiffLine[] = [];
	let removed: DiffLine[] = [];
	let added: DiffLine[] = [];
	const flush = (): void => {
		out.push(...removed, ...added);
		removed = [];
		added = [];
	};

	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const left = a[i] ?? '';
		const right = b[j] ?? '';
		if (left === right) {
			flush();
			out.push({ kind: 'same', text: left });
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) {
			removed.push({ kind: 'removed', text: left });
			i++;
		} else {
			added.push({ kind: 'added', text: right });
			j++;
		}
	}
	for (; i < a.length; i++) removed.push({ kind: 'removed', text: a[i] ?? '' });
	for (; j < b.length; j++) added.push({ kind: 'added', text: b[j] ?? '' });
	flush();
	return out;
}
