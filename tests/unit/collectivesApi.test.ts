import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CollectivesApi } from '../../src/api/collectivesApi';
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../../src/api/types';
import { createApiClients } from '../../src/api/clients';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';
import { ApiChangedError, ForbiddenError } from '../../src/util/errors';

const BASE_URL = 'https://cloud.example.com';
const OCS = BASE_URL + '/ocs/v2.php/apps/collectives/api/v1.0';
const CIRCLES = BASE_URL + '/ocs/v2.php/apps/circles';
const PASSWORD = 'pw-SECRET-123';

type Outcome = HttpResponse | Error;

interface Harness {
	api: CollectivesApi;
	calls: HttpRequest[];
}

/** Hand-written RequestFn: records every request and answers with the queued outcomes, one per call. */
function setup(...outcomes: Outcome[]): Harness {
	const calls: HttpRequest[] = [];
	const queue = [...outcomes];
	const request: RequestFn = async (req) => {
		calls.push(req);
		const next = queue.shift();
		if (next === undefined) throw new Error('fake: unexpected request, no outcome queued');
		if (next instanceof Error) throw next;
		return next;
	};
	const clients = createApiClients({ baseUrl: BASE_URL, username: 'alice', appPassword: PASSWORD, request, retry: false });
	return { api: clients.collectives, calls };
}

interface Fixture {
	request: { method: string; path: string; body: unknown };
	status: number;
	response: unknown;
}

function loadFixture(name: string): Fixture {
	return JSON.parse(readFileSync(new URL(`../fixtures/m0/${name}`, import.meta.url), 'utf8')) as Fixture;
}

function replyFromFixture(fixture: Fixture): HttpResponse {
	return { status: fixture.status, headers: {}, text: JSON.stringify(fixture.response) };
}

/** Minimal valid OCS envelope with the given data, for endpoints without a fixture. */
function ocsOk(data: unknown): HttpResponse {
	return {
		status: 200,
		headers: {},
		text: JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200, message: 'OK' }, data } }),
	};
}

/** The JSON body that was sent with the first request, or undefined if there was none. */
function sentBody(calls: HttpRequest[]): unknown {
	const body = calls[0]?.body;
	return body === undefined ? undefined : JSON.parse(body);
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

describe('listCollectives', () => {
	it('sends GET /collectives and maps the collectives of the fixture', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('collectives-list.json')));

		const result = await api.listCollectives();

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives' });
		expect(calls[0]?.body).toBeUndefined();
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ id: 1, circleId: 'CIRCLE_ID_1', name: 'Handbuch', emoji: '📘' });
		expect(result[1]).toMatchObject({ id: 2, circleId: 'CIRCLE_ID_2', name: 'Projekte', emoji: null });
	});

	it('rejects a 2xx collectives entry that lacks circleId with ApiChangedError', async () => {
		const { api } = setup(ocsOk({ collectives: [{ id: 1, name: 'x', slug: 'x', emoji: null, level: 9, canEdit: true, trashTimestamp: null }] }));

		await expect(api.listCollectives()).rejects.toBeInstanceOf(ApiChangedError);
	});
});

describe('createCollective', () => {
	it('sends POST /collectives with name and emoji and maps the created collective', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('collective-create.json')));

		const result = await api.createCollective('Handbuch', '📘');

		expect(calls[0]).toMatchObject({ method: 'POST', url: OCS + '/collectives' });
		expect(sentBody(calls)).toStrictEqual({ name: 'Handbuch', emoji: '📘' });
		expect(result).toMatchObject({ id: 1, circleId: 'CIRCLE_ID_1', name: 'Handbuch', emoji: '📘' });
	});

	it('omits the emoji key from the body when no emoji is given', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('collective-create.json')));

		await api.createCollective('Handbuch');

		expect(sentBody(calls)).toStrictEqual({ name: 'Handbuch' });
	});
});

describe('setCollectiveEmoji', () => {
	it('sends PUT /collectives/{id} with the emoji and resolves without a value', async () => {
		const { api, calls } = setup(ocsOk({}));

		const result = await api.setCollectiveEmoji(asCollectiveId(1), '📘');

		expect(calls[0]).toMatchObject({ method: 'PUT', url: OCS + '/collectives/1' });
		expect(sentBody(calls)).toStrictEqual({ emoji: '📘' });
		expect(result).toBeUndefined();
	});

	it('keeps emoji null in the body so the emoji is removed', async () => {
		const { api, calls } = setup(ocsOk({}));

		await api.setCollectiveEmoji(asCollectiveId(1), null);

		expect(sentBody(calls)).toStrictEqual({ emoji: null });
	});
});

describe('renameCollective', () => {
	it('sends PUT with the new name to the circles API of the circle', async () => {
		const { api, calls } = setup(ocsOk([]));

		const result = await api.renameCollective('CIRCLE_ID_1', 'Neu');

		expect(calls[0]).toMatchObject({ method: 'PUT', url: CIRCLES + '/circles/CIRCLE_ID_1/name' });
		expect(sentBody(calls)).toStrictEqual({ value: 'Neu' });
		expect(result).toBeUndefined();
	});

	it('URL-encodes special characters of the circle ID in the path', async () => {
		const { api, calls } = setup(ocsOk([]));

		await api.renameCollective('a b/c', 'X');

		expect(calls[0]?.url).toBe(CIRCLES + '/circles/a%20b%2Fc/name');
	});
});

describe('trashCollective', () => {
	it('sends DELETE /collectives/{id} and resolves without a value', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('collective-trash.json')));

		const result = await api.trashCollective(asCollectiveId(2));

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: OCS + '/collectives/2' });
		expect(result).toBeUndefined();
	});

	it('maps the 403 of a plain member to ForbiddenError without leaking the password', async () => {
		const { api } = setup(replyFromFixture(loadFixture('collective-trash-as-member.json')));

		const err = await captureError(api.trashCollective(asCollectiveId(3)));

		expect(err).toBeInstanceOf(ForbiddenError);
		expect(String((err as Error).message)).not.toContain(PASSWORD);
	});
});

describe('listTrashedCollectives', () => {
	it('sends GET /collectives/trash and maps the trashed collective', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('collectives-trash-list.json')));

		const result = await api.listTrashedCollectives();

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/trash' });
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ id: 2, name: 'Projekte Neu', circleId: 'CIRCLE_ID_2', trashTimestamp: 1792138979 });
	});
});

describe('restoreCollective', () => {
	it('sends PATCH /collectives/trash/{id} and resolves without a value', async () => {
		const { api, calls } = setup(ocsOk([]));

		const result = await api.restoreCollective(asCollectiveId(2));

		expect(calls[0]).toMatchObject({ method: 'PATCH', url: OCS + '/collectives/trash/2' });
		expect(result).toBeUndefined();
	});
});

describe('listPages', () => {
	it('sends GET /collectives/{id}/pages and maps every page of the fixture', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('pages-list-final.json')));

		const result = await api.listPages(asCollectiveId(1));

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/1/pages' });
		expect(result.map((page) => page.id)).toEqual([92, 102, 98, 101, 97, 114]);
		expect(result[0]).toMatchObject({ id: 92, title: 'Landing page', parentId: 0, fileName: 'Readme.md' });
	});
});

describe('getPage', () => {
	it('sends GET /collectives/{id}/pages/{pageId} and maps the page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-get-after-leaf-to-parent.json')));

		const result = await api.getPage(asCollectiveId(1), asPageId(98));

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/1/pages/98' });
		expect(result).toMatchObject({ id: 98, filePath: 'Prozesse', subpageOrder: [100], parentId: 92 });
	});
});

describe('createPage', () => {
	it('sends POST with the title to the parent page and maps the created page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-create.json')));

		const result = await api.createPage(asCollectiveId(1), asPageId(92), 'Onboarding');

		expect(calls[0]).toMatchObject({ method: 'POST', url: OCS + '/collectives/1/pages/92' });
		expect(sentBody(calls)).toStrictEqual({ title: 'Onboarding' });
		expect(result).toMatchObject({ id: 97, title: 'Onboarding', fileName: 'Onboarding.md' });
	});
});

describe('updatePage', () => {
	it('sends only the given title together with copy false', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-rename.json')));

		const result = await api.updatePage(asCollectiveId(1), asPageId(101), { title: 'Umbenannt' });

		expect(calls[0]).toMatchObject({ method: 'PUT', url: OCS + '/collectives/1/pages/101' });
		expect(sentBody(calls)).toStrictEqual({ title: 'Umbenannt', copy: false });
		expect(result).toMatchObject({ id: 101, title: 'Umbenannt' });
	});

	it('sends parentId and index together with copy false when the page is moved', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-move.json')));

		const result = await api.updatePage(asCollectiveId(1), asPageId(101), { parentId: asPageId(98), index: 0 });

		expect(sentBody(calls)).toStrictEqual({ parentId: 98, index: 0, copy: false });
		expect(result).toMatchObject({ id: 101 });
	});
});

describe('movePageToCollective', () => {
	it('sends PUT to the move endpoint with copy false and no target keys', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-move-to-collective.json')));

		const result = await api.movePageToCollective(asCollectiveId(1), asPageId(100), asCollectiveId(2));

		expect(calls[0]).toMatchObject({ method: 'PUT', url: OCS + '/collectives/1/pages/100/to/2' });
		expect(sentBody(calls)).toStrictEqual({ copy: false });
		expect(result).toBeUndefined();
	});

	it('sends parentId and index of the target together with copy false', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-move-to-collective.json')));

		await api.movePageToCollective(asCollectiveId(1), asPageId(100), asCollectiveId(2), { parentId: asPageId(92), index: 1 });

		expect(sentBody(calls)).toStrictEqual({ parentId: 92, index: 1, copy: false });
	});
});

describe('setPageEmoji', () => {
	it('sends the emoji and maps the returned page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-emoji-set.json')));

		const result = await api.setPageEmoji(asCollectiveId(1), asPageId(100), '🏖️');

		expect(calls[0]).toMatchObject({ method: 'PUT', url: OCS + '/collectives/1/pages/100/emoji' });
		expect(sentBody(calls)).toStrictEqual({ emoji: '🏖️' });
		expect(result).toMatchObject({ id: 100, emoji: '🏖️', tags: [1] });
	});

	it('keeps emoji null in the body and maps the page without an emoji', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-emoji-remove.json')));

		const result = await api.setPageEmoji(asCollectiveId(1), asPageId(97), null);

		expect(sentBody(calls)).toStrictEqual({ emoji: null });
		expect(result).toMatchObject({ id: 97, emoji: null });
	});
});

describe('addPageTag', () => {
	it('sends PUT to the tag endpoint without a body and maps the returned page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-tag-add.json')));

		const result = await api.addPageTag(asCollectiveId(1), asPageId(100), asTagId(1));

		expect(calls[0]).toMatchObject({ method: 'PUT', url: OCS + '/collectives/1/pages/100/tags/1' });
		expect(calls[0]?.body).toBeUndefined();
		expect(result).toMatchObject({ id: 100, tags: [1] });
	});
});

describe('removePageTag', () => {
	it('sends DELETE to the tag endpoint and resolves without a value', async () => {
		const { api, calls } = setup(ocsOk([]));

		const result = await api.removePageTag(asCollectiveId(1), asPageId(100), asTagId(1));

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: OCS + '/collectives/1/pages/100/tags/1' });
		expect(calls[0]?.body).toBeUndefined();
		expect(result).toBeUndefined();
	});
});

describe('trashPage', () => {
	it('sends DELETE /collectives/{id}/pages/{pageId} and resolves without a value', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-trash.json')));

		const result = await api.trashPage(asCollectiveId(1), asPageId(98));

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: OCS + '/collectives/1/pages/98' });
		expect(result).toBeUndefined();
	});
});

describe('listTrashedPages', () => {
	it('sends GET /collectives/{id}/pages/trash and maps the trashed page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('pages-trash-list.json')));

		const result = await api.listTrashedPages(asCollectiveId(1));

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/1/pages/trash' });
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ id: 98, title: 'Prozesse', trashTimestamp: 1792138979, collectivePath: null });
	});
});

describe('restorePage', () => {
	it('sends PATCH to the trash endpoint and maps the restored page', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('page-restore.json')));

		const result = await api.restorePage(asCollectiveId(1), asPageId(98));

		expect(calls[0]).toMatchObject({ method: 'PATCH', url: OCS + '/collectives/1/pages/trash/98' });
		expect(result).toMatchObject({ id: 98, title: 'Prozesse', trashTimestamp: null });
	});
});

describe('listTags', () => {
	it('sends GET /collectives/{id}/tags and maps the tags', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('tags-list.json')));

		const result = await api.listTags(asCollectiveId(1));

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/1/tags' });
		expect(result).toEqual([{ id: 1, collectiveId: 1, name: 'Projekt', color: '0082c9' }]);
	});
});

describe('createTag', () => {
	it('sends POST with name and color and maps the created tag', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('tag-create.json')));

		const result = await api.createTag(asCollectiveId(1), 'Projekt', '0082c9');

		expect(calls[0]).toMatchObject({ method: 'POST', url: OCS + '/collectives/1/tags' });
		expect(sentBody(calls)).toStrictEqual({ name: 'Projekt', color: '0082c9' });
		expect(result).toEqual({ id: 1, collectiveId: 1, name: 'Projekt', color: '0082c9' });
	});

	it.each(['#0082c9', 'abc', 'GGGGGG', '0082c9 '])('rejects the color %j with an Error and sends no request', async (color) => {
		const { api, calls } = setup();

		await expect(api.createTag(asCollectiveId(1), 'Projekt', color)).rejects.toThrow('Invalid tag color');
		expect(calls).toHaveLength(0);
	});

	it.each(['', '0082c9'])('accepts the color %j and sends it unchanged', async (color) => {
		const { api, calls } = setup(replyFromFixture(loadFixture('tag-create.json')));

		await api.createTag(asCollectiveId(1), 'Projekt', color);

		expect(calls).toHaveLength(1);
		expect(sentBody(calls)).toStrictEqual({ name: 'Projekt', color });
	});
});

describe('listAttachments', () => {
	it('sends GET /collectives/{id}/pages/{pageId}/attachments and maps the attachments', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('attachments-list.json')));

		const result = await api.listAttachments(asCollectiveId(1), asPageId(97));

		expect(calls[0]).toMatchObject({ method: 'GET', url: OCS + '/collectives/1/pages/97/attachments' });
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ id: 108, name: 'bild.png', src: '.attachments.97/bild.png', hasPreview: true });
	});
});

describe('deleteAttachment', () => {
	it('sends DELETE to the attachment endpoint and resolves without a value', async () => {
		const { api, calls } = setup(replyFromFixture(loadFixture('attachment-delete.json')));

		const result = await api.deleteAttachment(asCollectiveId(1), asPageId(100), asAttachmentId(110));

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: OCS + '/collectives/1/pages/100/attachments/110' });
		expect(result).toBeUndefined();
	});
});

describe('getCurrentUserId', () => {
	it('sends GET /ocs/v2.php/cloud/user and resolves with data.id', async () => {
		const { api, calls } = setup(ocsOk({ id: 'alice', 'display-name': 'Alice', email: null }));

		const result = await api.getCurrentUserId();

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'GET', url: BASE_URL + '/ocs/v2.php/cloud/user' });
		expect(calls[0]?.body).toBeUndefined();
		expect(result).toBe('alice');
	});

	it('rejects an empty id with ApiChangedError', async () => {
		const { api } = setup(ocsOk({ id: '' }));

		const err = await captureError(api.getCurrentUserId());

		expect(err).toBeInstanceOf(ApiChangedError);
		expect((err as Error).message).toBe('Unexpected response: "id" is not a non-empty string');
	});

	it('rejects a missing id with ApiChangedError', async () => {
		const { api } = setup(ocsOk({ 'display-name': 'Alice' }));

		await expect(api.getCurrentUserId()).rejects.toBeInstanceOf(ApiChangedError);
	});

	it('rejects a non-object data value with ApiChangedError', async () => {
		const { api } = setup(ocsOk([]));

		await expect(api.getCurrentUserId()).rejects.toBeInstanceOf(ApiChangedError);
	});
});
