import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types (a CI script)
import { evaluate } from '../../scripts/ci/wait-for-checks.mjs';

type Status = { context: string; status: string };
const run = evaluate as (statuses: Status[]) => { state: string; problems?: string[]; reason?: string; soft: string[] };
const s = (context: string, status: string): Status => ({ context, status });

describe('wait-for-checks evaluate', () => {
	it('waits while nothing is reported, ignoring the release run itself and pull request checks', () => {
		expect(run([]).state).toBe('wait');
		expect(run([s('Release / release (workflow_dispatch)', 'pending'), s('CI / build-and-test (pull_request)', 'success')]).state).toBe('wait');
	});

	it('waits while a check is pending', () => {
		const result = run([s('CI / build-and-test (push)', 'success'), s('Integration (Nextcloud versions) / Nextcloud 35 (push)', 'pending')]);
		expect(result.state).toBe('wait');
		expect(result.reason).toContain('Nextcloud 35');
	});

	it('fails on a red hard check', () => {
		const result = run([s('CI / build-and-test (push)', 'failure'), s('Integration (Nextcloud versions) / Nextcloud 35 (push)', 'success')]);
		expect(result).toMatchObject({ state: 'failed', problems: ['CI / build-and-test (push)'] });
	});

	it('is done when all pass; a red latest or mirror job does not block but is named', () => {
		const result = run([
			s('CI / build-and-test (push)', 'success'),
			s('Integration (Nextcloud versions) / Nextcloud 35 (push)', 'success'),
			s('Integration (Nextcloud versions) / Nextcloud latest (push)', 'failure'),
			s('CI / mirror-github (push)', 'error'),
		]);
		expect(result.state).toBe('done');
		expect(result.soft).toHaveLength(2);
	});

	it('still waits for a pending soft check', () => {
		expect(run([s('CI / build-and-test (push)', 'success'), s('CI / mirror-github (push)', 'pending')]).state).toBe('wait');
	});
});
