// Emoji and tags from the vault to the server (architecture §7.5, M6). Imports nothing from 'obsidian'.
// The other direction (server → note) is the nc fields the content operations write from the planner's metadata.
import type { CollectiveId, PageInfo, Tag, TagId } from '../api/types';
import { readLocalFields } from '../mapping/frontmatter';
import type { LocalFields, NcMeta } from '../mapping/frontmatter';
import { DEFAULT_TAG_COLOR, findTagByName, resolveTagNames } from '../mapping/tags';
import { isRunFatal } from '../util/errors';
import { metaHash } from '../util/hash';
import type { ExecutorDeps, StructureApi } from './executorDeps';
import { livePage } from './executorScratch';
import { decideContent } from './decide';
import type { ContentAction } from './decide';
import type { PageState, SyncState } from './state';
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
 * Emoji and tags the note holds, as the server's tags (resolveTagNames), with their hash. null for a note without
 * frontmatter, for a tags property in a form that is not read and for an emoji that is not one emoji: such a note counts as
 * unchanged, nothing is sent for it.
 */
async function localMetaOf(text: string, collectiveId: CollectiveId, deps: ExecutorDeps): Promise<(LocalMeta & { hash: string }) | null> {
	const fields = readLocalFields(text);
	if (fields === null || fields.tags === null || fields.emojiInvalid) return null;
	const known = tagCache(deps, collectiveId).map((tag) => tag.name);
	const tags = resolveTagNames(fields.tags, known);
	return { emoji: fields.emoji, tags, hash: await metaHash(fields.emoji, tags) };
}

/**
 * What to do with the metadata of a page whose text is `text`: the same decision as for the content (architecture §7.3, decideContent)
 * on the hashes of emoji and tags: base = the state's metaHash, local = the note's fields, remote = `op.metaHash`.
 * 'adoptBase' counts as 'pull' (the nc fields are written in the server's spelling). An unknown base ('') and a note without
 * frontmatter or a tags property that is not read take the server's values. `local` is null for those; `invalidEmoji` tells
 * that the note's emoji is not one emoji (nothing is sent then).
 */
export async function decideMeta(op: MetaOp, state: PageState, text: string, deps: ExecutorDeps): Promise<{ action: ContentAction; local: LocalMeta | null; invalidEmoji: boolean }> {
	if (state.metaHash === '') return { action: 'pull', local: null, invalidEmoji: false };
	const local = await localMetaOf(text, op.meta.collectiveId, deps);
	const invalidEmoji = local === null && readLocalFields(text)?.emojiInvalid === true;
	if (invalidEmoji) deps.log.warn('Emoji not sent: the property holds text or more than one emoji', { pageId: op.page.id });
	const action = decideContent({
		baseHash: state.metaHash,
		localHash: local?.hash ?? state.metaHash,
		remoteHash: op.metaHash,
		status: state.status,
		strategy: deps.strategy,
	});
	return { action: action === 'adoptBase' ? 'pull' : action, local: local === null ? null : { emoji: local.emoji, tags: local.tags }, invalidEmoji };
}

/** Fields of a note that has no nc fields yet, as the tags the server knows (a new page: its tags are created). */
export function localMetaFromFields(fields: LocalFields, collectiveId: CollectiveId, deps: ExecutorDeps): LocalMeta {
	const known = tagCache(deps, collectiveId).map((tag) => tag.name);
	return { emoji: fields.emoji, tags: resolveTagNames(fields.tags ?? [], known) };
}

/** The tag for a name: from the cache, else created on the server. A duplicate error is settled by reading the tags again. */
async function tagFor(deps: ExecutorDeps, collectiveId: CollectiveId, name: string): Promise<CachedTag> {
	const api = requireApi(deps);
	const cached = findTagByName(tagCache(deps, collectiveId), name);
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
		const found = findTagByName(listed, name);
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
	return { meta, hash: await metaHash(meta.emoji, tags) };
}

/**
 * A page moved to another collective lost its tags (they belong to the collective, docs/api-notes.md §4). Assigns the tags
 * of the note again in the new collective, creating those it lacks. `page` is the page as listed in the new collective.
 * Returns the metadata the page has now, or null if the note has no frontmatter to read.
 */
export async function reassignTags(page: PageInfo, collectiveId: CollectiveId, text: string, deps: ExecutorDeps, result?: SyncResult): Promise<PushedMeta | null> {
	const fields = readLocalFields(text);
	if (fields === null) return null;
	const known = tagCache(deps, collectiveId).map((tag) => tag.name);
	const meta: NcMeta = {
		pageId: page.id,
		collectiveId,
		title: page.title,
		emoji: page.emoji,
		tags: [],
	};
	const tags = resolveTagNames(fields.tags ?? [], known);
	return pushLocalMeta({ page, meta, metaHash: '' }, { emoji: page.emoji, tags }, deps, result);
}
