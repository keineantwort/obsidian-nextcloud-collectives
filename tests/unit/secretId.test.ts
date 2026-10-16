import { describe, expect, it } from 'vitest';
import { SECRET_ID_PREFIX, buildSecretId, isValidSecretId } from '../../src/settings/secretId';

describe('buildSecretId', () => {
	it('builds the prefix followed by zero-padded lowercase hex of each byte', () => {
		const id = buildSecretId(new Uint8Array([0, 15, 255, 16]));

		expect(id).toBe('nextcloud-collectives-000fff10');
	});

	it('throws for an empty byte array instead of returning a bare prefix', () => {
		expect(() => buildSecretId(new Uint8Array([]))).toThrow();
	});

	it('builds a valid ID with 16 hex characters after the prefix from 8 random bytes', () => {
		const id = buildSecretId(crypto.getRandomValues(new Uint8Array(8)));

		expect(id).toHaveLength(SECRET_ID_PREFIX.length + 16);
		expect(isValidSecretId(id)).toBe(true);
	});
});

describe('isValidSecretId', () => {
	it.each([
		['abc-123'],
		['nextcloud-collectives-00ff'],
	])('accepts "%s"', (id) => {
		expect(isValidSecretId(id)).toBe(true);
	});

	it.each([
		['empty string', ''],
		['uppercase letters', 'ABC'],
		['underscore', 'a_b'],
		['space', 'a b'],
		['non-ASCII letter', 'ä'],
		['slash', 'a/b'],
	])('rejects %s (%s)', (_label, id) => {
		expect(isValidSecretId(id)).toBe(false);
	});
});
