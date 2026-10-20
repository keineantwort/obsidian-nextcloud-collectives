import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types (a build script)
import { checkRelease } from '../../scripts/check-release.mjs';

const ok = { manifest: { version: '1.2.3', minAppVersion: '1.11.4' }, pkg: { version: '1.2.3' }, versions: { '1.2.3': '1.11.4' } };
const check = checkRelease as (files: typeof ok, tag?: string) => string[];

describe('checkRelease', () => {
	it('accepts consistent files, with and without a tag', () => {
		expect(check(ok)).toEqual([]);
		expect(check(ok, '1.2.3')).toEqual([]);
	});
	it('rejects a tag with a "v" prefix or another version', () => {
		expect(check(ok, 'v1.2.3')).toHaveLength(1);
		expect(check(ok, '1.2.4')).toHaveLength(1);
	});
	it('rejects a package.json that differs', () => {
		expect(check({ ...ok, pkg: { version: '1.2.2' } })).toHaveLength(1);
	});
	it('rejects a missing or wrong versions.json entry', () => {
		expect(check({ ...ok, versions: {} })).toHaveLength(1);
		expect(check({ ...ok, versions: { '1.2.3': '1.0.0' } })).toHaveLength(1);
	});
	it('rejects a version that is not x.y.z', () => {
		expect(check({ ...ok, manifest: { version: '1.2', minAppVersion: '1.11.4' } })).toHaveLength(1);
	});
});
