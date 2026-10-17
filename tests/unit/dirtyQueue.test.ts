import { describe, expect, it } from 'vitest';
import { DirtyQueue, suppressingWriter } from '../../src/sync/dirtyQueue';
import { MemoryVault } from '../fakes/memoryVault';

const TTL = 5000;

/** Queue with a clock the test controls (ms). */
function clockedQueue(start = 0): { queue: DirtyQueue; setNow: (ms: number) => void } {
	let current = start;
	const queue = new DirtyQueue(() => current, TTL);
	return { queue, setNow: (ms) => { current = ms; } };
}

describe('DirtyQueue: collecting modified paths', () => {
	it('reports a modified path in the next drain', () => {
		const { queue } = clockedQueue();

		queue.noteModified('A/B.md');

		expect(queue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('empties the queue on drain, so a second drain reports nothing', () => {
		const { queue } = clockedQueue();
		queue.noteModified('A/B.md');
		queue.drain();

		expect(queue.drain()).toEqual(new Set());
	});

	it('keeps events that arrive after a drain for the following drain only', () => {
		const { queue } = clockedQueue();
		queue.noteModified('X.md');
		expect(queue.drain()).toEqual(new Set(['x.md']));

		queue.noteModified('Y.md');

		expect(queue.drain()).toEqual(new Set(['y.md']));
	});

	it('counts a path once when it is modified several times', () => {
		const { queue } = clockedQueue();
		queue.noteModified('A/B.md');
		queue.noteModified('A/B.md');

		expect(queue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('treats paths that differ only in case as one entry', () => {
		const { queue } = clockedQueue();
		queue.noteModified('A/B.md');
		queue.noteModified('a/b.md');

		expect(queue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('treats paths that differ only in Unicode form (NFD vs NFC) as one entry', () => {
		const { queue } = clockedQueue();
		queue.noteModified('Ärger.md');
		queue.noteModified('Ärger.md');

		expect(queue.drain().size).toBe(1);
	});
});

describe('DirtyQueue: own-write suppression', () => {
	it('ignores a modify event for a suppressed path within the ttl', () => {
		const { queue, setNow } = clockedQueue(0);
		queue.suppress('A/B.md');
		setNow(1000);

		queue.noteModified('A/B.md');

		expect(queue.drain()).toEqual(new Set());
	});

	it('ignores several modify events for a suppressed path, because one write can raise more than one', () => {
		const { queue, setNow } = clockedQueue(0);
		queue.suppress('A/B.md');
		setNow(100);
		queue.noteModified('A/B.md');
		setNow(200);
		queue.noteModified('A/B.md');
		setNow(300);
		queue.noteModified('A/B.md');

		expect(queue.drain()).toEqual(new Set());
	});

	it('counts a modify event for the same path again after the ttl has passed', () => {
		const { queue, setNow } = clockedQueue(0);
		queue.suppress('A/B.md');
		setNow(TTL + 1000);

		queue.noteModified('A/B.md');

		expect(queue.drain()).toEqual(new Set(['a/b.md']));
	});

	it('still ignores a path with another spelling of the same name within the ttl', () => {
		const { queue, setNow } = clockedQueue(0);
		queue.suppress('A/B.md');
		setNow(1000);

		queue.noteModified('a/b.md');

		expect(queue.drain()).toEqual(new Set());
	});

	it('does not suppress other paths', () => {
		const { queue, setNow } = clockedQueue(0);
		queue.suppress('A/B.md');
		setNow(1000);

		queue.noteModified('C.md');

		expect(queue.drain()).toEqual(new Set(['c.md']));
	});
});

describe('DirtyQueue: rename and delete', () => {
	it('moves a dirty entry from the old path to the new path', () => {
		const { queue } = clockedQueue();
		queue.noteModified('Old.md');

		queue.noteRenamed('Old.md', 'New.md');

		expect(queue.drain()).toEqual(new Set(['new.md']));
	});

	it('drops a dirty entry when its file is deleted', () => {
		const { queue } = clockedQueue();
		queue.noteModified('Gone.md');

		queue.noteDeleted('Gone.md');

		expect(queue.drain()).toEqual(new Set());
	});
});

describe('suppressingWriter', () => {
	it('ignores a modify event for a file that was created through the wrapper', async () => {
		const { queue, setNow } = clockedQueue(0);
		const vault = new MemoryVault();
		vault.seedFolder('Coll');
		const writer = suppressingWriter(vault, queue);

		await writer.create('Coll/Neu.md', 'Eins');
		setNow(100);
		queue.noteModified('Coll/Neu.md');

		expect(queue.drain()).toEqual(new Set());
		expect(await vault.read('Coll/Neu.md')).toBe('Eins');
	});

	it('ignores a modify event for a file that was processed through the wrapper', async () => {
		const { queue, setNow } = clockedQueue(0);
		const vault = new MemoryVault();
		vault.seed('Coll/A.md', 'alt');
		const writer = suppressingWriter(vault, queue);

		await writer.process('Coll/A.md', () => 'neu');
		setNow(100);
		queue.noteModified('Coll/A.md');

		expect(queue.drain()).toEqual(new Set());
		expect(await vault.read('Coll/A.md')).toBe('neu');
	});

	it('passes reads through unchanged and does not suppress them', async () => {
		const { queue } = clockedQueue(0);
		const vault = new MemoryVault();
		vault.seed('Coll/A.md', 'alt');
		const writer = suppressingWriter(vault, queue);

		expect(await writer.read('Coll/A.md')).toBe('alt');
		expect(writer.exists('Coll/A.md')).toBe(true);
		queue.noteModified('Coll/A.md');
		expect(queue.drain()).toEqual(new Set(['coll/a.md']));
	});
});

describe('DirtyQueue: user changes and requeue', () => {
	it('tells whether a modify is the user\'s', () => {
		const { queue, setNow } = clockedQueue();
		queue.suppress('A/B.md');
		expect(queue.noteModified('A/B.md')).toBe(false);
		expect(queue.noteModified('A/C.md')).toBe(true);
		setNow(TTL + 1);
		expect(queue.noteModified('A/B.md')).toBe(true);
	});

	it('tells whether a created file is the user\'s without marking it dirty', () => {
		const { queue } = clockedQueue();
		queue.suppress('A/B.md');
		expect(queue.isUserWrite('A/B.md')).toBe(false);
		expect(queue.isUserWrite('A/N.md')).toBe(true);
		expect(queue.drain()).toEqual(new Set());
	});

	it('puts the keys of an unfinished run back, together with newer changes', () => {
		const { queue } = clockedQueue();
		queue.noteModified('A/B.md');
		const taken = queue.drain();
		queue.noteModified('A/C.md');

		queue.requeue(taken);

		expect(queue.drain()).toEqual(new Set(['a/b.md', 'a/c.md']));
	});
});

describe('suppressingWriter: renames and trash of the plugin', () => {
	it('marks both ends of a rename and a trashed path as the plugin\'s own', async () => {
		const queue = new DirtyQueue(() => 0, TTL);
		const vault = new MemoryVault();
		vault.seed('A/old.md', 'x');
		vault.seed('A/gone.md', 'y');
		const writer = suppressingWriter(vault, queue);

		await writer.rename('A/old.md', 'A/new.md');
		await writer.trash('A/gone.md');

		expect(queue.isUserWrite('A/old.md')).toBe(false);
		expect(queue.isUserWrite('A/new.md')).toBe(false);
		expect(queue.isUserWrite('A/gone.md')).toBe(false);
		expect(queue.isUserWrite('A/other.md')).toBe(true);
	});
});
