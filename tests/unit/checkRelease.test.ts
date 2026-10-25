import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types (a build script)
import { checkRelease, releaseNotes } from '../../scripts/check-release.mjs';

const CHANGELOG = `# Changelog

Intro.

## 1.2.3 – 2026-10-25

### Fixed

- Something.

## 1.2.2 – 2026-10-20

- Older.
`;
const ok = { manifest: { version: '1.2.3', minAppVersion: '1.11.4' }, pkg: { version: '1.2.3' }, versions: { '1.2.3': '1.11.4' }, changelog: CHANGELOG };
const check = checkRelease as (files: typeof ok, tag?: string) => string[];
const notes = releaseNotes as (changelog: string, version: string) => string | null;

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

describe('release notes from CHANGELOG.md', () => {
	it('takes the section of the version, without its heading, up to the next version', () => {
		expect(notes(CHANGELOG, '1.2.3')).toBe('### Fixed\n\n- Something.');
		expect(notes(CHANGELOG, '1.2.2')).toBe('- Older.');
	});
	it('gives null for a version without a section or with an empty one, and does not match a longer version', () => {
		expect(notes(CHANGELOG, '1.2.4')).toBeNull();
		expect(notes('## 1.2.3\n\n## 1.2.2\n- x\n', '1.2.3')).toBeNull();
		expect(notes('## 1.2.30\n- x\n', '1.2.3')).toBeNull();
	});
	it('makes the release check fail without notes for the version', () => {
		expect(check({ ...ok, changelog: '# Changelog\n' })).toHaveLength(1);
	});
});
