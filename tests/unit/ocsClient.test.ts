import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApiClients } from '../../src/api/clients';
import { getHeader, type HttpRequest, type HttpResponse, type RequestFn } from '../../src/api/http';
import { ApiChangedError, AuthError, ForbiddenError, ServerError } from '../../src/util/errors';

const BASE_URL = 'https://cloud.example.com';
const OCS_COLLECTIVES = '/ocs/v2.php/apps/collectives/api/v1.0';
const PASSWORD = 'pw-SECRET-123';

type Outcome = HttpResponse | Error;

interface FakeRequest {
	fn: RequestFn;
	calls: HttpRequest[];
}

/** Hand-written RequestFn: records every request and answers with the queued outcomes, one per call. */
function fakeRequest(...outcomes: Outcome[]): FakeRequest {
	const calls: HttpRequest[] = [];
	const queue = [...outcomes];
	const fn: RequestFn = async (req) => {
		calls.push(req);
		const next = queue.shift();
		if (next === undefined) throw new Error('fake: no outcome queued for this request');
		if (next instanceof Error) throw next;
		return next;
	};
	return { fn, calls };
}

function reply(status: number, text: string): HttpResponse {
	return { status, headers: {}, text };
}

interface OcsFixture {
	request: { method: string; path: string; body: unknown };
	status: number;
	response: { ocs: { data: unknown } };
}

function loadFixture(name: string): OcsFixture {
	return JSON.parse(readFileSync(new URL(`../fixtures/m0/${name}`, import.meta.url), 'utf8')) as OcsFixture;
}

function replyFromFixture(fixture: OcsFixture): HttpResponse {
	return reply(fixture.status, JSON.stringify(fixture.response));
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

/** Builds the real client stack on top of the fake transport. */
function setup(...outcomes: Outcome[]) {
	const fake = fakeRequest(...outcomes);
	const clients = createApiClients({
		baseUrl: BASE_URL,
		username: 'alice',
		appPassword: PASSWORD,
		request: fake.fn,
		retry: false,
	});
	return { ocs: clients.ocs, calls: fake.calls };
}

describe('OcsClient.request headers', () => {
	it('sends the OCS headers on a GET and the URL below the server base', async () => {
		const { ocs, calls } = setup(replyFromFixture(loadFixture('collectives-list.json')));

		await ocs.request('GET', OCS_COLLECTIVES + '/collectives');

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'GET', url: BASE_URL + OCS_COLLECTIVES + '/collectives' });
		expect(calls[0]?.headers).toMatchObject({ 'OCS-APIRequest': 'true', 'Accept': 'application/json' });
	});

	it('adds a JSON Content-Type and the JSON-encoded body when a body is given', async () => {
		const { ocs, calls } = setup(replyFromFixture(loadFixture('collective-create.json')));

		await ocs.request('POST', OCS_COLLECTIVES + '/collectives', { name: 'Handbuch', emoji: '📘' });

		expect(calls[0]?.method).toBe('POST');
		expect(getHeader(calls[0]?.headers ?? {}, 'Content-Type')).toBe('application/json');
		expect(JSON.parse(calls[0]?.body as string)).toEqual({ name: 'Handbuch', emoji: '📘' });
	});

	it('sends neither a Content-Type nor a body when no body is given', async () => {
		const { ocs, calls } = setup(replyFromFixture(loadFixture('collectives-list.json')));

		await ocs.request('GET', OCS_COLLECTIVES + '/collectives');

		expect(getHeader(calls[0]?.headers ?? {}, 'Content-Type')).toBeUndefined();
		expect(calls[0]?.body).toBeUndefined();
	});
});

describe('OcsClient.request result', () => {
	it('returns the ocs.data object of a successful response', async () => {
		const fixture = loadFixture('collectives-list.json');
		const { ocs } = setup(replyFromFixture(fixture));

		const result = await ocs.request('GET', OCS_COLLECTIVES + '/collectives');

		expect(result).toEqual(fixture.response.ocs.data);
	});

	it('returns an empty array for a void endpoint that answers with data []', async () => {
		const { ocs } = setup(replyFromFixture(loadFixture('page-move-to-collective.json')));

		const result = await ocs.request('PUT', OCS_COLLECTIVES + '/collectives/1/pages/100/to/2', {});

		expect(result).toEqual([]);
	});
});

describe('OcsClient.request invalid 2xx bodies', () => {
	it.each([
		['an HTML login page', '<html>login</html>'],
		['an empty body', ''],
		['no ocs key', '{"data":{}}'],
		['ocs as a string', '{"ocs":"ok"}'],
		['ocs null', '{"ocs":null}'],
		['no data key', '{"ocs":{"meta":{"status":"ok","statuscode":200}}}'],
	])('maps a 200 with %s to ApiChangedError', async (_label, text) => {
		const { ocs } = setup(reply(200, text));

		const err = await captureError(ocs.request('GET', OCS_COLLECTIVES + '/collectives'));

		expect(err).toBeInstanceOf(ApiChangedError);
	});
});

describe('OcsClient.request error statuses', () => {
	it('maps the 403 of a member trying to trash a collective to ForbiddenError, not AuthError', async () => {
		const fixture = loadFixture('collective-trash-as-member.json');
		const { ocs } = setup(replyFromFixture(fixture));

		const err = await captureError(ocs.request('DELETE', OCS_COLLECTIVES + '/collectives/3'));

		expect(err).toBeInstanceOf(ForbiddenError);
		expect(err).not.toBeInstanceOf(AuthError);
		expect(String((err as Error).message)).not.toContain(PASSWORD);
	});

	it('maps the 400 of a duplicate tag to ServerError carrying status 400', async () => {
		const fixture = loadFixture('tag-create-duplicate.json');
		const { ocs } = setup(replyFromFixture(fixture));

		const err = await captureError(ocs.request('POST', OCS_COLLECTIVES + '/collectives/1/tags', { name: 'Projekt', color: '0082c9' }));

		expect(err).toBeInstanceOf(ServerError);
		expect(err).toMatchObject({ status: 400 });
	});
});
