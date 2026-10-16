import { describe, expect, it } from 'vitest';
import type { PageInfo } from '../../src/api/types';
import { remotePagePath } from '../../src/mapping/paths';

type PathFields = Pick<PageInfo, 'collectivePath' | 'filePath' | 'fileName'>;

const fields = (overrides: Partial<PathFields>): PathFields => ({
	collectivePath: '.Collectives/Handbuch',
	filePath: '',
	fileName: 'Readme.md',
	...overrides,
});

describe('remotePagePath', () => {
	it('builds the path of a root-level page from collectivePath and fileName', () => {
		expect(remotePagePath(fields({ filePath: '', fileName: 'Readme.md' }))).toBe('.Collectives/Handbuch/Readme.md');
	});

	it('inserts the sub-folder path between collectivePath and fileName', () => {
		expect(remotePagePath(fields({ filePath: 'Prozesse', fileName: 'Urlaub.md' }))).toBe('.Collectives/Handbuch/Prozesse/Urlaub.md');
	});

	it('keeps nested folder segments as they are', () => {
		expect(remotePagePath(fields({ filePath: 'Prozesse/Intern', fileName: 'Urlaub.md' }))).toBe('.Collectives/Handbuch/Prozesse/Intern/Urlaub.md');
	});
});
