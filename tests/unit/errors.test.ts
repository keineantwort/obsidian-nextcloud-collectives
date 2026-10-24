import { describe, expect, it } from 'vitest';
import {
	ApiChangedError,
	AuthError,
	ConfigError,
	ConflictError,
	ForbiddenError,
	NetworkError,
	NotFoundError,
	ServerError,
	errorLogFields,
	isRunFatal,
} from '../../src/util/errors';

describe('isRunFatal', () => {
	it.each<{ name: string; error: unknown; expected: boolean }>([
		{ name: 'is true for AuthError', error: new AuthError(401), expected: true },
		{ name: 'is true for ApiChangedError', error: new ApiChangedError('shape'), expected: true },
		{ name: 'is true for NetworkError', error: new NetworkError('offline'), expected: true },
		{ name: 'is false for ForbiddenError', error: new ForbiddenError(), expected: false },
		{ name: 'is false for NotFoundError', error: new NotFoundError('gone'), expected: false },
		{ name: 'is false for ConflictError', error: new ConflictError('etag'), expected: false },
		{ name: 'is false for ServerError', error: new ServerError(503), expected: false },
		{ name: 'is false for ConfigError', error: new ConfigError('appPassword', 'missing'), expected: false },
		{ name: 'is false for a plain Error', error: new Error('boom'), expected: false },
		{ name: 'is false for a thrown string', error: 'boom', expected: false },
		{ name: 'is false for undefined', error: undefined, expected: false },
	])('$name', ({ error, expected }) => {
		expect(isRunFatal(error)).toBe(expected);
	});
});

describe('ServerError detail', () => {
	it('stores the detail given by the caller', () => {
		const err = new ServerError(500, 'Server error (HTTP 500)', 'Disk full');

		expect(err.detail).toBe('Disk full');
		expect(err.status).toBe(500);
	});

	it('leaves detail undefined when it is omitted', () => {
		expect(new ServerError(503).detail).toBeUndefined();
	});
});

describe('errorLogFields', () => {
	it('returns the class name and the detail for a ServerError with detail', () => {
		expect(errorLogFields(new ServerError(500, 'm', 'Disk full'))).toEqual({ error: 'ServerError', detail: 'Disk full' });
	});

	it('returns only the class name for a ServerError without detail, without a detail key', () => {
		const result = errorLogFields(new ServerError(503));

		expect(result).toEqual({ error: 'ServerError' });
		expect('detail' in result).toBe(false);
	});

	it('returns only the class name for another NcError subclass', () => {
		const result = errorLogFields(new NetworkError('offline'));

		expect(result).toEqual({ error: 'NetworkError' });
		expect('detail' in result).toBe(false);
	});

	it('returns "unknown" for a value that is not an Error', () => {
		const result = errorLogFields('boom');

		expect(result).toEqual({ error: 'unknown' });
		expect('detail' in result).toBe(false);
	});
});
