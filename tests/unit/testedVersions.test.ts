import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TESTED_NEXTCLOUD_MAJORS } from '../../src/api/versionCheck';

const workflow = readFileSync(new URL('../../.forgejo/workflows/integration.yml', import.meta.url), 'utf8');

describe('tested Nextcloud versions', () => {
	it('are exactly the versions the integration workflow runs (a version the plugin calls tested must have a CI job)', () => {
		const line = /^\s+nc: \[([\d,\s]+)\]\s*$/m.exec(workflow)?.[1];
		expect(line, 'matrix line "nc: [..]" in integration.yml').toBeDefined();
		const inMatrix = (line ?? '').split(',').map((n) => Number(n.trim()));
		expect([...TESTED_NEXTCLOUD_MAJORS].sort((a, b) => a - b)).toEqual(inMatrix.sort((a, b) => a - b));
	});
});
