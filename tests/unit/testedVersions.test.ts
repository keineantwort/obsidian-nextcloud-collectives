import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TESTED_NEXTCLOUD_MAJORS } from '../../src/api/versionCheck';

const read = (name: string): string => readFileSync(new URL(`../../.forgejo/workflows/${name}`, import.meta.url), 'utf8');

/** The numbers of the job's matrix line "nc: [..]" (the job's block runs from its "  <job>:" line to the next job). */
function matrixOf(workflow: string, job: string): number[] {
	const block = new RegExp(`^  ${job}:\\n((?:(?!  \\S).*\\n?)*)`, 'm').exec(workflow)?.[1] ?? '';
	const line = /^\s+nc: \[([\d,\s]+)\]\s*$/m.exec(block)?.[1];
	expect(line, `matrix line "nc: [..]" of job ${job}`).toBeDefined();
	return (line ?? '').split(',').map((n) => Number(n.trim()));
}

const sorted = (versions: readonly number[]): number[] => [...versions].sort((a, b) => a - b);

describe('tested Nextcloud versions', () => {
	// A version the plugin calls tested must have a CI job: the current one on every pull request, the older ones nightly.
	it('are exactly the versions the integration tests run against', () => {
		const versions = [...matrixOf(read('integration.yml'), 'integration'), ...matrixOf(read('nightly.yml'), 'integration')];
		expect(sorted(versions)).toEqual(sorted(TESTED_NEXTCLOUD_MAJORS));
	});

	it('run the integration tests of the current version on every pull request', () => {
		expect(sorted(matrixOf(read('integration.yml'), 'integration'))).toEqual(sorted(TESTED_NEXTCLOUD_MAJORS).slice(-1));
	});

	it('are exactly the versions the performance test runs against', () => {
		expect(sorted(matrixOf(read('nightly.yml'), 'performance'))).toEqual(sorted(TESTED_NEXTCLOUD_MAJORS));
	});
});
