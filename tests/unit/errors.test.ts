import { describe, expect, it } from 'vitest';
import {
	ApiChangedError,
	AuthError,
	ConfigError,
	ConflictError,
	ForbiddenError,
	NcError,
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
	it('stores the detail given in the options object', () => {
		const err = new ServerError(500, 'Server error (HTTP 500)', { detail: 'Disk full' });

		expect(err.detail).toBe('Disk full');
		expect(err.status).toBe(500);
	});

	it('leaves detail undefined when it is omitted', () => {
		expect(new ServerError(503).detail).toBeUndefined();
	});
});

describe('NcError options', () => {
	it('keeps both cause and detail from the options object', () => {
		const original = new Error('socket hang up');
		const err = new NcError('m', { cause: original, detail: 'Disk full' });

		expect(err.cause).toBe(original);
		expect(err.detail).toBe('Disk full');
	});

	it('sets no detail when the options object has none', () => {
		expect(new NcError('m').detail).toBeUndefined();
		expect(new NcError('m', { cause: 'x' }).detail).toBeUndefined();
	});
});

describe('detail on the other error classes', () => {
	it('lets ForbiddenError carry a detail from the options', () => {
		const err = new ForbiddenError('x', { detail: 'Member alice not allowed' });

		expect(err).toBeInstanceOf(ForbiddenError);
		expect(err.detail).toBe('Member alice not allowed');
	});

	it('lets AuthError carry a detail from the options', () => {
		const err = new AuthError(401, 'm', { detail: 'Invalid credentials' });

		expect(err.status).toBe(401);
		expect(err.detail).toBe('Invalid credentials');
	});

	it('lets NotFoundError carry a detail from the options', () => {
		const err = new NotFoundError('gone', { detail: 'Sabre\\DAV\\Exception\\NotFound: File not found' });

		expect(err.detail).toBe('Sabre\\DAV\\Exception\\NotFound: File not found');
	});
});

describe('errorLogFields', () => {
	it('returns the class name and the detail for a ServerError with detail', () => {
		expect(errorLogFields(new ServerError(500, 'm', { detail: 'Disk full' }))).toEqual({ error: 'ServerError', detail: 'Disk full' });
	});

	it('returns the class name and the detail for a ForbiddenError with detail', () => {
		expect(errorLogFields(new ForbiddenError('x', { detail: 'Member alice not allowed' }))).toEqual({
			error: 'ForbiddenError',
			detail: 'Member alice not allowed',
		});
	});

	it('returns only the class name for an NcError without detail, without a detail key', () => {
		const result = errorLogFields(new NotFoundError('gone'));

		expect(result).toEqual({ error: 'NotFoundError' });
		expect('detail' in result).toBe(false);
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
