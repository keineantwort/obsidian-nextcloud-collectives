// Waits until the other workflows on a commit (CI, integration tests, mirror) are finished and fails if one of them failed,
// so that a release is not built from a state whose merge checks are still running or red. Used by
// .forgejo/workflows/release.yml. Usage: node scripts/ci/wait-for-checks.mjs <commit>
// Environment: API (repository API URL), TOKEN (read access), optional TIMEOUT_MIN (default 60), APPEAR_MIN (default 5).
import { pathToFileURL } from 'node:url';

const OWN = /^Release \//; // this workflow, pending itself
const PULL_REQUEST = /\(pull_request\)$/;
const SOFT = /latest|mirror-github/; // may be red (early warning) or is not needed for the release files
const PENDING = new Set(['pending', 'running', 'queued']);

/**
 * Decides from the commit statuses (`{ context, status }`): `wait` (checks missing or still pending), `failed` (a hard
 * check is red) or `done`. `problems` names the failed checks; `soft` the failed ones that do not block.
 */
export function evaluate(statuses) {
	const relevant = statuses.filter((s) => !OWN.test(s.context) && !PULL_REQUEST.test(s.context));
	const hard = relevant.filter((s) => !SOFT.test(s.context));
	const failed = hard.filter((s) => s.status === 'failure' || s.status === 'error');
	const soft = relevant.filter((s) => SOFT.test(s.context) && (s.status === 'failure' || s.status === 'error')).map((s) => s.context);
	if (failed.length > 0) return { state: 'failed', problems: failed.map((s) => s.context), soft };
	if (hard.length === 0) return { state: 'wait', reason: 'no checks reported yet', soft };
	const pending = relevant.filter((s) => PENDING.has(s.status));
	if (pending.length > 0) return { state: 'wait', reason: `pending: ${pending.map((s) => s.context).join(', ')}`, soft };
	return { state: 'done', soft };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
	const [, , sha] = process.argv;
	const { API, TOKEN } = process.env;
	if (sha === undefined || API === undefined) {
		console.error('Usage: API=<repo api url> TOKEN=<token> node scripts/ci/wait-for-checks.mjs <commit>');
		process.exit(1);
	}
	const deadline = Date.now() + Number(process.env.TIMEOUT_MIN ?? 60) * 60_000;
	const appearBy = Date.now() + Number(process.env.APPEAR_MIN ?? 5) * 60_000;
	for (;;) {
		const response = await fetch(`${API}/commits/${sha}/status`, { headers: { Authorization: `token ${TOKEN}` } });
		if (!response.ok) {
			console.error(`Reading the statuses of ${sha} failed: HTTP ${response.status}`);
			process.exit(1);
		}
		const body = await response.json();
		const statuses = (body.statuses ?? []).map((s) => ({ context: String(s.context), status: String(s.status ?? s.state) }));
		const result = evaluate(statuses);
		if (result.state === 'failed') {
			console.error(`Checks failed on ${sha}: ${result.problems.join(', ')}`);
			process.exit(1);
		}
		if (result.state === 'done') {
			for (const context of result.soft) console.warn(`Not blocking, but red: ${context}`);
			console.log(`All checks on ${sha} are green.`);
			return;
		}
		if (result.reason.startsWith('no checks') && Date.now() > appearBy) {
			console.error(`No checks reported on ${sha} after the waiting time; refusing to release an unchecked commit.`);
			process.exit(1);
		}
		if (Date.now() > deadline) {
			console.error(`Timeout while waiting for the checks on ${sha} (${result.reason}).`);
			process.exit(1);
		}
		console.log(`Waiting for checks: ${result.reason}`);
		await sleep(30_000);
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
