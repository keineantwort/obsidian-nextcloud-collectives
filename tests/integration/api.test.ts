import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiClients, type ApiClients } from '../../src/api/clients';
import type { HttpClientOptions } from '../../src/api/http';
import type { Collective, PageInfo } from '../../src/api/types';
import { remotePagePath } from '../../src/mapping/paths';
import { AuthError, ConflictError, ServerError } from '../../src/util/errors';
import { fetchRequest, loadTestServerEnv, type TestServerEnv } from './helpers';

const TEST_COLLECTIVE_NAME = 'ONC Integrationstest';
const PAGE_TITLE = 'Integrationsseite ' + Date.now();
const CONTENT = 'Hallo Welt – äöü\n\nZweite Zeile';
const REJECTED_CONTENT = 'Diese stale Version darf nicht gespeichert werden';

let env: TestServerEnv;
let clients: ApiClients;
let collective: Collective | undefined;
let landing: PageInfo | undefined;
let page: PageInfo | undefined;
let etagBefore: string | undefined;
let etagAfter: string | undefined;

/** Returns the value or fails with a message naming the earlier test that should have set it. */
function defined<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`${what} is not set: an earlier test failed`);
	return value;
}

function clientOptions(appPassword: string): HttpClientOptions {
	return {
		baseUrl: env.baseUrl,
		username: env.user,
		appPassword,
		request: fetchRequest,
		sleep: () => Promise.resolve(),
	};
}

/**
 * Nextcloud derives ETags from the mtime in whole seconds: a write in the same second as the previous one keeps
 * the old ETag (docs/api-notes.md §5). Waiting past the second boundary makes the ETag change observable.
 */
function waitPastSecondBoundary(): Promise<void> {
	return delay(1100);
}

async function isServerInstalled(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/status.php`);
		const body = (await res.json()) as { installed?: unknown };
		return body.installed === true;
	} catch {
		return false;
	}
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

beforeAll(async () => {
	env = loadTestServerEnv();
	if (!(await isServerInstalled(env.baseUrl))) throw new Error('Testserver läuft nicht: npm run nc:up ausführen');

	clients = createApiClients(clientOptions(env.password));
	let collectives = await clients.collectives.listCollectives();
	if (collectives.length === 0) {
		await clients.collectives.createCollective(TEST_COLLECTIVE_NAME);
		collectives = await clients.collectives.listCollectives();
	}
	collective = collectives[0];
});

afterAll(async () => {
	if (!collective || !page) return;
	try {
		await clients.collectives.trashPage(collective.id, page.id);
	} catch {
		// Cleanup only: a failed trash must not hide the result of the tests.
	}
});

describe('API clients against the local Docker Nextcloud', () => {
	it('lists at least one collective, each with a numeric id and a non-empty name', async () => {
		const list = await clients.collectives.listCollectives();

		expect(list.length).toBeGreaterThanOrEqual(1);
		for (const entry of list) {
			expect(Number.isInteger(entry.id)).toBe(true);
			expect(entry.name.trim()).not.toBe('');
		}
	});

	it('lists the landing page of the collective with parentId 0 and fileName Readme.md', async () => {
		const pages = await clients.collectives.listPages(defined(collective, 'collective').id);

		const found = pages.find((p) => p.parentId === 0 && p.fileName === 'Readme.md');
		if (!found) throw new Error('landing page (Readme.md at collective root) not found');
		expect(found).toMatchObject({ parentId: 0, fileName: 'Readme.md' });
		landing = found;
	});

	it('creates a page below the landing page and returns it with that title and parent', async () => {
		const created = await clients.collectives.createPage(
			defined(collective, 'collective').id,
			defined(landing, 'landing page').id,
			PAGE_TITLE,
		);
		page = created;

		expect(created.title).toBe(PAGE_TITLE);
		expect(created.parentId).toBe(defined(landing, 'landing page').id);
		const fetched = await clients.collectives.getPage(defined(collective, 'collective').id, created.id);
		expect(fetched.id).toBe(created.id);
	});

	it('reads the new page with empty content and a non-empty ETag', async () => {
		const file = await clients.webdav.get(remotePagePath(defined(page, 'page')));

		expect(file.content).toBe('');
		expect(file.etag).not.toBe('');
		etagBefore = file.etag;
	});

	it('writes the content with the current ETag, returns a new ETag and reads back exactly that content', async () => {
		await waitPastSecondBoundary();
		const written = await clients.webdav.put(remotePagePath(defined(page, 'page')), CONTENT, {
			ifMatch: defined(etagBefore, 'ETag before write'),
		});
		etagAfter = written.etag;

		expect(written.etag).not.toBe(defined(etagBefore, 'ETag before write'));
		const back = await clients.webdav.get(remotePagePath(defined(page, 'page')));
		expect(back.content).toBe(CONTENT);
		expect(back.etag).toBe(written.etag);
	});

	it('rejects a write with the stale ETag as ConflictError and keeps the content written before', async () => {
		const stale = defined(etagBefore, 'ETag before write');
		expect(stale).not.toBe(defined(etagAfter, 'ETag after write'));

		const err = await captureError(
			clients.webdav.put(remotePagePath(defined(page, 'page')), REJECTED_CONTENT, { ifMatch: stale }),
		);

		expect(err).toBeInstanceOf(ConflictError);
		const back = await clients.webdav.get(remotePagePath(defined(page, 'page')));
		expect(back.content).toBe(CONTENT);
	});

	it('lists the page in a Depth-1 PROPFIND with its fileId and its current ETag', async () => {
		const current = defined(page, 'page');
		const entries = await clients.webdav.propfind(current.collectivePath, 1);

		const entry = entries.find((e) => e.fileId === current.id);
		expect(entry).toMatchObject({
			path: remotePagePath(current),
			isCollection: false,
			etag: defined(etagAfter, 'ETag after write'),
		});
	});

	it('rejects MKCOL on an existing folder with ServerError (HTTP 405) carrying the Sabre exception as detail', async () => {
		const current = defined(page, 'page');

		const err = await captureError(clients.webdav.mkcol(current.collectivePath));

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status: 405 });
		expect((err as ServerError).detail).toMatch(/^Sabre\\DAV\\Exception\\MethodNotAllowed: \S/);
		expect((err as ServerError).detail).not.toContain(env.password);
	});

	it('rejects listCollectives with AuthError (HTTP 401) when the password is wrong', async () => {
		const wrong = createApiClients(clientOptions(env.password + '-wrong'));

		const err = await captureError(wrong.collectives.listCollectives());

		expect(err).toBeInstanceOf(AuthError);
		expect(err).toMatchObject({ status: 401 });
		expect((err as Error).message).not.toContain(env.password);
	});
});
