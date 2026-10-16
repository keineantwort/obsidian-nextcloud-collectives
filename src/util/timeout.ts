import { NetworkError } from './errors';

/** Rejects with NetworkError if `promise` does not settle within `ms`. Uses window.setTimeout / window.clearTimeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			reject(new NetworkError(`Request timed out after ${ms} ms`));
		}, ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			// Promise rejection reasons are typed `any`; they are passed through unchanged.
			(err: Error) => {
				window.clearTimeout(timer);
				reject(err);
			},
		);
	});
}
