// Content operations of the sync executor (PLAN §7.3, spec M4 §9): create, adopt, update, push and metadata of linked pages.
// Imports nothing from 'obsidian': all vault access goes through VaultWriter.
import { isEtagConfirmed } from '../api/webdavClient';
import type { PageId, PageInfo } from '../api/types';
import { canonicalRemote, readPageId, replaceNcMeta, toLocal, toRemote, withMetaOnly } from '../mapping/frontmatter';
import { linksToLocal } from '../mapping/links';
import type { LinkContext } from '../mapping/links';
import { conflictPath, pathKey, remotePagePath } from '../mapping/paths';
import { sha256Hex } from '../util/hash';
import { ConflictError } from '../util/errors';
import { decideContent } from './decide';
import type { ConflictStrategy, ContentAction } from './decide';
import type { ExecutorDeps, VaultWriter } from './executorDeps';
import { decideMeta, pushLocalMeta } from './executorMeta';
import type { LocalMeta, PushedMeta } from './executorMeta';
import { livePage } from './executorScratch';
import { markConflict, markSynced, metaFor, newPageState, remoteFields, unconfirmedRemote } from './pageState';
import type { RemoteVersion } from './pageState';
import type { SyncOp } from './planner';
import { UNCONFIRMED_REMOTE_MTIME, isCollision } from './state';
import type { PageState } from './state';
import type { SyncResult } from './types';

/** Wait before fetching a page again when its ETag cannot be trusted for If-Match (ETags have one-second resolution). */
const CONFIRM_WAIT_MS = 1100;
/** Attempts of one page operation: a 412 on the upload starts a second attempt with a fresh GET; a 412 there is rethrown. */
const MAX_ATTEMPTS = 2;

/** A GET of a remote page with the values derived from it. */
export interface Fetched extends RemoteVersion {
	content: string;
	/** sha256Hex(canonicalRemote(content)). */
	hash: string;
	/** True if the ETag can be used for If-Match (isEtagConfirmed). */
	confirmed: boolean;
}

/** The local text of a page read for a content decision, with the mtime captured before the read. */
export interface LocalText {
	text: string;
	/** sha256Hex(toRemote(text, links)). */
	hash: string;
	mtimeBefore: number;
}

/** Operations that bring the content of a linked page in line with the remote: an update, or a push that may fall back to one. */
export type ContentOp = Extract<SyncOp, { kind: 'update' }> | Extract<SyncOp, { kind: 'push' }>;

/** The link context of a page's text: null-safe, so executors without a link index convert nothing. */
export function linkContext(deps: Pick<ExecutorDeps, 'links'>, pageId: PageId): LinkContext | undefined {
	return deps.links === undefined ? undefined : { index: deps.links, sourceId: pageId };
}

/** Writes `next` only if the file still holds `expected`. Returns null (nothing written) if the user changed it since the read. */
export async function writeIfUnchanged(vault: VaultWriter, path: string, expected: string, next: string): Promise<number | null> {
	let userChanged = false;
	const mtime = await vault.process(path, (cur) => {
		if (cur !== expected) {
			userChanged = true;
			return cur;
		}
		return next;
	});
	return userChanged ? null : mtime;
}

/** Creates the conflict copy of remote content next to `path`; returns its path. */
async function writeConflictCopy(deps: ExecutorDeps, pageId: PageId, path: string, remoteContent: string): Promise<string> {
	const copyPath = conflictPath(path, deps.conflictLabel, deps.now(), deps.occupied);
	// Wikilinks like in the note, so the copy reads the same; taking it over converts them back (toRemote).
	await deps.vault.create(copyPath, linksToLocal(canonicalRemote(remoteContent), linkContext(deps, pageId)));
	deps.occupied.add(pathKey(copyPath));
	return copyPath;
}

export function requireState(deps: ExecutorDeps, pageId: number): PageState {
	const entry = deps.state.pages[String(pageId)];
	if (entry === undefined) throw new Error(`no sync state for page ${pageId}`);
	return entry;
}

export function requireMtime(vault: VaultWriter, path: string): number {
	const mtime = vault.mtime(path);
	if (mtime === null) throw new Error(`no file at ${path}`);
	return mtime;
}

/** GET of a remote page. The state may store the page timestamp as remoteMtime only if the ETag is confirmed. */
export async function fetchPage(deps: ExecutorDeps, page: PageInfo): Promise<Fetched> {
	const file = await deps.webdav.get(remotePagePath(livePage(deps, page)));
	const confirmed = isEtagConfirmed(file);
	return {
		content: file.content,
		etag: file.etag,
		confirmed,
		remoteMtime: confirmed ? page.timestamp : UNCONFIRMED_REMOTE_MTIME,
		hash: await sha256Hex(canonicalRemote(file.content, linkContext(deps, page.id))),
	};
}

/** Reads the local text of a page for a content decision. The mtime is taken before the read (a later edit stays detectable). */
export async function readLocal(vault: VaultWriter, path: string, links?: LinkContext): Promise<LocalText> {
	const mtimeBefore = requireMtime(vault, path);
	const text = await vault.read(path);
	return { text, hash: await sha256Hex(toRemote(text, links)), mtimeBefore };
}


/** Content operations: they work on a linked page's file and text. */
export type ContentOpKind = 'create' | 'createConflict' | 'adopt' | 'update' | 'push' | 'updateMeta';

/** Runs one content operation and updates the counters. Returns true if the sync state changed. */
export function applyContentOp(op: Extract<SyncOp, { kind: ContentOpKind }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	switch (op.kind) {
		case 'create':
			return createPage(op, deps, result);
		case 'createConflict':
			return createConflict(op, deps, result);
		case 'adopt':
			return adoptPage(op, deps, result);
		case 'update':
			return updatePage(op, deps, result);
		case 'push':
			return pushPage(op, deps, result);
		case 'updateMeta':
			return updateMeta(op, deps, result);
	}
}

async function createPage(op: Extract<SyncOp, { kind: 'create' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const remote = await fetchPage(deps, op.page);
	const mtime = await deps.vault.create(op.path, toLocal(remote.content, metaFor(op.page, op.meta, op.path), linkContext(deps, op.page.id)));
	deps.occupied.add(pathKey(op.path));
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, remote, {
		localPath: op.path,
		localMtime: mtime,
		baseHash: remote.hash,
		metaHash: op.metaHash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: deps.now().getTime(),
	});
	result.created++;
	return true;
}

async function createConflict(op: Extract<SyncOp, { kind: 'createConflict' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const remote = await fetchPage(deps, op.page);
	const copyPath = await writeConflictCopy(deps, op.page.id, op.path, remote.content);
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, remote, {
		localPath: op.path,
		localMtime: deps.vault.mtime(op.path) ?? 0,
		// The base is the remote text of this copy, so the next run does not take it for a new remote change.
		baseHash: remote.hash,
		metaHash: op.metaHash,
		status: 'collision',
		conflictPath: copyPath,
		lastSyncedAt: deps.now().getTime(),
	});
	deps.log.info('Conflict copy created', { pageId: op.page.id, path: copyPath });
	result.conflicts++;
	return true;
}

async function adoptPage(op: Extract<SyncOp, { kind: 'adopt' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const remote = await fetchPage(deps, op.page);
	const localText = await deps.vault.read(op.path);
	const links = linkContext(deps, op.page.id);
	const remoteCanonical = canonicalRemote(remote.content, links);
	const now = deps.now().getTime();
	const meta = metaFor(op.page, op.meta, op.path);

	if (toRemote(localText, links) !== remoteCanonical) {
		// The base is unknown here: the page stays linked by nc_page_id, and the next run compares by content.
		const copyPath = await writeConflictCopy(deps, op.page.id, op.path, remote.content);
		deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, remote, {
			localPath: op.path,
			localMtime: deps.vault.mtime(op.path) ?? 0,
			baseHash: remote.hash,
			metaHash: op.metaHash,
			status: 'conflict',
			conflictPath: copyPath,
			lastSyncedAt: now,
		});
		deps.log.info('Conflict copy created', { pageId: op.page.id, path: copyPath });
		result.conflicts++;
		return true;
	}

	const next = replaceNcMeta(localText, meta);
	let mtime = deps.vault.mtime(op.path) ?? 0;
	if (next !== localText) {
		mtime = await deps.vault.process(op.path, (cur) => replaceNcMeta(cur, meta));
		result.metaUpdated++;
	} else {
		result.unchanged++;
	}
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, remote, {
		localPath: op.path,
		localMtime: mtime,
		baseHash: remote.hash,
		metaHash: op.metaHash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: now,
	});
	return true;
}

/**
 * Update of a known page (GET first). At most MAX_ATTEMPTS attempts; `attempt` is the number of this one. The content
 * decision (PLAN §7.3) picks the action. A push on an unconfirmed ETag waits, fetches again and decides once more.
 */
async function updatePage(op: ContentOp, deps: ExecutorDeps, result: SyncResult, attempt = 1): Promise<boolean> {
	const s = requireState(deps, op.page.id);
	const now = deps.now().getTime();
	let remote = await fetchPage(deps, op.page);
	if (isCollision(s)) return updateCollision(op, s, remote, deps, result, now);

	let local = await readLocal(deps.vault, op.path, linkContext(deps, op.page.id));
	let action = decideFor(s, local, remote, deps.strategy);
	if (action === 'push' && !remote.confirmed) {
		await deps.sleep(CONFIRM_WAIT_MS);
		remote = await fetchPage(deps, op.page);
		local = await readLocal(deps.vault, op.path, linkContext(deps, op.page.id));
		action = decideFor(s, local, remote, deps.strategy);
		if (action === 'push' && !remote.confirmed) {
			deps.log.info('Push deferred: remote version not confirmed', { pageId: op.page.id });
			deps.state.pages[String(op.page.id)] = { ...s, ...remoteFields(op.page, remote), lastSyncedAt: now };
			result.deferred++;
			return true;
		}
	}

	switch (action) {
		case 'none':
			return refreshUnchanged(op, s, remote, local, deps, result, now);
		case 'adoptBase':
			return adoptRemoteAsBase(op, s, remote, local, deps, result, now);
		case 'pull':
			return pullRemote(op, s, remote, local, deps, result, now);
		case 'conflict':
			return recordUpdateConflict(op, s, remote, deps, result, now);
		case 'push':
			return pushFetched(op, s, remote, local, deps, result, now, attempt);
	}
}

function decideFor(s: PageState, local: LocalText, remote: Fetched, strategy: ConflictStrategy): ContentAction {
	return decideContent({ baseHash: s.baseHash, localHash: local.hash, remoteHash: remote.hash, status: s.status, strategy });
}

/**
 * Action 'none': nothing to transfer. Refreshes the remote fields and, if the metadata changed, the nc fields. The base and
 * the status stay as they are (a conflict stays a conflict).
 */
async function refreshUnchanged(op: ContentOp, s: PageState, remote: Fetched, local: LocalText, deps: ExecutorDeps, result: SyncResult, now: number): Promise<boolean> {
	const refreshed = { ...s, ...remoteFields(op.page, remote), localMtime: local.mtimeBefore, lastSyncedAt: now };
	deps.state.pages[String(op.page.id)] = await applyMetaChange(op, refreshed, local.text, deps, result);
	result.unchanged++;
	return true;
}

/** Action 'adoptBase': both sides hold the same text already, so only the base moves on to the remote text. */
async function adoptRemoteAsBase(op: ContentOp, s: PageState, remote: Fetched, local: LocalText, deps: ExecutorDeps, result: SyncResult, now: number): Promise<boolean> {
	const adopted = markSynced(s, { page: op.page, remote, baseHash: remote.hash, metaHash: s.metaHash, localMtime: local.mtimeBefore, now });
	deps.state.pages[String(op.page.id)] = await applyMetaChange(op, adopted, local.text, deps, result);
	result.unchanged++;
	return true;
}

/**
 * Action 'pull': the local file takes the remote text. Written only if the user did not change the file since the read;
 * otherwise the remote text becomes a conflict copy.
 */
async function pullRemote(
	op: ContentOp,
	s: PageState,
	remote: Fetched,
	local: LocalText,
	deps: ExecutorDeps,
	result: SyncResult,
	now: number,
): Promise<boolean> {
	// The file takes the remote text, so the note's own emoji/tags changes are dealt with first (decideMeta).
	let pulledMeta: PushedMeta = { meta: op.meta, hash: op.metaHash };
	let metaConflict: LocalMeta | null = null;
	const decided = await decideMeta(op, s, local.text, deps);
	if (decided.invalidEmoji) result.metaInvalid++;
	if (decided.local !== null && decided.action === 'push') {
		pulledMeta = await pushLocalMeta(op, decided.local, deps, result);
	} else if (decided.local !== null && decided.action === 'conflict' && s.status === 'synced') {
		metaConflict = decided.local;
		pulledMeta = { meta: { ...op.meta, ...decided.local }, hash: op.metaHash };
	}
	const meta = metaFor(op.page, pulledMeta.meta, op.path);
	const mtime = await writeIfUnchanged(deps.vault, op.path, local.text, toLocal(remote.content, meta, linkContext(deps, op.page.id)));
	if (mtime === null) return recordUpdateConflict(op, s, remote, deps, result, now);
	if (local.hash !== s.baseHash) {
		// Both sides changed and the strategy is preferRemote (the only one that pulls then): the local changes are replaced.
		deps.log.info('Local changes replaced by remote text', { pageId: op.page.id });
	}
	deps.state.pages[String(op.page.id)] = markSynced(s, { page: op.page, remote, baseHash: remote.hash, metaHash: pulledMeta.hash, localMtime: mtime, now });
	if (metaConflict !== null) {
		deps.state.pages[String(op.page.id)] = await recordMetaConflict(op, requireState(deps, op.page.id), canonicalRemote(remote.content, linkContext(deps, op.page.id)), deps, result);
	}
	result.updated++;
	return true;
}

/**
 * Action 'push' during an update: the remote text was fetched and is confirmed (an unconfirmed ETag was refetched before).
 * A 412 means the remote changed again: the first attempt is followed by a second one with a fresh GET.
 */
async function pushFetched(
	op: ContentOp,
	s: PageState,
	remote: Fetched,
	local: LocalText,
	deps: ExecutorDeps,
	result: SyncResult,
	now: number,
	attempt: number,
): Promise<boolean> {
	let next: PageState;
	try {
		next = await uploadLocal(op, s, local, remote.etag, deps, now, result);
	} catch (err) {
		if (!(err instanceof ConflictError) || attempt >= MAX_ATTEMPTS) throw err;
		deps.log.info('Upload rejected, remote changed: fetching again', { pageId: op.page.id });
		return updatePage(op, deps, result, attempt + 1);
	}
	deps.state.pages[String(op.page.id)] = next;
	result.pushed++;
	return true;
}

/**
 * Update of a collision page (its file is the user's own). Linked only if the file has no nc_page_id and its text equals
 * the remote text. Otherwise the remote text becomes a conflict copy and the state stays 'collision'.
 */
async function updateCollision(op: ContentOp, s: PageState, remote: Fetched, deps: ExecutorDeps, result: SyncResult, now: number): Promise<boolean> {
	const localText = await deps.vault.read(op.path);
	const linkable = readPageId(localText) === null && (await sha256Hex(toRemote(localText, linkContext(deps, op.page.id)))) === remote.hash;
	if (!linkable) return recordUpdateConflict(op, s, remote, deps, result, now);
	const mtime = await writeIfUnchanged(deps.vault, op.path, localText, replaceNcMeta(localText, metaFor(op.page, op.meta, op.path)));
	if (mtime === null) return recordUpdateConflict(op, s, remote, deps, result, now);
	deps.state.pages[String(op.page.id)] = markSynced(s, {
		page: op.page,
		remote,
		baseHash: remote.hash,
		metaHash: op.metaHash,
		localMtime: mtime,
		now,
	});
	deps.log.info('Conflict resolved: local file equals remote', { pageId: op.page.id, path: op.path });
	result.unchanged++;
	return true;
}

/**
 * Both sides changed: keep the local file, save the remote text as conflict copy, move the remote fields on.
 * A collision stays a collision; a linked page becomes a conflict.
 */
async function recordUpdateConflict(op: ContentOp, s: PageState, remote: Fetched, deps: ExecutorDeps, result: SyncResult, now: number): Promise<boolean> {
	const copyPath = await writeConflictCopy(deps, op.page.id, op.path, remote.content);
	deps.state.pages[String(op.page.id)] = markConflict(s, {
		page: op.page,
		remote,
		status: isCollision(s) ? 'collision' : 'conflict',
		// The base is the remote text of this copy (see state.ts): the next run compares against it.
		baseHash: remote.hash,
		conflictPath: copyPath,
		localMtime: deps.vault.mtime(op.path) ?? s.localMtime,
		now,
	});
	deps.log.info('Conflict copy created', { pageId: op.page.id, path: copyPath });
	result.conflicts++;
	return true;
}

/** Push of a known page whose remote is unchanged since the state (no GET, see planner). */
async function pushPage(op: Extract<SyncOp, { kind: 'push' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const s = requireState(deps, op.page.id);
	const now = deps.now().getTime();
	const local = await readLocal(deps.vault, op.path, linkContext(deps, op.page.id));
	// The remote is known to be unchanged, so the remote hash is the base: only the local side can have changed.
	const action = decideContent({ baseHash: s.baseHash, localHash: local.hash, remoteHash: s.baseHash, status: s.status, strategy: deps.strategy });
	if (action === 'none') {
		// Content equal to the base (or a conflict page, which is not pushed): only the mtime moved, nothing is uploaded.
		const next = await applyMetaChange(op, { ...s, localMtime: local.mtimeBefore }, local.text, deps, result);
		deps.state.pages[String(op.page.id)] = next;
		result.unchanged++;
		return true;
	}
	// The only other action for this input is 'push'.
	let next: PageState;
	try {
		next = await uploadLocal(op, s, local, s.remoteEtag, deps, now, result);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		// The first attempt was this upload; the update path gets the second one.
		deps.log.info('Upload rejected, remote changed: fetching again', { pageId: op.page.id });
		return updatePage(op, deps, result, MAX_ATTEMPTS);
	}
	deps.state.pages[String(op.page.id)] = next;
	result.pushed++;
	return true;
}

/** Uploads the local text under If-Match and records the push (base = text hash, remote mtime unconfirmed). */
export async function uploadLocal(
	op: ContentOp,
	s: PageState,
	local: LocalText,
	ifMatch: string,
	deps: ExecutorDeps,
	now: number,
	result?: SyncResult,
): Promise<PageState> {
	const put = await deps.webdav.put(remotePagePath(livePage(deps, op.page)), toRemote(local.text, linkContext(deps, op.page.id)), { ifMatch });
	const pushed = markSynced(s, {
		page: op.page,
		remote: unconfirmedRemote(put.etag),
		baseHash: local.hash,
		metaHash: s.metaHash,
		localMtime: local.mtimeBefore,
		now,
	});
	return applyMetaChange(op, pushed, local.text, deps, result);
}

/**
 * Brings the metadata in line after a content step, with the decision the content gets (decideMeta): the server's values
 * go into the nc fields, or the note's emoji and tags go to the server, or - changed on both sides - the strategy decides
 * (conflictFile: the note keeps its values and the server's go into a conflict copy). Written only if the file still holds
 * `expectedText` (the text the step read); otherwise the metaHash stays and the next run retries (after a push it moves on:
 * the server has the values already).
 */
async function applyMetaChange(op: ContentOp, state: PageState, expectedText: string, deps: ExecutorDeps, result?: SyncResult): Promise<PageState> {
	const { action, local, invalidEmoji } = await decideMeta(op, state, expectedText, deps);
	if (invalidEmoji && result) result.metaInvalid++;
	switch (action) {
		case 'none':
			return state;
		case 'push':
			return local === null ? state : writeMeta(op, await pushLocalMeta(op, local, deps, result), state, expectedText, deps, true);
		case 'conflict':
			return state.status === 'synced' ? recordMetaConflict(op, state, toRemote(expectedText, linkContext(deps, op.page.id)), deps, result) : state;
		default:
			return writeMeta(op, { meta: op.meta, hash: op.metaHash }, state, expectedText, deps, false);
	}
}

/**
 * Emoji or tags changed on both sides and the strategy is conflictFile: the note keeps its values, the server's go into a
 * conflict copy (remote text with nc_emoji/tags), the page waits as 'conflict'. The metaHash moves on to the server's
 * values, so "keep local" pushes the note's values and "take remote" (which sets the metaHash to the note's) takes the server's.
 * `remoteText` is the text both sides hold (the content step is done).
 */
async function recordMetaConflict(op: ContentOp, state: PageState, remoteText: string, deps: ExecutorDeps, result?: SyncResult): Promise<PageState> {
	const copyPath = conflictPath(op.path, deps.conflictLabel, deps.now(), deps.occupied);
	await deps.vault.create(copyPath, withMetaOnly(linksToLocal(remoteText, linkContext(deps, op.page.id)), op.meta));
	deps.occupied.add(pathKey(copyPath));
	deps.log.info('Conflict copy created', { pageId: op.page.id, path: copyPath });
	if (result) result.conflicts++;
	return { ...state, status: 'conflict', conflictPath: copyPath, metaHash: op.metaHash };
}

async function writeMeta(op: ContentOp, meta: PushedMeta, state: PageState, expectedText: string, deps: ExecutorDeps, pushed: boolean): Promise<PageState> {
	const mtime = await writeIfUnchanged(deps.vault, op.path, expectedText, replaceNcMeta(expectedText, metaFor(op.page, meta.meta, op.path)));
	if (mtime === null) {
		deps.log.info('Metadata write skipped: file changed during sync', { pageId: op.page.id });
		return pushed ? { ...state, metaHash: meta.hash } : state;
	}
	return { ...state, metaHash: meta.hash, localMtime: mtime };
}

async function updateMeta(op: Extract<SyncOp, { kind: 'updateMeta' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const s = requireState(deps, op.page.id);
	if (isCollision(s)) {
		// The file is the user's own; only the expected metadata moves on.
		deps.state.pages[String(op.page.id)] = { ...s, metaHash: op.metaHash };
		result.unchanged++;
		return true;
	}
	const meta = metaFor(op.page, op.meta, op.path);
	const mtimeBefore = requireMtime(deps.vault, op.path);
	const text = await deps.vault.read(op.path);
	const next = replaceNcMeta(text, meta);
	if (next === text) {
		deps.state.pages[String(op.page.id)] = { ...s, metaHash: op.metaHash, localMtime: mtimeBefore };
		result.unchanged++;
		return true;
	}
	const mtime = await writeIfUnchanged(deps.vault, op.path, text, next);
	if (mtime === null) {
		// The user changed the file since the read: metaHash and localMtime stay, so the next run writes the metadata again.
		deps.log.info('Metadata write skipped: file changed during sync', { pageId: op.page.id });
		result.unchanged++;
		return false;
	}
	deps.state.pages[String(op.page.id)] = { ...s, metaHash: op.metaHash, localMtime: mtime };
	result.metaUpdated++;
	return true;
}
