import { describe, expect, it, vi } from 'vitest';
import { fetchServerVersion, parseServerVersion, TESTED_NEXTCLOUD_MAJORS, versionStatus } from '../../src/api/versionCheck';
import type { OcsClient } from '../../src/api/ocsClient';

const data = { version: { major: 33, minor: 0, micro: 10, string: '33.0.10', edition: '' }, capabilities: {} };

describe('parseServerVersion', () => {
	it('reads the version of the capabilities data', () => {
		expect(parseServerVersion(data)).toEqual({ major: 33, minor: 0, micro: 10, string: '33.0.10' });
	});
	it('builds the text if the server sends none', () => {
		expect(parseServerVersion({ version: { major: 34, minor: 1, micro: 2 } })?.string).toBe('34.1.2');
	});
	it.each([null, [], 'x', {}, { version: 'x' }, { version: { major: '33', minor: 0, micro: 0 } }, { version: { major: -1, minor: 0, micro: 0 } }, { version: { major: 1.5, minor: 0, micro: 0 } }])(
		'returns null for %j', (input) => { expect(parseServerVersion(input)).toBeNull(); });
});

describe('versionStatus', () => {
	it('accepts the tested major versions', () => {
		for (const major of TESTED_NEXTCLOUD_MAJORS) expect(versionStatus({ major, minor: 0, micro: 0, string: '' })).toBe('tested');
	});
	it('flags older and newer majors', () => {
		expect(versionStatus({ major: 28, minor: 0, micro: 0, string: '' })).toBe('untested');
		expect(versionStatus({ major: 99, minor: 0, micro: 0, string: '' })).toBe('untested');
	});
});

describe('fetchServerVersion', () => {
	it('requests the capabilities endpoint', async () => {
		const request = vi.fn().mockResolvedValue(data);
		const version = await fetchServerVersion({ request } as unknown as OcsClient);
		expect(request).toHaveBeenCalledWith('GET', '/ocs/v2.php/cloud/capabilities');
		expect(version?.major).toBe(33);
	});
});
