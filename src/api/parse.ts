// Strict structure checks for Collectives API responses. Pure: no network, no Obsidian imports.
import { asAttachmentId, asCollectiveId, asPageId, asTagId, type Attachment, type Collective, type PageInfo, type Tag, type TrashedPage } from './types';
import { ApiChangedError } from '../util/errors';
import { isRecord } from '../util/isRecord';

interface FieldReader {
	number(key: string): number;
	numberOrNull(key: string): number | null;
	string(key: string): string;
	stringOrNull(key: string): string | null;
	boolean(key: string): boolean;
	numberArray(key: string): number[];
}

/** Starts reading the fields of one entity. Any object that is not a plain object is ApiChangedError. */
function reader(entity: string, raw: unknown): FieldReader {
	if (!isRecord(raw)) throw new ApiChangedError(`Unexpected ${entity}: not an object`);
	const obj = raw;

	const fail = (key: string, problem: string): never => {
		throw new ApiChangedError(`Unexpected ${entity}: field "${key}" ${problem}`);
	};
	const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

	return {
		number: (key) => {
			const value = obj[key];
			return isNumber(value) ? value : fail(key, 'is not a number');
		},
		numberOrNull: (key) => {
			const value = obj[key];
			if (value === null) return null;
			return isNumber(value) ? value : fail(key, 'is not a number or null');
		},
		string: (key) => {
			const value = obj[key];
			return typeof value === 'string' ? value : fail(key, 'is not a string');
		},
		stringOrNull: (key) => {
			const value = obj[key];
			if (value === null) return null;
			return typeof value === 'string' ? value : fail(key, 'is not a string or null');
		},
		boolean: (key) => {
			const value = obj[key];
			return typeof value === 'boolean' ? value : fail(key, 'is not a boolean');
		},
		numberArray: (key) => {
			const value: unknown = obj[key];
			if (!Array.isArray(value) || !value.every(isNumber)) return fail(key, 'is not a number array');
			return value;
		},
	};
}

/** The server reports a removed emoji as '' (it ignores null when removing, docs/api-notes.md); both mean: no emoji. */
function emojiOrNull(value: string | null): string | null {
	return value === '' ? null : value;
}

export function parseCollective(raw: unknown): Collective {
	const r = reader('Collective', raw);
	return {
		id: asCollectiveId(r.number('id')),
		circleId: r.string('circleId'),
		name: r.string('name'),
		slug: r.string('slug'),
		emoji: emojiOrNull(r.stringOrNull('emoji')),
		level: r.number('level'),
		canEdit: r.boolean('canEdit'),
		trashTimestamp: r.numberOrNull('trashTimestamp'),
	};
}

export function parsePageInfo(raw: unknown): PageInfo {
	const r = reader('PageInfo', raw);
	return { ...readPageFields(r), collectivePath: r.string('collectivePath') };
}

/** Like parsePageInfo, but `collectivePath` may be null: the trash list does not report it. */
export function parseTrashedPage(raw: unknown): TrashedPage {
	const r = reader('TrashedPage', raw);
	return { ...readPageFields(r), collectivePath: r.stringOrNull('collectivePath') };
}

function readPageFields(r: FieldReader): Omit<PageInfo, 'collectivePath'> {
	return {
		id: asPageId(r.number('id')),
		slug: r.string('slug'),
		title: r.string('title'),
		emoji: emojiOrNull(r.stringOrNull('emoji')),
		tags: r.numberArray('tags').map(asTagId),
		timestamp: r.number('timestamp'),
		size: r.number('size'),
		fileName: r.string('fileName'),
		filePath: r.string('filePath'),
		parentId: asPageId(r.number('parentId')),
		subpageOrder: r.numberArray('subpageOrder').map(asPageId),
		lastUserId: r.stringOrNull('lastUserId'),
		linkedPageIds: r.numberArray('linkedPageIds').map(asPageId),
		trashTimestamp: r.numberOrNull('trashTimestamp'),
	};
}

export function parseTag(raw: unknown): Tag {
	const r = reader('Tag', raw);
	return {
		id: asTagId(r.number('id')),
		collectiveId: asCollectiveId(r.number('collectiveId')),
		name: r.string('name'),
		color: r.string('color'),
	};
}

export function parseAttachment(raw: unknown): Attachment {
	const r = reader('Attachment', raw);
	return {
		id: asAttachmentId(r.number('id')),
		name: r.string('name'),
		filesize: r.number('filesize'),
		mimetype: r.string('mimetype'),
		timestamp: r.number('timestamp'),
		path: r.string('path'),
		src: r.string('src'),
		internalPath: r.string('internalPath'),
		hasPreview: r.boolean('hasPreview'),
		type: r.string('type'),
	};
}

/** Reads data[key] and requires an array; maps each element with `parse`. Wrong/missing → ApiChangedError naming the key. */
export function parseList<T>(data: unknown, key: string, parse: (raw: unknown) => T): T[] {
	const list: unknown = isRecord(data) ? data[key] : undefined;
	if (!Array.isArray(list)) throw new ApiChangedError(`Unexpected response: "${key}" is not an array`);
	return list.map((item: unknown) => parseNamed(key, item, parse));
}

/** Reads data[key] and parses it as a single object. Wrong/missing → ApiChangedError naming the key. */
export function parseItem<T>(data: unknown, key: string, parse: (raw: unknown) => T): T {
	const item: unknown = isRecord(data) ? data[key] : undefined;
	if (!isRecord(item)) throw new ApiChangedError(`Unexpected response: "${key}" is not an object`);
	return parseNamed(key, item, parse);
}

/** Runs a parser and prefixes its ApiChangedError with the key, so the message names the place in the response. */
function parseNamed<T>(key: string, raw: unknown, parse: (raw: unknown) => T): T {
	try {
		return parse(raw);
	} catch (err) {
		if (!(err instanceof ApiChangedError)) throw err;
		throw new ApiChangedError(`Unexpected response in "${key}": ${err.message}`, { cause: err });
	}
}
