import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAttachment, parseCollective, parseItem, parseList, parsePageInfo, parseTag, parseTrashedPage } from '../../src/api/parse';
import { ApiChangedError } from '../../src/util/errors';

type Raw = Record<string, unknown>;

interface OcsFixture {
	response: { ocs: { data: Record<string, unknown> } };
}

/** Returns the `ocs.data` object of a fixture file in tests/fixtures/m0. */
function loadData(name: string): Record<string, unknown> {
	const fixture = JSON.parse(readFileSync(new URL(`../fixtures/m0/${name}`, import.meta.url), 'utf8')) as OcsFixture;
	return fixture.response.ocs.data;
}

/** Returns element `index` of the list `key` in a fixture's ocs.data. */
function rawAt(name: string, key: string, index: number): Raw {
	return (loadData(name)[key] as Raw[])[index] as Raw;
}

function withField(raw: Raw, key: string, value: unknown): Raw {
	return { ...raw, [key]: value };
}

function withoutField(raw: Raw, key: string): Raw {
	const copy = { ...raw };
	delete copy[key];
	return copy;
}

/** Runs a synchronous function and returns the error it throws (fails the test if it does not throw). */
function captureSync(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected the function to throw, but it returned');
}

/** Asserts that `fn` throws an ApiChangedError, and that its message names `field` when one is given. */
function expectApiChanged(fn: () => unknown, field?: string): void {
	const err = captureSync(fn);

	expect(err).toBeInstanceOf(ApiChangedError);
	if (field !== undefined) expect(String((err as Error).message)).toContain(field);
}

const COLLECTIVE_FIELDS = ['id', 'circleId', 'name', 'slug', 'emoji', 'level', 'canEdit', 'trashTimestamp'];
const PAGE_FIELDS = [
	'id', 'slug', 'title', 'emoji', 'tags', 'timestamp', 'size', 'fileName', 'filePath', 'collectivePath',
	'parentId', 'subpageOrder', 'lastUserId', 'linkedPageIds', 'trashTimestamp',
];
const TAG_FIELDS = ['id', 'collectiveId', 'name', 'color'];
const ATTACHMENT_FIELDS = ['id', 'name', 'filesize', 'mimetype', 'timestamp', 'path', 'src', 'internalPath', 'hasPreview', 'type'];

const PARSERS: Array<[string, (raw: unknown) => unknown]> = [
	['parseCollective', parseCollective],
	['parsePageInfo', parsePageInfo],
	['parseTag', parseTag],
	['parseAttachment', parseAttachment],
];

describe('parseCollective', () => {
	it('maps collective 1 of the collectives list fixture and drops unused server fields', () => {
		const raw = rawAt('collectives-list.json', 'collectives', 0);

		const result = parseCollective(raw);

		expect(result).toEqual({
			id: 1,
			circleId: 'CIRCLE_ID_1',
			name: 'Handbuch',
			slug: 'Handbuch',
			emoji: '📘',
			level: 9,
			canEdit: true,
			trashTimestamp: null,
		});
		expect(result).not.toHaveProperty('pageMode');
		expect(result).not.toHaveProperty('shareToken');
	});

	it('accepts a null emoji', () => {
		const raw = rawAt('collectives-list.json', 'collectives', 1);

		const result = parseCollective(raw);

		expect(result.emoji).toBeNull();
		expect(result.name).toBe('Projekte');
	});

	it('maps the trashTimestamp of a trashed collective', () => {
		const raw = rawAt('collectives-trash-list.json', 'collectives', 0);

		const result = parseCollective(raw);

		expect(result).toMatchObject({ id: 2, circleId: 'CIRCLE_ID_2', name: 'Projekte Neu', trashTimestamp: 1792138979 });
	});

	it.each(COLLECTIVE_FIELDS)('rejects a missing field "%s" with ApiChangedError naming it', (field) => {
		const raw = withoutField(rawAt('collectives-list.json', 'collectives', 0), field);

		expectApiChanged(() => parseCollective(raw), field);
	});

	it.each([
		['id as numeric string', 'id', '1'],
		['name as number', 'name', 5],
		['canEdit as string', 'canEdit', 'yes'],
		['level as null', 'level', null],
		['trashTimestamp as string', 'trashTimestamp', '1792138979'],
	])('rejects %s with ApiChangedError naming the field', (_label, field, value) => {
		const raw = withField(rawAt('collectives-list.json', 'collectives', 0), field, value);

		expectApiChanged(() => parseCollective(raw), field);
	});
});

describe('parsePageInfo', () => {
	it('maps the landing page (id 92) of the pages list fixture', () => {
		const raw = rawAt('pages-list-final.json', 'pages', 0);

		const result = parsePageInfo(raw);

		expect(result).toEqual({
			id: 92,
			slug: '',
			title: 'Landing page',
			emoji: null,
			tags: [],
			timestamp: 1792138978,
			size: 324,
			fileName: 'Readme.md',
			filePath: '',
			collectivePath: '.Collectives/Handbuch',
			parentId: 0,
			subpageOrder: [98, 97],
			lastUserId: 'alice',
			linkedPageIds: [97, 98, 100],
			trashTimestamp: null,
		});
	});

	it('maps a nested page (id 98) with its file path and parent', () => {
		const raw = rawAt('pages-list-final.json', 'pages', 2);

		const result = parsePageInfo(raw);

		expect(result).toMatchObject({
			id: 98,
			title: 'Prozesse',
			fileName: 'Readme.md',
			filePath: 'Prozesse',
			parentId: 92,
			subpageOrder: [101],
		});
	});

	it('maps tags to numeric tag IDs and an emoji from the emoji-set fixture', () => {
		const raw = loadData('page-emoji-set.json')['page'] as Raw;

		const result = parsePageInfo(raw);

		expect(result).toMatchObject({ id: 100, emoji: '🏖️', tags: [1] });
	});

	it('does not expose server fields the plugin does not use', () => {
		const raw = rawAt('pages-list-final.json', 'pages', 0);
		expect(raw).toHaveProperty('lastUserDisplayName');
		expect(raw).toHaveProperty('isFullWidth');

		const result = parsePageInfo(raw);

		expect(result).not.toHaveProperty('lastUserDisplayName');
		expect(result).not.toHaveProperty('isFullWidth');
		expect(result).not.toHaveProperty('filePathString');
		expect(result).not.toHaveProperty('collectiveNameWithEmoji');
		expect(result).not.toHaveProperty('shareToken');
	});

	it('accepts null for emoji, trashTimestamp and lastUserId', () => {
		const raw = withField(
			withField(rawAt('pages-list-final.json', 'pages', 1), 'lastUserId', null),
			'trashTimestamp',
			null,
		);

		const result = parsePageInfo(raw);

		expect(result).toMatchObject({ emoji: null, trashTimestamp: null, lastUserId: null });
	});

	it.each(PAGE_FIELDS)('rejects a missing field "%s" with ApiChangedError naming it', (field) => {
		const raw = withoutField(rawAt('pages-list-final.json', 'pages', 1), field);

		expectApiChanged(() => parsePageInfo(raw), field);
	});

	it.each([
		['tags as a string', 'tags', '1'],
		['tags containing a string', 'tags', ['1']],
		['id as numeric string', 'id', '92'],
		['title as null', 'title', null],
		['parentId as null', 'parentId', null],
		['subpageOrder as object', 'subpageOrder', {}],
		['linkedPageIds containing null', 'linkedPageIds', [97, null]],
		['timestamp as numeric string', 'timestamp', '1792138978'],
		['size as NaN', 'size', Number.NaN],
		['size as Infinity', 'size', Number.POSITIVE_INFINITY],
		['fileName as number', 'fileName', 42],
		['lastUserId as number', 'lastUserId', 7],
	])('rejects %s with ApiChangedError naming the field', (_label, field, value) => {
		const raw = withField(rawAt('pages-list-final.json', 'pages', 1), field, value);

		expectApiChanged(() => parsePageInfo(raw), field);
	});
});

describe('parseTrashedPage', () => {
	it('accepts collectivePath null, as the server sends it in the trash list', () => {
		const raw = rawAt('pages-trash-list.json', 'pages', 0);

		const result = parseTrashedPage(raw);

		expect(result).toMatchObject({ id: 98, title: 'Prozesse', collectivePath: null, trashTimestamp: 1792138979, subpageOrder: [101] });
	});

	it('keeps a string collectivePath', () => {
		const raw = withField(rawAt('pages-trash-list.json', 'pages', 0), 'collectivePath', '.Collectives/Handbuch');

		expect(parseTrashedPage(raw).collectivePath).toBe('.Collectives/Handbuch');
	});

	it('rejects a missing collectivePath and other page fields like parsePageInfo', () => {
		const raw = rawAt('pages-trash-list.json', 'pages', 0);

		expectApiChanged(() => parseTrashedPage(withoutField(raw, 'collectivePath')), 'collectivePath');
		expectApiChanged(() => parseTrashedPage(withField(raw, 'tags', 'x')), 'tags');
	});

	it('is stricter in parsePageInfo: the same trash entry with collectivePath null is ApiChangedError there', () => {
		const raw = rawAt('pages-trash-list.json', 'pages', 0);

		expectApiChanged(() => parsePageInfo(raw), 'collectivePath');
	});
});

describe('parseTag', () => {
	it('maps the tag of the tags list fixture', () => {
		const raw = rawAt('tags-list.json', 'tags', 0);

		const result = parseTag(raw);

		expect(result).toEqual({ id: 1, collectiveId: 1, name: 'Projekt', color: '0082c9' });
	});

	it.each(TAG_FIELDS)('rejects a missing field "%s" with ApiChangedError naming it', (field) => {
		const raw = withoutField(rawAt('tags-list.json', 'tags', 0), field);

		expectApiChanged(() => parseTag(raw), field);
	});

	it.each([
		['id as string', 'id', '1'],
		['collectiveId as string', 'collectiveId', '1'],
		['color as number', 'color', 82],
		['name as null', 'name', null],
	])('rejects %s with ApiChangedError naming the field', (_label, field, value) => {
		const raw = withField(rawAt('tags-list.json', 'tags', 0), field, value);

		expectApiChanged(() => parseTag(raw), field);
	});
});

describe('parseAttachment', () => {
	it('maps the attachment of the attachments list fixture', () => {
		const raw = rawAt('attachments-list.json', 'attachments', 0);

		const result = parseAttachment(raw);

		expect(result).toEqual({
			id: 108,
			name: 'bild.png',
			filesize: 69,
			mimetype: 'image/png',
			timestamp: 1792138978,
			path: '/.Collectives/Handbuch/.attachments.97/bild.png',
			src: '.attachments.97/bild.png',
			internalPath: '.attachments.97/bild.png',
			hasPreview: true,
			type: 'text',
		});
	});

	it.each(ATTACHMENT_FIELDS)('rejects a missing field "%s" with ApiChangedError naming it', (field) => {
		const raw = withoutField(rawAt('attachments-list.json', 'attachments', 0), field);

		expectApiChanged(() => parseAttachment(raw), field);
	});

	it.each([
		['hasPreview as string', 'hasPreview', 'yes'],
		['filesize as numeric string', 'filesize', '69'],
		['src as null', 'src', null],
	])('rejects %s with ApiChangedError naming the field', (_label, field, value) => {
		const raw = withField(rawAt('attachments-list.json', 'attachments', 0), field, value);

		expectApiChanged(() => parseAttachment(raw), field);
	});
});

describe('parsers reject non-object input', () => {
	it.each(PARSERS)('%s rejects null, undefined, primitives and arrays with ApiChangedError', (_name, parse) => {
		for (const raw of [null, undefined, 'text', 42, [], [{}]]) {
			expectApiChanged(() => parse(raw));
		}
	});
});

describe('parseList', () => {
	it('maps every page of the pages list fixture in order', () => {
		const data = loadData('pages-list-final.json');

		const result = parseList(data, 'pages', parsePageInfo);

		expect(result.map((page) => page.id)).toEqual([92, 102, 98, 101, 97, 114]);
	});

	it('returns an empty array for an empty list', () => {
		const result = parseList({ pages: [] }, 'pages', parsePageInfo);

		expect(result).toEqual([]);
	});

	it.each([
		['missing key', {}],
		['key is an object', { pages: {} }],
		['key is a string', { pages: 'x' }],
	])('rejects a list whose key is %s and names the key', (_label, data) => {
		expectApiChanged(() => parseList(data, 'pages', parsePageInfo), 'pages');
	});

	it('rejects a list containing an element that does not match the parser', () => {
		const data = { pages: [{ id: '92' }] };

		expectApiChanged(() => parseList(data, 'pages', parsePageInfo));
	});
});

describe('parseItem', () => {
	it('maps the single page of a page response', () => {
		const data = loadData('page-get-after-leaf-to-parent.json');

		const result = parseItem(data, 'page', parsePageInfo);

		expect(result).toMatchObject({ id: 98, filePath: 'Prozesse', subpageOrder: [100], parentId: 92 });
	});

	it('rejects missing key and names it', () => {
		expectApiChanged(() => parseItem({}, 'page', parsePageInfo), 'page');
	});

	it.each([
		['an array', { page: [] }],
		['a string', { page: 'x' }],
		['null', { page: null }],
	])('rejects a key holding %s and names the key', (_label, data) => {
		expectApiChanged(() => parseItem(data, 'page', parsePageInfo), 'page');
	});

	it('rejects a single object that does not match the parser', () => {
		const data = { tag: { id: 1 } };

		expectApiChanged(() => parseItem(data, 'tag', parseTag), 'tag');
	});
});

describe('emoji reported as an empty string (M6)', () => {
	it('maps the server\'s "no emoji" of pages and collectives to null', () => {
		const page = { id: 1, slug: 's', title: 't', emoji: '', tags: [], timestamp: 1, size: 1, fileName: 't.md', filePath: '', collectivePath: '.Collectives/C', parentId: 0, subpageOrder: [], lastUserId: null, linkedPageIds: [], trashTimestamp: null };
		const collective = { id: 1, circleId: 'c', name: 'C', slug: 'c', emoji: '', level: 9, canEdit: true, trashTimestamp: null };

		expect(parsePageInfo(page).emoji).toBeNull();
		expect(parseCollective(collective).emoji).toBeNull();
	});
});
