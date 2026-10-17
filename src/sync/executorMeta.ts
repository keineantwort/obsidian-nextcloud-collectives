// Emoji and tags from the vault to the server (PLAN §7.5, M6). Imports nothing from 'obsidian'.
// The other direction (server → note) is the nc fields the content operations write from the planner's metadata.
import type { CollectiveId, PageInfo, Tag, TagId } from '../api/types';
import { readLocalFields } from '../mapping/frontmatter';
import type { LocalFields, NcMeta } from '../mapping/frontmatter';
import { DEFAULT_TAG_COLOR, findTagByName, resolveTagNames } from '../mapping/tags';
import type { TagsProperty } from '../mapping/tags';
import { isRunFatal } from '../util/errors';
import { metaHash } from '../util/hash';
import type { ExecutorDeps, StructureApi } from './executorDeps';
import { livePage } from './executorScratch';
import type { SyncState } from './state';
import type { SyncResult } from './types';

/** What the metadata steps need of a page operation. */
export interface MetaOp {
	page: PageInfo;
	meta: NcMeta;
	metaHash: string;
}

/** Emoji and tags a note wants; the tags are spelled as the server's tags (resolveTagNames). */
export interface LocalMeta {
	emoji: string | null;
	tags: string[];
}

/** The metadata of a page after a push to the server, with its hash. */
export interface PushedMeta {
	meta: NcMeta;
	hash: string;
}

type CachedTag = SyncState['tags'][string][number];

function propertyOf(deps: ExecutorDeps): TagsProperty {
	return deps.tagsProperty ?? 'nc_tags';
}

function requireApi(deps: ExecutorDeps): StructureApi {
	if (deps.api === undefined) throw new Error('Metadata operations need the Collectives API');
	return deps.api;
}

function tagCache(deps: ExecutorDeps, collectiveId: CollectiveId): CachedTag[] {
	return (deps.state.tags[String(collectiveId)] ??= []);
}

/** The tag cache of a collective, replaced by the tags the server lists now (sorted by id like the planner's cache). */
function storeTags(deps: ExecutorDeps, collectiveId: CollectiveId, tags: readonly Tag[]): CachedTag[] {
	const entries = tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })).sort((a, b) => Number(a.id) - Number(b.id));
	deps.state.tags[String(collectiveId)] = entries;
	return entries;
}

/**
 * Emoji and tags the note at `text` carries when they differ from the metadata the sync last agreed on (`op.metaHash`),
 * else null. Null too if the text has no frontmatter (nothing to read). Only meaningful if the server did not change the
 * metadata since: when it did, the server wins (see noteRemoteWins).
 */
export async function readLocalMeta(op: MetaOp, text: string, deps: ExecutorDeps): Promise<LocalMeta | null> {
	const property = propertyOf(deps);
	const fields = readLocalFields(text, property);
	if (fields === null) return null;
	const known = tagCache(deps, op.meta.collectiveId).map((tag) => tag.name);
	const local: LocalMeta = { emoji: fields.emoji, tags: resolveTagNames(fields.tags, known, property) };
	return (await metaHash(op.meta.title, local.emoji, local.tags)) === op.metaHash ? null : local;
}

/** Fields of a note that has no nc fields yet, as the tags the server knows (a new page: its tags are created). */
export function localMetaOf(fields: LocalFields, collectiveId: CollectiveId, deps: ExecutorDeps): LocalMeta {
	const known = tagCache(deps, collectiveId).map((tag) => tag.name);
	return { emoji: fields.emoji, tags: resolveTagNames(fields.tags, known, propertyOf(deps)) };
}

/** Logs that the server's metadata replaces differing changes in the note (PLAN §7.5: the server wins). */
export async function noteRemoteWins(op: MetaOp, text: string, deps: ExecutorDeps): Promise<void> {
	const fields = readLocalFields(text, propertyOf(deps));
	if (fields === null) return;
	const known = tagCache(deps, op.meta.collectiveId).map((tag) => tag.name);
	const tags = resolveTagNames(fields.tags, known, propertyOf(deps));
	if ((await metaHash(op.meta.title, fields.emoji, tags)) !== op.metaHash) {
		deps.log.info('Metadata changed on the server: it replaces the metadata of the note', { pageId: op.page.id });
	}
}

/** The tag for a name: from the cache, else created on the server. A duplicate error is settled by reading the tags again. */
async function tagFor(deps: ExecutorDeps, collectiveId: CollectiveId, name: string): Promise<CachedTag> {
	const property = propertyOf(deps);
	const api = requireApi(deps);
	const cached = findTagByName(tagCache(deps, collectiveId), name, property);
	if (cached !== undefined) return cached;
	try {
		const created = await api.createTag(collectiveId, name, DEFAULT_TAG_COLOR);
		const cache = tagCache(deps, collectiveId);
		cache.push({ id: created.id, name: created.name, color: created.color });
		cache.sort((a, b) => Number(a.id) - Number(b.id));
		return { id: created.id, name: created.name, color: created.color };
	} catch (err) {
		if (isRunFatal(err)) throw err;
		// Someone created the tag since the listing (or the server compares names another way than the cache): use theirs.
		const listed = storeTags(deps, collectiveId, await api.listTags(collectiveId));
		const found = findTagByName(listed, name, property);
		if (found === undefined) throw err;
		return found;
	}
}

/**
 * Sends the note's emoji and tags to the server: sets the emoji, creates missing tags (once, default color), adds and
 * removes the page's tags. Returns the metadata the page has afterwards, with tags spelled as the server's tags.
 */
export async function pushLocalMeta(op: MetaOp, local: LocalMeta, deps: ExecutorDeps, result?: SyncResult): Promise<PushedMeta> {
	const api = requireApi(deps);
	const collectiveId = op.meta.collectiveId;
	const page = livePage(deps, op.page);
	if (local.emoji !== page.emoji) await api.setPageEmoji(collectiveId, page.id, local.emoji);
	const wanted: Tag[] = [];
	for (const name of local.tags) {
		const tag = await tagFor(deps, collectiveId, name);
		if (!wanted.some((known) => known.id === tag.id)) wanted.push({ id: tag.id, collectiveId, name: tag.name, color: tag.color });
	}
	const current = new Set<TagId>(page.tags);
	for (const tag of wanted) if (!current.has(tag.id)) await api.addPageTag(collectiveId, page.id, tag.id);
	for (const tagId of current) if (!wanted.some((tag) => tag.id === tagId)) await api.removePageTag(collectiveId, page.id, tagId);
	const tags = wanted.map((tag) => tag.name);
	const meta: NcMeta = { ...op.meta, emoji: local.emoji, tags };
	if (result) result.metaPushed++;
	deps.log.info('Emoji/tags sent to the server', { pageId: page.id });
	return { meta, hash: await metaHash(meta.title, meta.emoji, tags) };
}

/**
 * A page moved to another collective lost its tags (they belong to the collective, docs/api-notes.md §4). Assigns the tags
 * of the note again in the new collective, creating those it lacks. `page` is the page as listed in the new collective.
 * Returns the metadata the page has now, or null if the note has no frontmatter to read.
 */
export async function reassignTags(page: PageInfo, collectiveId: CollectiveId, text: string, deps: ExecutorDeps, result?: SyncResult): Promise<PushedMeta | null> {
	const property = propertyOf(deps);
	const fields = readLocalFields(text, property);
	if (fields === null) return null;
	const known = tagCache(deps, collectiveId).map((tag) => tag.name);
	const meta: NcMeta = {
		pageId: page.id,
		collectiveId,
		title: page.title,
		emoji: page.emoji,
		tags: [],
		...(property === 'tags' ? { tagsProperty: property } : {}),
	};
	const tags = resolveTagNames(fields.tags, known, property);
	return pushLocalMeta({ page, meta, metaHash: '' }, { emoji: page.emoji, tags }, deps, result);
}
