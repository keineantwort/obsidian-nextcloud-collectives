// Structure operations of the sync executor (PLAN §7.4): create, move, rename, trash and restore pages and collectives.
// Imports nothing from 'obsidian': all vault access goes through VaultWriter.
import type { CollectiveId, PageId, PageInfo } from '../api/types';
import { readLocalFields, readNcMeta, replaceNcMeta, stripNcMeta, toLocal, toRemote } from '../mapping/frontmatter';
import type { NcMeta } from '../mapping/frontmatter';
import { ncTitleFor, pathKey, sanitizeName } from '../mapping/paths';
import { NotFoundError, isRunFatal } from '../util/errors';
import { metaHash, sha256Hex } from '../util/hash';
import { applyContentOp, fetchPage, readLocal, requireMtime, requireState, uploadLocal, writeIfUnchanged } from './executorContent';
import type { ContentOp } from './executorContent';
import type { ExecutorDeps, StructureApi } from './executorDeps';
import { localMetaFromFields, pushLocalMeta, reassignTags } from './executorMeta';
import { noteCreated, scratchOf } from './executorScratch';
import { metaFor, newPageState, remoteFields, unconfirmedRemote } from './pageState';
import type { ParentRef, SyncOp } from './plannerTypes';
import { UNCHECKED_LOCAL_MTIME, UNCONFIRMED_REMOTE_MTIME } from './state';
import type { PageState } from './state';
import type { SyncResult } from './types';

export type StructureOpKind =
	| 'renameLocal' | 'createRemote' | 'moveRemote' | 'trashRemote' | 'removeLocal' | 'dropState' | 'restoreRemote'
	| 'createCollective' | 'renameCollective' | 'renameCollectiveFolder' | 'renameFolderLocal' | 'trashCollective' | 'removeCollectiveLocal';

type Op<K extends StructureOpKind> = Extract<SyncOp, { kind: K }>;

/** Runs one structure operation and updates the counters. Returns true if the sync state changed. */
export function applyStructureOp(op: Extract<SyncOp, { kind: StructureOpKind }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	switch (op.kind) {
		case 'renameLocal': return renameLocal(op, deps, result);
		case 'createRemote': return createRemote(op, deps, result);
		case 'moveRemote': return moveRemote(op, deps, result);
		case 'trashRemote': return trashRemote(op, deps, result);
		case 'removeLocal': return removeLocal(op, deps, result);
		case 'dropState': return dropState(op, deps);
		case 'restoreRemote': return restoreRemote(op, deps, result);
		case 'createCollective': return createCollective(op, deps, result);
		case 'renameCollective': return renameCollective(op, deps, result);
		case 'renameCollectiveFolder': return renameCollectiveFolder(op, deps, result);
		case 'renameFolderLocal': return renameFolderLocal(op, deps, result);
		case 'trashCollective': return trashCollective(op, deps, result);
		case 'removeCollectiveLocal': return removeCollectiveLocal(op, deps, result);
	}
}

function requireApi(deps: ExecutorDeps): StructureApi {
	if (deps.api === undefined) throw new Error('Structure operations need the Collectives API');
	return deps.api;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** NcMeta of a page as the runner builds it for a listed page: remote title, emoji and the tag names of the cache. */
async function metaForPage(deps: ExecutorDeps, page: PageInfo, collectiveId: CollectiveId): Promise<{ meta: NcMeta; hash: string }> {
	const cache = deps.state.tags[String(collectiveId)] ?? [];
	const tags = page.tags.flatMap((id) => cache.filter((tag) => tag.id === id).map((tag) => tag.name));
	const meta: NcMeta = {
		pageId: page.id,
		collectiveId,
		title: page.title,
		emoji: page.emoji,
		tags,
	};
	return { meta, hash: await metaHash(meta.emoji, meta.tags) };
}

function resolveParent(deps: ExecutorDeps, parent: ParentRef): PageId {
	if (parent.kind === 'page') return parent.pageId;
	const created = scratchOf(deps).created.get(pathKey(parent.path));
	if (created === undefined) throw new NotFoundError('The parent page was not created');
	return created;
}

/** Looks the page up in the collectives it may be in; the first that has it wins. */
async function findPage(api: StructureApi, pageId: PageId, collectiveIds: CollectiveId[]): Promise<{ page: PageInfo; collectiveId: CollectiveId } | null> {
	for (const collectiveId of new Set(collectiveIds)) {
		try {
			return { page: await api.getPage(collectiveId, pageId), collectiveId };
		} catch (err) {
			if (!(err instanceof NotFoundError)) throw err;
		}
	}
	return null;
}

/** Remembers the page as the server has it now (its location may have changed with a sibling or child). Errors are not fatal. */
async function refreshPage(deps: ExecutorDeps, collectiveId: CollectiveId, pageId: PageId): Promise<void> {
	try {
		scratchOf(deps).refreshed.set(pageId, await requireApi(deps).getPage(collectiveId, pageId));
	} catch (err) {
		deps.log.info('Page could not be refreshed', { pageId, error: err instanceof Error ? err.name : 'unknown' });
	}
}

/**
 * Links the local file at `path` to the page just created for it: the file gets its nc fields, the state records the page,
 * and the file's text is uploaded. The state is saved before the upload, so a failing upload cannot create the page twice.
 */
async function linkNewPage(deps: ExecutorDeps, page: PageInfo, collectiveId: CollectiveId, path: string, result?: SyncResult): Promise<void> {
	let { meta, hash } = await metaForPage(deps, page, collectiveId);
	const now = deps.now().getTime();
	// A new note may carry tags (or an emoji) already: they become the page's, instead of being dropped by the nc fields.
	const fields = readLocalFields(await deps.vault.read(path));
	if (fields !== null && (fields.emoji !== null || (fields.tags?.length ?? 0) > 0)) {
		const pushed = await pushLocalMeta({ page, meta, metaHash: hash }, localMetaFromFields(fields, collectiveId, deps), deps, result);
		({ meta, hash } = pushed);
	}
	await deps.vault.process(path, (current) => replaceNcMeta(current, metaFor(page, meta, path)));
	// The page exists on the server and the file carries its id: remember that before anything else can fail. A new page is
	// empty, so that is its base until the first read; if it is not, the next run reports a conflict instead of a duplicate.
	deps.state.pages[String(page.id)] = newPageState(page, collectiveId, unconfirmedRemote(''), {
		localPath: path,
		localMtime: UNCHECKED_LOCAL_MTIME,
		baseHash: await sha256Hex(''),
		metaHash: hash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: now,
	});
	await deps.persist(deps.state);
	const remote = await fetchPage(deps, page);
	deps.state.pages[String(page.id)] = newPageState(page, collectiveId, remote, {
		localPath: path,
		// Unchecked: if the upload fails, the next run hashes the file and pushes it.
		localMtime: UNCHECKED_LOCAL_MTIME,
		baseHash: remote.hash,
		metaHash: hash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: now,
	});
	await deps.persist(deps.state);
	const local = await readLocal(deps.vault, path);
	if (local.hash === remote.hash) {
		deps.state.pages[String(page.id)] = { ...requireState(deps, page.id), localMtime: local.mtimeBefore };
		return;
	}
	// A page created a moment ago cannot have been edited by anyone else: its ETag is used as it is.
	const upload: ContentOp = { kind: 'push', page, path, meta, metaHash: hash, metaChanged: false };
	deps.state.pages[String(page.id)] = await uploadLocal(upload, requireState(deps, page.id), local, remote.etag, deps, now);
}

/** Replaces the prefix `from/` of the paths of a collective's pages (and their conflict copies) by `to/`. */
function rebasePaths(deps: ExecutorDeps, collectiveId: CollectiveId, from: string, to: string): void {
	const fromKey = pathKey(from) + '/';
	const rebase = (path: string): string => (pathKey(path).startsWith(fromKey) ? `${to}/${path.slice(from.length + 1)}` : path);
	for (const page of Object.values(deps.state.pages)) {
		if (page.collectiveId !== collectiveId) continue;
		deps.state.pages[String(page.pageId)] = {
			...page,
			localPath: rebase(page.localPath),
			conflictPath: page.conflictPath === null ? null : rebase(page.conflictPath),
		};
	}
}

function forgetPages(deps: ExecutorDeps, pageIds: readonly PageId[]): void {
	for (const pageId of pageIds) delete deps.state.pages[String(pageId)];
}

function forgetCollective(deps: ExecutorDeps, collectiveId: CollectiveId): void {
	delete deps.state.collectives[String(collectiveId)];
	delete deps.state.tags[String(collectiveId)];
	for (const page of Object.values(deps.state.pages)) {
		if (page.collectiveId === collectiveId) delete deps.state.pages[String(page.pageId)];
	}
}

// ---------------------------------------------------------------------------
// Remote moved or renamed a page: the local file follows
// ---------------------------------------------------------------------------

async function renameLocal(op: Op<'renameLocal'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const s = requireState(deps, op.page.id);
	const mtimeBefore = requireMtime(deps.vault, op.from);
	const unchangedSinceSync = mtimeBefore === s.localMtime;
	const renames = pathKey(op.from) !== pathKey(op.path);
	if (renames) {
		if (deps.vault.exists(op.path)) throw new Error(`Target of the rename exists: ${op.path}`);
		await deps.vault.rename(op.from, op.path);
		deps.occupied.add(pathKey(op.path));
	}
	// The nc fields follow the page: another collective, another title.
	const text = await deps.vault.read(op.path);
	const next = replaceNcMeta(text, metaFor(op.page, op.meta, op.path));
	let mtime = requireMtime(deps.vault, op.path);
	if (next !== text) {
		const written = await writeIfUnchanged(deps.vault, op.path, text, next);
		if (written !== null) mtime = written;
	}
	deps.state.pages[String(op.page.id)] = {
		...s,
		...remoteFields(op.page, { etag: s.remoteEtag, remoteMtime: s.remoteMtime }),
		collectiveId: op.meta.collectiveId,
		localPath: op.path,
		localMtime: unchangedSinceSync ? mtime : s.localMtime,
	};
	// A page that only moved on the server, with its file already in the right place, is not a move of the vault.
	if (renames) result.moved++;
	return true;
}

// ---------------------------------------------------------------------------
// Local file without nc_page_id: a new page
// ---------------------------------------------------------------------------

async function createRemote(op: Op<'createRemote'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const api = requireApi(deps);
	const parentId = resolveParent(deps, op.parent);
	const page = await api.createPage(op.collectiveId, parentId, op.title);
	const scratch = scratchOf(deps);
	scratch.refreshed.set(page.id, page);
	noteCreated(deps, op.path, page.id);
	// A leaf parent became a folder page on the server; the next pass moves its file into the folder.
	if (!scratch.parentsChecked.has(parentId)) {
		scratch.parentsChecked.add(parentId);
		await refreshPage(deps, op.collectiveId, parentId);
	}
	if (op.fileExists) {
		await linkNewPage(deps, page, op.collectiveId, op.path, result);
	} else {
		await createNote(deps, page, op.collectiveId, op.path);
	}
	result.uploaded++;
	return true;
}

/** The note of a folder page the plugin created for a local folder: the file does not exist yet. */
async function createNote(deps: ExecutorDeps, page: PageInfo, collectiveId: CollectiveId, path: string): Promise<void> {
	const { meta, hash } = await metaForPage(deps, page, collectiveId);
	const remote = await fetchPage(deps, page);
	const mtime = await deps.vault.create(path, toLocal(remote.content, metaFor(page, meta, path)));
	deps.occupied.add(pathKey(path));
	deps.state.pages[String(page.id)] = newPageState(page, collectiveId, remote, {
		localPath: path,
		localMtime: mtime,
		baseHash: remote.hash,
		metaHash: hash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: deps.now().getTime(),
	});
}

// ---------------------------------------------------------------------------
// Local file renamed or moved: the page follows
// ---------------------------------------------------------------------------

async function moveRemote(op: Op<'moveRemote'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const api = requireApi(deps);
	const s = requireState(deps, op.pageId);
	const found = await findPage(api, op.pageId, [s.collectiveId, op.collectiveId]);
	if (found === null) throw new NotFoundError('Page not found');
	let { page } = found;
	const parentId = op.parent === null ? null : resolveParent(deps, op.parent);
	const title = op.title !== null && op.title !== page.title ? op.title : null;
	let remoteChanged = false;
	if (found.collectiveId !== op.collectiveId) {
		await api.movePageToCollective(found.collectiveId, op.pageId, op.collectiveId, parentId === null ? undefined : { parentId });
		page = await api.getPage(op.collectiveId, op.pageId);
		if (title !== null) page = await api.updatePage(op.collectiveId, op.pageId, { title });
		remoteChanged = true;
		await refreshSubtree(deps, op.collectiveId, op.pageId, result);
	} else if (title !== null || (parentId !== null && parentId !== page.parentId)) {
		const change: { title?: string; parentId?: PageId } = {};
		if (title !== null) change.title = title;
		if (parentId !== null && parentId !== page.parentId) change.parentId = parentId;
		page = await api.updatePage(op.collectiveId, op.pageId, change);
		remoteChanged = true;
	}
	scratchOf(deps).refreshed.set(page.id, page);

	let path = op.path;
	if (op.tidyTo !== null && !deps.vault.exists(op.tidyTo)) {
		await deps.vault.rename(path, op.tidyTo);
		deps.occupied.add(pathKey(op.tidyTo));
		path = op.tidyTo;
	}
	const mtimeBefore = requireMtime(deps.vault, path);
	const unchangedSinceSync = mtimeBefore === s.localMtime;
	const text = await deps.vault.read(path);
	const existing = readNcMeta(text);
	let mtime = mtimeBefore;
	// Tags belong to a collective: after a move into another one they have to be assigned again from the note.
	const reassigned = existing !== null && found.collectiveId !== op.collectiveId ? await reassignTags(page, op.collectiveId, text, deps, result) : null;
	if (existing !== null) {
		const tags = reassigned?.meta.tags ?? existing.tags;
		const next = replaceNcMeta(text, { ...existing, tags, collectiveId: op.collectiveId, title: ncTitleFor(page.title, path, false) });
		if (next !== text) mtime = (await writeIfUnchanged(deps.vault, path, text, next)) ?? mtime;
	}
	const remote = remoteChanged ? { etag: s.remoteEtag, remoteMtime: UNCONFIRMED_REMOTE_MTIME } : { etag: s.remoteEtag, remoteMtime: s.remoteMtime };
	deps.state.pages[String(op.pageId)] = {
		...s,
		...remoteFields(page, remote),
		remoteSize: remoteChanged ? page.size : s.remoteSize,
		collectiveId: op.collectiveId,
		localPath: path,
		localMtime: unchangedSinceSync ? mtime : s.localMtime,
		...(reassigned === null ? {} : { metaHash: reassigned.hash }),
	};
	result.moved++;
	return true;
}

/** After a page moved into another collective with its sub-pages: the state of the sub-pages follows. */
async function refreshSubtree(deps: ExecutorDeps, collectiveId: CollectiveId, rootId: PageId, result: SyncResult): Promise<void> {
	const pages = await requireApi(deps).listPages(collectiveId);
	const below = new Set<PageId>([rootId]);
	for (let grew = true; grew;) {
		grew = false;
		for (const page of pages) {
			if (!below.has(page.id) && below.has(page.parentId)) {
				below.add(page.id);
				grew = true;
			}
		}
	}
	for (const page of pages) {
		const known = deps.state.pages[String(page.id)];
		if (page.id === rootId || !below.has(page.id) || known === undefined) continue;
		scratchOf(deps).refreshed.set(page.id, page);
		deps.state.pages[String(page.id)] = {
			...known,
			...remoteFields(page, unconfirmedRemote(known.remoteEtag)),
			collectiveId,
			...(await reassignedHash(deps, page, collectiveId, known.localPath, result)),
		};
	}
}

/** metaHash of a sub-page after its tags were assigned again from its note in the new collective; {} if that was not possible. */
async function reassignedHash(deps: ExecutorDeps, page: PageInfo, collectiveId: CollectiveId, localPath: string, result: SyncResult): Promise<{ metaHash?: string }> {
	try {
		if (!deps.vault.exists(localPath)) return {};
		const pushed = await reassignTags(page, collectiveId, await deps.vault.read(localPath), deps, result);
		return pushed === null ? {} : { metaHash: pushed.hash };
	} catch (err) {
		if (isRunFatal(err)) throw err;
		// The tags stay lost on the server; the next run takes the server's metadata over.
		deps.log.warn('Tags of a moved sub-page could not be assigned again', { pageId: page.id, error: err instanceof Error ? err.name : 'unknown' });
		return {};
	}
}

// ---------------------------------------------------------------------------
// Deletions and restores
// ---------------------------------------------------------------------------

async function trashRemote(op: Op<'trashRemote'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	try {
		await requireApi(deps).trashPage(op.collectiveId, op.pageId);
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err; // already gone
	}
	// Sub-pages that still have a file stay in the state: the next pass finds them gone on the server and follows.
	forgetPages(deps, [op.pageId, ...op.descendants.filter((d) => !d.hasFile).map((d) => d.pageId)]);
	result.trashed++;
	return true;
}

/**
 * The server deleted the page. An unchanged file follows (Obsidian trash, or unlinked); a changed file wins: the page is
 * restored from the Collectives trash and the change is pushed (PLAN §7.4). If it cannot be restored, the file loses its
 * nc fields and becomes a new page in the next pass.
 */
async function removeLocal(op: Op<'removeLocal'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const s = deps.state.pages[String(op.pageId)];
	if (s === undefined) return false;
	if (!deps.vault.exists(op.path)) {
		forgetPages(deps, [op.pageId]);
		return true;
	}
	const hash = await sha256Hex(toRemote(await deps.vault.read(op.path)));
	if (s.status === 'synced' && hash === s.baseHash) {
		if (op.mode === 'obsidianTrash') await deps.vault.trash(op.path);
		else await deps.vault.process(op.path, stripNcMeta);
		forgetPages(deps, [op.pageId]);
		result.removed++;
		return true;
	}
	return reviveChangedPage(op, s, deps, result);
}

async function reviveChangedPage(op: Op<'removeLocal'>, s: PageState, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const api = requireApi(deps);
	let page: PageInfo | null = null;
	try {
		page = await api.restorePage(op.collectiveId, op.pageId);
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		// Restored together with its parent a moment ago?
		page = (await findPage(api, op.pageId, [op.collectiveId]))?.page ?? null;
	}
	if (page === null) {
		await deps.vault.process(op.path, stripNcMeta);
		forgetPages(deps, [op.pageId]);
		deps.log.info('Deleted page could not be restored: the file becomes a new page', { pageId: op.pageId });
		result.removed++;
		return true;
	}
	scratchOf(deps).refreshed.set(page.id, page);
	const { meta, hash } = await metaForPage(deps, page, op.collectiveId);
	deps.state.pages[String(op.pageId)] = { ...s, ...remoteFields(page, unconfirmedRemote(s.remoteEtag)) };
	result.restored++;
	await applyContentOp({ kind: 'update', page, path: op.path, meta, metaHash: hash, metaChanged: true }, deps, result);
	return true;
}

/** Forgets pages and collectives. Files in `unlinkPaths` lose their nc fields, so that they are ordinary notes afterwards. */
async function dropState(op: Op<'dropState'>, deps: ExecutorDeps): Promise<boolean> {
	for (const path of op.unlinkPaths ?? []) {
		if (deps.vault.exists(path)) await deps.vault.process(path, stripNcMeta);
	}
	forgetPages(deps, op.pageIds);
	for (const collectiveId of op.collectiveIds) forgetCollective(deps, collectiveId);
	return true;
}

/** A file with an nc_page_id reappeared in the vault and its page is in the Collectives trash: restore the page (PLAN §7.4). */
async function restoreRemote(op: Op<'restoreRemote'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	let page: PageInfo;
	try {
		page = await requireApi(deps).restorePage(op.collectiveId, op.pageId);
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		deps.log.info('Page to restore is not in the trash', { pageId: op.pageId });
		return false;
	}
	scratchOf(deps).refreshed.set(page.id, page);
	const { meta, hash } = await metaForPage(deps, page, op.collectiveId);
	result.restored++;
	return applyContentOp({ kind: 'adopt', page, path: op.path, meta, metaHash: hash }, deps, result);
}

// ---------------------------------------------------------------------------
// Collectives
// ---------------------------------------------------------------------------

async function createCollective(op: Op<'createCollective'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const api = requireApi(deps);
	const collective = await api.createCollective(op.folder);
	deps.state.collectives[String(collective.id)] = { collectiveId: collective.id, name: collective.name, localFolder: op.folder };
	deps.state.tags[String(collective.id)] = [];
	await deps.persist(deps.state);
	if (op.landingFile !== null) {
		const pages = await api.listPages(collective.id);
		const landing = pages.filter((page) => page.parentId === 0).sort((a, b) => a.id - b.id)[0];
		if (landing !== undefined) {
			scratchOf(deps).refreshed.set(landing.id, landing);
			await linkNewPage(deps, landing, collective.id, op.landingFile);
		}
	}
	result.uploaded++;
	return true;
}

/** The user renamed the folder of a collective and may rename the collective: the server follows through the Circles API. */
async function renameCollective(op: Op<'renameCollective'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	await requireApi(deps).renameCollective(op.circleId, op.name);
	const known = deps.state.collectives[String(op.collectiveId)];
	if (known === undefined) return false;
	rebasePaths(deps, op.collectiveId, known.localFolder, op.folder);
	deps.state.collectives[String(op.collectiveId)] = { ...known, name: op.name, localFolder: op.folder };
	await tidyLandingNote(deps, op.collectiveId, op.folder);
	result.moved++;
	return true;
}

/** The local folder takes another name: the server's new name, or the old one again where the user may not rename. */
async function renameCollectiveFolder(op: Op<'renameCollectiveFolder'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const known = deps.state.collectives[String(op.collectiveId)];
	if (known === undefined) return false;
	if (pathKey(op.from) !== pathKey(op.to)) {
		if (deps.vault.exists(op.to) && pathKey(op.from) !== pathKey(op.to)) throw new Error(`Target of the folder rename exists: ${op.to}`);
		await deps.vault.rename(op.from, op.to);
		deps.occupied.add(pathKey(op.to));
	}
	rebasePaths(deps, op.collectiveId, known.localFolder, op.to);
	deps.state.collectives[String(op.collectiveId)] = { ...known, name: op.name, localFolder: op.to };
	await tidyLandingNote(deps, op.collectiveId, op.to);
	result.moved++;
	return true;
}

/** The folder of a folder page follows its note (the user renamed only the note). The state paths below it follow. */
async function renameFolderLocal(op: Op<'renameFolderLocal'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	if (deps.vault.exists(op.to)) throw new Error(`Target of the folder rename exists: ${op.to}`);
	await deps.vault.rename(op.from, op.to);
	deps.occupied.add(pathKey(op.to));
	rebasePaths(deps, op.collectiveId, op.from, op.to);
	result.moved++;
	return true;
}

/** The landing note carries the name of the collective's folder (ADR 0004); after a folder rename the note follows. */
async function tidyLandingNote(deps: ExecutorDeps, collectiveId: CollectiveId, folder: string): Promise<void> {
	const landing = Object.values(deps.state.pages).find((page) => page.collectiveId === collectiveId && page.parentId === 0);
	if (landing === undefined || landing.status === 'collision') return;
	const target = `${folder}/${sanitizeName(folder)}.md`;
	if (pathKey(landing.localPath) === pathKey(target) || deps.vault.exists(target) || !deps.vault.exists(landing.localPath)) return;
	await deps.vault.rename(landing.localPath, target);
	deps.occupied.add(pathKey(target));
	deps.state.pages[String(landing.pageId)] = { ...landing, localPath: target };
}

async function trashCollective(op: Op<'trashCollective'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	try {
		await requireApi(deps).trashCollective(op.collectiveId);
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err; // already gone
	}
	forgetCollective(deps, op.collectiveId);
	result.trashed++;
	return true;
}

async function removeCollectiveLocal(op: Op<'removeCollectiveLocal'>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	if (deps.vault.exists(op.folder)) await deps.vault.trash(op.folder);
	forgetCollective(deps, op.collectiveId);
	result.removed++;
	return true;
}
