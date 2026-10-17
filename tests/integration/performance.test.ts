// M9 (PLAN §14): a collective with 500 pages. The idle sync must stay below 5 s, and the first sync must not write the
// state once per page. The server is the local Docker Nextcloud (LAN-like latency), so the limit is a regression guard.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Collective, PageInfo } from '../../src/api/types';
import { basicAuthHeader } from '../../src/api/http';
import { CollectiveFixture, Harness } from './harness';
import { fetchRequest } from './helpers';

const PAGES = 500;
const BATCH = 10;
const IDLE_LIMIT_MS = 5000;

let fixture: CollectiveFixture | undefined;
let harness: Harness | undefined;

afterAll(async () => {
	await fixture?.cleanup();
	// 500 pages in the Collectives trash slow down every later test on this server (a pull test went from 20 s to 15 min),
	// so the collective is deleted for good. Only the throwaway test server is ever used (AGENTS rule 6).
	if (harness === undefined) return;
	for (const collective of fixture?.created ?? []) {
		await fetchRequest({
			url: `${harness.env.baseUrl}/ocs/v2.php/apps/collectives/api/v1.0/collectives/trash/${collective.id}?circle=true`,
			method: 'DELETE',
			headers: { 'OCS-APIRequest': 'true', Authorization: basicAuthHeader(harness.env.user, harness.env.password) },
		});
	}
}, 120_000);

describe('performance with 500 pages', () => {
	let h: Harness;
	let collective: Collective;
	let landing: PageInfo;

	beforeAll(async () => {
		h = await Harness.create();
		harness = h;
		fixture = new CollectiveFixture(h.clients);
		const made = await fixture.collective('ONC M9 perf');
		collective = made.collective;
		landing = made.landing;
		for (let start = 0; start < PAGES; start += BATCH) {
			await Promise.all(Array.from({ length: BATCH }, (_, i) => h.clients.collectives.createPage(collective.id, landing.id, `Seite ${String(start + i).padStart(3, '0')}`)));
		}
	}, 600_000);

	it('pulls all pages, writing the state far less often than once per page', async () => {
		const started = Date.now();
		const outcome = await h.sync();
		const seconds = (Date.now() - started) / 1000;
		process.stdout.write(`first sync of ${PAGES} pages: ${seconds.toFixed(1)} s, ${h.stateFile.writes} state writes\n`);

		expect(outcome.result.created).toBeGreaterThanOrEqual(PAGES);
		expect(h.stateFile.writes).toBeLessThan(PAGES / 2);
	}, 600_000);

	it('finishes an idle sync within 5 seconds and changes nothing', async () => {
		const writes = h.stateFile.writes;
		const started = Date.now();
		const outcome = await h.sync();
		const ms = Date.now() - started;
		process.stdout.write(`idle sync of ${PAGES} pages: ${ms} ms\n`);

		expect(outcome.result.created + outcome.result.updated + outcome.result.pushed + outcome.result.failed).toBe(0);
		expect(h.stateFile.writes).toBe(writes);
		expect(ms).toBeLessThan(IDLE_LIMIT_MS);
	}, 60_000);
});
