import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/util/timeout';
import { NetworkError } from '../../src/util/errors';

/**
 * A promise whose rejection is triggered by the test. Rejecting only after withTimeout() was called
 * avoids unhandled-rejection noise when a stub throws synchronously before attaching handlers.
 */
function deferred<T>(): { promise: Promise<T>; reject: (reason: unknown) => void } {
	let reject: (reason: unknown) => void = () => undefined;
	const promise = new Promise<T>((_resolve, rejectFn) => {
		reject = rejectFn;
	});
	return { promise, reject };
}

describe('withTimeout', () => {
	beforeEach(() => {
		// The implementation uses window.setTimeout; Node has no window, so alias it to globalThis.
		vi.stubGlobal('window', globalThis);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('resolves with the value of a promise that settles before the timeout', async () => {
		const result = await withTimeout(Promise.resolve(42), 1000);

		expect(result).toBe(42);
	});

	it('rejects with the same error instance when the promise rejects before the timeout', async () => {
		const original = new Error('boom');
		const source = deferred<never>();

		const settled = withTimeout(source.promise, 1000);
		source.reject(original);

		await expect(settled).rejects.toBe(original);
	});

	it('rejects with NetworkError when the promise never settles and the timeout elapses', async () => {
		const neverSettles = new Promise<never>(() => undefined);

		const settled = withTimeout(neverSettles, 500);
		const assertion = expect(settled).rejects.toBeInstanceOf(NetworkError);
		await vi.advanceTimersByTimeAsync(500);

		await assertion;
	});

	it('does not reject before the timeout has elapsed', async () => {
		const neverSettles = new Promise<never>(() => undefined);
		let settled = false;
		const tracked = withTimeout(neverSettles, 500).then(
			() => undefined,
			() => undefined,
		);
		void tracked.then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(499);

		expect(settled).toBe(false);
	});

	it('clears its timer when the promise resolves in time', async () => {
		await withTimeout(Promise.resolve('ok'), 1000);

		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears its timer when the promise rejects in time', async () => {
		const source = deferred<never>();

		const settled = withTimeout(source.promise, 1000);
		source.reject(new Error('fail'));

		await expect(settled).rejects.toThrow('fail');

		expect(vi.getTimerCount()).toBe(0);
	});
});
