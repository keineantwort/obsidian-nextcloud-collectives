// Sync state: types, strict parsing and stable serialization. Pure; persistence lives in stateStore.ts.
import { asAttachmentId, asCollectiveId, asPageId, asTagId } from '../api/types';
import type { AttachmentId, CollectiveId, PageId, TagId } from '../api/types';
import type { TagsProperty } from '../mapping/tags';
import { isRecord } from '../util/isRecord';

export const STATE_SCHEMA_VERSION = 1;

/** remoteMtime value meaning "remote version not confirmed": the next run must GET the page and compare hashes. */
export const UNCONFIRMED_REMOTE_MTIME = -1;
/** localMtime value meaning "local file not checked": the next run must hash the local file. */
export const UNCHECKED_LOCAL_MTIME = -1;

/**
 * synced: linked page, its file carries its nc_page_id. conflict: linked page with a conflict copy. collision: the target
 * path was held by a user file without nc_page_id; that file is not linked.
 */
export type PageStatus = 'synced' | 'conflict' | 'collision';

export interface PageState {
	pageId: PageId;
	collectiveId: CollectiveId;
	/**
	 * Path where the plugin last placed or linked the file. NOT updated by content sync after a local rename (the
	 * baseline for rename detection in M5); the current file is found by nc_page_id. For status 'collision': the actual
	 * spelling of the user file at the occupied path.
	 */
	localPath: string;
	/** file.stat.mtime of the local file right after our last write/check (ms). -1 = UNCHECKED_LOCAL_MTIME: the next run hashes the file. */
	localMtime: number;
	remoteFilePath: string;
	remoteFileName: string;
	parentId: PageId;
	remoteEtag: string;
	/** PageInfo.timestamp (s). -1 = UNCONFIRMED_REMOTE_MTIME: the next run GETs the page. */
	remoteMtime: number;
	remoteSize: number;
	/**
	 * sha256Hex(canonical remote format) at last sync. For status conflict/collision: hash of the remote text at the last
	 * conflict copy; '' only in states written before M4 (no known base) and for collisions that never had a copy.
	 */
	baseHash: string;
	/** metaHash(emoji, tag names) at last sync (M6: without the title). */
	metaHash: string;
	status: PageStatus;
	/** Path of the last conflict copy, or null. */
	conflictPath: string | null;
	/** M8; always [] in M3. */
	attachments: { id: AttachmentId; name: string; etag: string; localPath: string }[];
	lastSyncedAt: number;
}

export interface CollectiveState {
	collectiveId: CollectiveId;
	name: string;
	localFolder: string;
}

export interface SyncState {
	schemaVersion: 1;
	serverUrl: string;
	/** Nextcloud user id (WebDAV), from GET /ocs/v2.php/cloud/user. */
	user: string;
	/** Key: String(collectiveId). */
	collectives: Record<string, CollectiveState>;
	/** Key: String(pageId). */
	pages: Record<string, PageState>;
	/** Tag cache per collective (key String(collectiveId)). */
	tags: Record<string, { id: TagId; name: string; color: string }[]>;
	/**
	 * The setting tagsProperty of the last run (absent: nc_tags). If it differs from the setting now, the metaHash of all
	 * pages is forgotten, so the next run writes the server's tags into the other property instead of reading a missing one as 'no tags'.
	 */
	tagsProperty?: TagsProperty;
}

const STATE_KEYS = ['schemaVersion', 'serverUrl', 'user', 'collectives', 'pages', 'tags'];
const COLLECTIVE_KEYS = ['collectiveId', 'name', 'localFolder'];
const PAGE_KEYS = [
	'pageId', 'collectiveId', 'localPath', 'localMtime', 'remoteFilePath', 'remoteFileName', 'parentId', 'remoteEtag',
	'remoteMtime', 'remoteSize', 'baseHash', 'metaHash', 'status', 'conflictPath', 'attachments', 'lastSyncedAt',
];
const ATTACHMENT_KEYS = ['id', 'name', 'etag', 'localPath'];
const TAG_KEYS = ['id', 'name', 'color'];

export function emptyState(serverUrl: string, user: string): SyncState {
	return { schemaVersion: STATE_SCHEMA_VERSION, serverUrl, user, collectives: {}, pages: {}, tags: {} };
}

/** Strict validation of persisted JSON; anything unexpected (incl. other schemaVersion) → null. */
export function parseSyncState(raw: unknown): SyncState | null {
	if (!isRecord(raw) || !hasExactKeys(raw, 'tagsProperty' in raw ? [...STATE_KEYS, 'tagsProperty'] : STATE_KEYS)) return null;
	const { schemaVersion, serverUrl, user, collectives, pages, tags, tagsProperty } = raw;
	if ('tagsProperty' in raw && tagsProperty !== 'nc_tags' && tagsProperty !== 'tags') return null;
	if (schemaVersion !== STATE_SCHEMA_VERSION || !isText(serverUrl) || !isText(user)) return null;
	const parsedCollectives = parseRecord(collectives, parseCollectiveState, (key, value) => String(value.collectiveId) === key);
	const parsedPages = parseRecord(pages, parsePageState, (key, value) => String(value.pageId) === key);
	const parsedTags = parseRecord(tags, parseTagList, () => true);
	if (parsedCollectives === null || parsedPages === null || parsedTags === null) return null;
	return {
		schemaVersion: STATE_SCHEMA_VERSION, serverUrl, user, collectives: parsedCollectives, pages: parsedPages, tags: parsedTags,
		...(tagsProperty === 'tags' || tagsProperty === 'nc_tags' ? { tagsProperty } : {}),
	};
}

/** Stable JSON (keys of collectives/pages sorted numerically) so that unchanged state serializes identically. */
export function serializeSyncState(state: SyncState): string {
	const ordered = {
		schemaVersion: state.schemaVersion,
		serverUrl: state.serverUrl,
		user: state.user,
		collectives: state.collectives,
		pages: state.pages,
		tags: state.tags,
		...(state.tagsProperty === undefined ? {} : { tagsProperty: state.tagsProperty }),
	};
	return JSON.stringify(sortKeysDeep(ordered), null, 2);
}

/** Sorts object keys recursively. Integer-like keys (ids) are iterated in numeric order by the JS engine anyway. */
function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
	return value;
}

function isInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isText(value: unknown): value is string {
	return typeof value === 'string';
}

function isPageStatus(value: unknown): value is PageStatus {
	return value === 'synced' || value === 'conflict' || value === 'collision';
}

/** True for a page whose target path was occupied by a user file without nc_page_id. Such a file is never linked by path. */
export function isCollision(s: Pick<PageState, 'status'>): boolean {
	return s.status === 'collision';
}

/** True if the record has exactly the given keys (no more, no less). */
function hasExactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(raw).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

/** Parses a JSON array with a per-item parser; null if the value is no array or one item is invalid. */
function parseArray<T>(raw: unknown, parse: (item: unknown) => T | null): T[] | null {
	if (!Array.isArray(raw)) return null;
	const out: T[] = [];
	for (const item of raw) {
		const parsed = parse(item);
		if (parsed === null) return null;
		out.push(parsed);
	}
	return out;
}

/** Parses a record keyed by numeric id; `keyMatches` ties each key to its value. */
function parseRecord<T>(
	raw: unknown,
	parse: (item: unknown) => T | null,
	keyMatches: (key: string, value: T) => boolean,
): Record<string, T> | null {
	if (!isRecord(raw)) return null;
	const out: Record<string, T> = {};
	for (const [key, item] of Object.entries(raw)) {
		if (!/^\d+$/.test(key)) return null;
		const parsed = parse(item);
		if (parsed === null || !keyMatches(key, parsed)) return null;
		out[key] = parsed;
	}
	return out;
}

function parseCollectiveState(raw: unknown): CollectiveState | null {
	if (!isRecord(raw) || !hasExactKeys(raw, COLLECTIVE_KEYS)) return null;
	const { collectiveId, name, localFolder } = raw;
	if (!isInt(collectiveId) || !isText(name) || !isText(localFolder)) return null;
	return { collectiveId: asCollectiveId(collectiveId), name, localFolder };
}

function parseAttachment(raw: unknown): PageState['attachments'][number] | null {
	if (!isRecord(raw) || !hasExactKeys(raw, ATTACHMENT_KEYS)) return null;
	const { id, name, etag, localPath } = raw;
	if (!isInt(id) || !isText(name) || !isText(etag) || !isText(localPath)) return null;
	return { id: asAttachmentId(id), name, etag, localPath };
}

function parsePageState(raw: unknown): PageState | null {
	if (!isRecord(raw) || !hasExactKeys(raw, PAGE_KEYS)) return null;
	const {
		pageId, collectiveId, localPath, localMtime, remoteFilePath, remoteFileName, parentId, remoteEtag, remoteMtime,
		remoteSize, baseHash, metaHash, status, conflictPath, attachments, lastSyncedAt,
	} = raw;
	if (!isInt(pageId) || !isInt(collectiveId) || !isText(localPath) || !isFiniteNumber(localMtime)) return null;
	if (!isText(remoteFilePath) || !isText(remoteFileName) || !isInt(parentId) || !isText(remoteEtag)) return null;
	if (!isFiniteNumber(remoteMtime) || !isFiniteNumber(remoteSize) || !isText(baseHash) || !isText(metaHash)) return null;
	if (!isPageStatus(status) || (conflictPath !== null && !isText(conflictPath))) return null;
	const parsedAttachments = parseArray(attachments, parseAttachment);
	if (parsedAttachments === null || !isFiniteNumber(lastSyncedAt)) return null;
	return {
		pageId: asPageId(pageId),
		collectiveId: asCollectiveId(collectiveId),
		localPath,
		localMtime,
		remoteFilePath,
		remoteFileName,
		parentId: asPageId(parentId),
		remoteEtag,
		remoteMtime,
		remoteSize,
		baseHash,
		metaHash,
		status,
		conflictPath,
		attachments: parsedAttachments,
		lastSyncedAt,
	};
}

function parseTag(raw: unknown): { id: TagId; name: string; color: string } | null {
	if (!isRecord(raw) || !hasExactKeys(raw, TAG_KEYS)) return null;
	const { id, name, color } = raw;
	if (!isInt(id) || !isText(name) || !isText(color)) return null;
	return { id: asTagId(id), name, color };
}

function parseTagList(raw: unknown): { id: TagId; name: string; color: string }[] | null {
	return parseArray(raw, parseTag);
}
