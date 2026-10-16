// Pull executor (PLAN §6.3, spec §7): applies the planner's operations to the vault and the sync state.
// Imports nothing from 'obsidian': all vault access goes through VaultWriter.
import type { WebdavClient } from '../api/webdavClient';
import type { CollectiveId, PageInfo } from '../api/types';
import { canonicalRemote, readPageId, replaceNcMeta, toLocal, toRemote } from '../mapping/frontmatter';
import type { NcMeta } from '../mapping/frontmatter';
import { conflictPath, ncTitleFor, pathKey, remotePagePath } from '../mapping/paths';
import { sha256Hex } from '../util/hash';
import { isRunFatal } from '../util/errors';
import type { Logger } from '../util/logger';
import type { SyncOp, SyncPlan } from './planner';
import { isCollision } from './state';
import type { PageState, PageStatus, SyncState } from './state';
import type { SyncResult } from './types';

export type { SyncResult } from './types';

/** Vault writes used by the executor; implemented over app.vault in obsidianVault.ts. */
export interface VaultWriter {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	/** Creates a new file (fails if it exists). Returns mtime after write. */
	create(path: string, content: string): Promise<number>;
	/** Atomic read-modify-write (app.vault.process). Returns mtime after write. */
	process(path: string, fn: (current: string) => string): Promise<number>;
	createFolder(path: string): Promise<void>;
	mtime(path: string): number | null;
}

export interface ExecutorDeps {
	vault: VaultWriter;
	webdav: Pick<WebdavClient, 'get'>;
	state: SyncState;
	/** Persist state after each op (StateStore.save). */
	persist: (state: SyncState) => Promise<void>;
	now: () => Date;
	/** Translated label for conflict file names ('Konflikt' / 'Conflict'). */
	conflictLabel: string;
	log: Logger;
	/** Set of pathKey of all vault paths; executor adds the paths it creates. */
	occupied: Set<string>;
}

/** Remote fields of PageState, taken from the listing and the GET response. */
function remoteFields(page: PageInfo, etag: string): Pick<PageState, 'remoteFilePath' | 'remoteFileName' | 'parentId' | 'remoteEtag' | 'remoteMtime' | 'remoteSize'> {
	return {
		remoteFilePath: page.filePath,
		remoteFileName: page.fileName,
		parentId: page.parentId,
		remoteEtag: etag,
		remoteMtime: page.timestamp,
		remoteSize: page.size,
	};
}

/** The local fields of a page state that an operation decides on. */
interface LocalFields {
	localPath: string;
	localMtime: number;
	baseHash: string;
	metaHash: string;
	status: PageStatus;
	conflictPath: string | null;
	lastSyncedAt: number;
}

/** State of a page that the state does not know yet. Remote fields come from the listing and the GET (etag). */
function newPageState(page: PageInfo, collectiveId: CollectiveId, etag: string, fields: LocalFields): PageState {
	return { pageId: page.id, collectiveId, ...remoteFields(page, etag), attachments: [], ...fields };
}

/** State of a linked page after its file was written or checked against the remote text `baseHash`. */
function markSynced(
	prev: PageState,
	update: { page: PageInfo; etag: string; baseHash: string; metaHash: string; localMtime: number; now: number },
): PageState {
	return {
		...prev,
		...remoteFields(update.page, update.etag),
		baseHash: update.baseHash,
		metaHash: update.metaHash,
		localMtime: update.localMtime,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: update.now,
	};
}

/** State of a page after a conflict copy was written next to its file. */
function markConflict(
	prev: PageState,
	update: { page: PageInfo; etag: string; status: PageStatus; baseHash: string; conflictPath: string; localMtime: number; now: number },
): PageState {
	return {
		...prev,
		...remoteFields(update.page, update.etag),
		status: update.status,
		baseHash: update.baseHash,
		conflictPath: update.conflictPath,
		localMtime: update.localMtime,
		lastSyncedAt: update.now,
	};
}

/** Frontmatter metadata for a write to `path`: nc_title is derived from the file name actually written. */
function metaFor(page: PageInfo, meta: NcMeta, path: string): NcMeta {
	return { ...meta, title: ncTitleFor(page.title, path, page.parentId === 0) };
}

/** Writes `next` only if the file still holds `expected`. Returns null (nothing written) if the user changed it since the read. */
async function writeIfUnchanged(vault: VaultWriter, path: string, expected: string, next: string): Promise<number | null> {
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
async function writeConflictCopy(deps: ExecutorDeps, path: string, remoteContent: string): Promise<string> {
	const copyPath = conflictPath(path, deps.conflictLabel, deps.now(), deps.occupied);
	await deps.vault.create(copyPath, canonicalRemote(remoteContent));
	deps.occupied.add(pathKey(copyPath));
	return copyPath;
}

function requireState(deps: ExecutorDeps, pageId: number): PageState {
	const entry = deps.state.pages[String(pageId)];
	if (entry === undefined) throw new Error(`no sync state for page ${pageId}`);
	return entry;
}

/**
 * Applies the plan. Operations run in order. A failing page operation is counted and logged (pageId and error class
 * only), then the run continues. Errors for which isRunFatal is true abort the run and are rethrown.
 */
export async function executeSync(plan: SyncPlan, deps: ExecutorDeps): Promise<SyncResult> {
	const result: SyncResult = { created: 0, updated: 0, metaUpdated: 0, conflicts: 0, unchanged: 0, failed: 0 };
	for (const op of plan.ops) {
		let changedState: boolean;
		try {
			changedState = await applyOp(op, deps, result);
		} catch (err) {
			if (isRunFatal(err)) throw err;
			result.failed++;
			deps.log.warn('Sync operation failed', {
				kind: op.kind,
				...('page' in op ? { pageId: op.page.id } : {}),
				error: err instanceof Error ? err.name : 'unknown',
			});
			continue;
		}
		if (changedState) await deps.persist(deps.state);
	}
	return result;
}

/** Runs one operation and updates the counters. Returns true if the sync state changed. */
async function applyOp(op: SyncOp, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	switch (op.kind) {
		case 'ensureFolder':
			if (!deps.vault.exists(op.path)) await deps.vault.createFolder(op.path);
			deps.occupied.add(pathKey(op.path));
			return false;
		case 'saveCollective':
			deps.state.collectives[String(op.collective.collectiveId)] = op.collective;
			return true;
		case 'saveTags':
			deps.state.tags[String(op.collectiveId)] = op.tags;
			return true;
		case 'create':
			return createPage(op, deps, result);
		case 'createConflict':
			return createConflict(op, deps, result);
		case 'adopt':
			return adoptPage(op, deps, result);
		case 'update':
			return updatePage(op, deps, result);
		case 'updateMeta':
			return updateMeta(op, deps, result);
	}
}

async function createPage(op: Extract<SyncOp, { kind: 'create' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const { content, etag } = await deps.webdav.get(remotePagePath(op.page));
	const mtime = await deps.vault.create(op.path, toLocal(content, metaFor(op.page, op.meta, op.path)));
	deps.occupied.add(pathKey(op.path));
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, etag, {
		localPath: op.path,
		localMtime: mtime,
		baseHash: await sha256Hex(canonicalRemote(content)),
		metaHash: op.metaHash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: deps.now().getTime(),
	});
	result.created++;
	return true;
}

async function createConflict(op: Extract<SyncOp, { kind: 'createConflict' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const { content, etag } = await deps.webdav.get(remotePagePath(op.page));
	const copyPath = await writeConflictCopy(deps, op.path, content);
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, etag, {
		localPath: op.path,
		localMtime: deps.vault.mtime(op.path) ?? 0,
		baseHash: '',
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
	const { content, etag } = await deps.webdav.get(remotePagePath(op.page));
	const localText = await deps.vault.read(op.path);
	const remoteCanonical = canonicalRemote(content);
	const now = deps.now().getTime();
	const meta = metaFor(op.page, op.meta, op.path);

	if (toRemote(localText) !== remoteCanonical) {
		// The base is unknown here: the page stays linked by nc_page_id, and the next run compares by content.
		const copyPath = await writeConflictCopy(deps, op.path, content);
		deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, etag, {
			localPath: op.path,
			localMtime: deps.vault.mtime(op.path) ?? 0,
			baseHash: '',
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
	deps.state.pages[String(op.page.id)] = newPageState(op.page, op.meta.collectiveId, etag, {
		localPath: op.path,
		localMtime: mtime,
		baseHash: await sha256Hex(remoteCanonical),
		metaHash: op.metaHash,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: now,
	});
	return true;
}

async function updatePage(op: Extract<SyncOp, { kind: 'update' }>, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const s = requireState(deps, op.page.id);
	const { content, etag } = await deps.webdav.get(remotePagePath(op.page));
	const remoteCanonical = canonicalRemote(content);
	const remoteHash = await sha256Hex(remoteCanonical);
	const now = deps.now().getTime();
	const meta = metaFor(op.page, op.meta, op.path);

	if (isCollision(s)) return updateCollision(op, s, { etag, content, remoteHash, meta }, deps, result, now);

	if (remoteHash === s.baseHash) {
		// Remote text unchanged: only the remote fields (and metadata, if it changed) are refreshed.
		let metaHash = s.metaHash;
		let localMtime = s.localMtime;
		if (op.metaChanged) {
			localMtime = await deps.vault.process(op.path, (cur) => replaceNcMeta(cur, meta));
			metaHash = op.metaHash;
		}
		deps.state.pages[String(op.page.id)] = { ...s, ...remoteFields(op.page, etag), metaHash, localMtime, lastSyncedAt: now };
		result.unchanged++;
		return true;
	}

	const localText = await deps.vault.read(op.path);
	const localHash = await sha256Hex(toRemote(localText));

	if (localHash === s.baseHash) {
		// Local file still equals the last synced text: take the new remote text.
		const mtime = await writeIfUnchanged(deps.vault, op.path, localText, toLocal(content, meta));
		if (mtime !== null) {
			deps.state.pages[String(op.page.id)] = markSynced(s, { page: op.page, etag, baseHash: remoteHash, metaHash: op.metaHash, localMtime: mtime, now });
			result.updated++;
			return true;
		}
		// The user edited the file between read and write: keep it and fall through to the conflict copy.
		return recordUpdateConflict(op, s, { etag, content }, deps, result, now);
	}

	if (localHash === remoteHash) {
		// Both sides hold the same text already: only the base moves on.
		let localMtime = s.localMtime;
		let metaHash = s.metaHash;
		if (op.metaChanged) {
			localMtime = await deps.vault.process(op.path, (cur) => replaceNcMeta(cur, meta));
			metaHash = op.metaHash;
		}
		deps.state.pages[String(op.page.id)] = markSynced(s, { page: op.page, etag, baseHash: remoteHash, metaHash, localMtime, now });
		result.unchanged++;
		return true;
	}

	return recordUpdateConflict(op, s, { etag, content }, deps, result, now);
}

/**
 * Remote changed for a collision: the user file is linked only if it has no nc_page_id and its text equals the remote
 * text. Otherwise the remote text becomes a conflict copy and the state stays 'collision'.
 */
async function updateCollision(
	op: Extract<SyncOp, { kind: 'update' }>,
	s: PageState,
	remote: { etag: string; content: string; remoteHash: string; meta: NcMeta },
	deps: ExecutorDeps,
	result: SyncResult,
	now: number,
): Promise<boolean> {
	const localText = await deps.vault.read(op.path);
	const linkable = readPageId(localText) === null && (await sha256Hex(toRemote(localText))) === remote.remoteHash;
	if (!linkable) return recordUpdateConflict(op, s, remote, deps, result, now);
	const mtime = await writeIfUnchanged(deps.vault, op.path, localText, replaceNcMeta(localText, remote.meta));
	if (mtime === null) return recordUpdateConflict(op, s, remote, deps, result, now);
	deps.state.pages[String(op.page.id)] = markSynced(s, {
		page: op.page,
		etag: remote.etag,
		baseHash: remote.remoteHash,
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
async function recordUpdateConflict(
	op: Extract<SyncOp, { kind: 'update' }>,
	s: PageState,
	remote: { etag: string; content: string },
	deps: ExecutorDeps,
	result: SyncResult,
	now: number,
): Promise<boolean> {
	const copyPath = await writeConflictCopy(deps, op.path, remote.content);
	deps.state.pages[String(op.page.id)] = markConflict(s, {
		page: op.page,
		etag: remote.etag,
		status: isCollision(s) ? 'collision' : 'conflict',
		baseHash: s.baseHash,
		conflictPath: copyPath,
		localMtime: deps.vault.mtime(op.path) ?? s.localMtime,
		now,
	});
	deps.log.info('Conflict copy created', { pageId: op.page.id, path: copyPath });
	result.conflicts++;
	return true;
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
	let changed = false;
	const mtime = await deps.vault.process(op.path, (cur) => {
		const next = replaceNcMeta(cur, meta);
		changed = next !== cur;
		return next;
	});
	deps.state.pages[String(op.page.id)] = { ...s, metaHash: op.metaHash, localMtime: mtime };
	if (changed) result.metaUpdated++;
	else result.unchanged++;
	return true;
}
