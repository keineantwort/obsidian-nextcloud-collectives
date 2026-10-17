import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { metaHash, sha256Hex } from '../../src/util/hash';

describe('sha256Hex', () => {
	it('returns the well-known SHA-256 of the empty string', async () => {
		expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});

	it('hashes the UTF-8 bytes of non-ASCII text like Node does', async () => {
		const expected = createHash('sha256').update('äöü', 'utf8').digest('hex');
		expect(await sha256Hex('äöü')).toBe(expected);
	});
});

describe('metaHash', () => {
	it('does not depend on the order of the tag names', async () => {
		expect(await metaHash(null, ['b', 'a'])).toBe(await metaHash(null, ['a', 'b']));
	});

	it('equals the hash of the JSON of title, emoji and sorted tags', async () => {
		expect(await metaHash('📘', ['b', 'a'])).toBe(await sha256Hex(JSON.stringify(['📘', ['a', 'b']])));
	});

	it('changes when the emoji changes', async () => {
		expect(await metaHash('📘', [])).not.toBe(await metaHash('📗', []));
	});

	it('changes when a tag is added', async () => {
		expect(await metaHash(null, [])).not.toBe(await metaHash(null, ['a']));
	});
});
