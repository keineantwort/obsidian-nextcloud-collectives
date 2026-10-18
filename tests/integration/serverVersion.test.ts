import { beforeAll, describe, expect, it } from 'vitest';
import { createApiClients } from '../../src/api/clients';
import { fetchServerVersion, TESTED_NEXTCLOUD_MAJORS, versionStatus, type ServerVersion } from '../../src/api/versionCheck';
import { fetchRequest, loadTestServerEnv, type TestServerEnv } from './helpers';

let env: TestServerEnv;
let version: ServerVersion | null;

beforeAll(async () => {
	env = loadTestServerEnv();
	const clients = createApiClients({ baseUrl: env.baseUrl, username: env.user, appPassword: env.password, request: fetchRequest, retry: false });
	version = await fetchServerVersion(clients.ocs);
});

describe('version check against the test server', () => {
	it('reads the Nextcloud version of the server', () => {
		// The CI log gets the full version list from scripts/dev-nextcloud/versions.sh.
		expect(version).not.toBeNull();
	});

	it('runs the version the setup asked for (a numeric NC_VERSION is the major version of the image)', () => {
		if (!/^\d+$/.test(env.ncVersion)) return;
		expect(version?.major).toBe(Number(env.ncVersion));
	});

	it('is a version the plugin lists as tested – a new major version must be added to TESTED_NEXTCLOUD_MAJORS after this suite passes', () => {
		expect(version).not.toBeNull();
		if (version !== null) expect(versionStatus(version), `Nextcloud ${version.string}; tested: ${TESTED_NEXTCLOUD_MAJORS.join(', ')}`).toBe('tested');
	});
});
