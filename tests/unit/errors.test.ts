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
