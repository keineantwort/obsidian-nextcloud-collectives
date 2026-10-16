// Planning of what the user did in the vault and of what the server removed (PLAN §7.4). Pure.
import { asPageId } from '../api/types';
import type { CollectiveId, PageId, PageInfo } from '../api/types';
import { pathKey, sanitizeName } from '../mapping/paths';
import type { LocalFile } from './localScanner';
import { locatePage } from './locate';
import type { Placer } from './placement';
import type { ParentRef } from './plannerTypes';
import type { Context } from './plannerContext';
import { dirnameOf, lastSegment, stemOf, withoutEntries } from './plannerContext';
import { MASS_DELETE_MIN, MASS_DELETE_SHARE } from './plannerTypes';
import { isCollision } from './state';
import type { PageState } from './state';
import { descendantsOf } from './treeIndex';
import type { Proposal } from './types';

/** Remote file name of a folder page. */
const FOLDER_NOTE = 'Readme.md';

/** True if the file moved or was renamed since the plugin placed it. A collision file is the user's own and never moves. */
export function movedLocally(file: LocalFile, known: PageState): boolean {
	return !isCollision(known) && pathKey(file.path) !== pathKey(known.localPath);
}

// ---------------------------------------------------------------------------
// Local deletions (page file gone, page still on the server)
// ---------------------------------------------------------------------------

/**
 * Pages whose local file is gone. Unchanged on the server: the user is asked (or the page is trashed without a question,
 * per setting); changed on the server: the change wins and the page is pulled again. Mutates ctx.state: pages the user
 * kept or that changed remotely are forgotten, so the plan pulls them as new pages.
 */
export function planLocalDeletions(ctx: Context): void {
	const missing = new Map<PageId, PageState>();
	const forget = new Set<PageId>();
	for (const known of Object.values(ctx.state.pages)) {
		if (ctx.blocked.has(known.collectiveId) || !ctx.scanned.has(known.collectiveId)) continue;
		if (!ctx.tree.pages.has(known.pageId) || ctx.files.duplicates.has(known.pageId)) continue;
		if (locatePage(known, ctx.files) !== undefined) continue;
		// The file of a collision page is the user's own, the page was never linked to it: it is pulled again, never deleted.
		if (isCollision(known)) forget.add(known.pageId);
		else missing.set(known.pageId, known);
	}
	const candidates = new Map<PageId, PageState>();
	for (const [pageId, known] of missing) {
		const remote = ctx.tree.pages.get(pageId);
		// The landing page cannot be deleted; and a page the server changed since is not deleted behind its back.
		if (remote === undefined || remote.page.parentId === 0 || ctx.input.remoteChanged?.has(pageId) === true) forget.add(pageId);
		else candidates.set(pageId, known);
	}

	const roots = [...candidates.values()].filter((known) => {
		const parent = ctx.tree.pages.get(known.pageId)?.page.parentId ?? asPageId(0);
		return !candidates.has(parent);
	});
	const deleted = new Map<CollectiveId, number>();
	for (const root of roots) {
		deleted.set(root.collectiveId, (deleted.get(root.collectiveId) ?? 0) + 1 + descendantsOf(ctx.tree, root.pageId).length);
	}
	for (const root of roots) planDeletion(ctx, root, deleted, forget);

	if (forget.size > 0) ctx.state = withoutEntries(ctx.state, new Set(), forget);
}

function planDeletion(ctx: Context, root: PageState, deleted: Map<CollectiveId, number>, forget: Set<PageId>): void {
	const page = ctx.tree.pages.get(root.pageId)?.page;
	if (page === undefined) return;
	const descendants = descendantsOf(ctx.tree, root.pageId);
	const total = ctx.tree.counts.get(root.collectiveId) ?? 0;
	const count = deleted.get(root.collectiveId) ?? 0;
	const collectiveName = ctx.remoteCollectives.get(root.collectiveId)?.collective.name ?? '';
	const mass = total > 0 && count >= MASS_DELETE_MIN && count / total > MASS_DELETE_SHARE ? { collectiveName, deleted: count, total } : null;
	const ask = ctx.behaviour.localDelete === 'ask' || mass !== null;
	const trash = (): void => {
		ctx.finalOps.push({
			kind: 'trashRemote',
			pageId: root.pageId,
			collectiveId: root.collectiveId,
			descendants: descendants.map((d) => ({ pageId: d.id, hasFile: hasLocalFile(ctx, d.id) })),
		});
	};
	if (!ask) {
		trash();
		return;
	}
	const proposalId = `deletePage:${root.pageId}`;
	const decision = ctx.decisions.get(proposalId);
	if (decision === 'accept') {
		trash();
	} else if (decision === 'reject') {
		forget.add(root.pageId);
		for (const d of descendants) if (!hasLocalFile(ctx, d.id)) forget.add(d.id);
	} else if (decision === 'defer') {
		ctx.skips.push({ reason: 'deferred', proposalId });
	} else {
		const proposal: Proposal = {
			id: proposalId,
			kind: 'deletePage',
			pageId: root.pageId,
			collectiveId: root.collectiveId,
			title: page.title,
			path: root.localPath,
			descendants: descendants.length,
			mass,
		};
		ctx.proposals.push(proposal);
	}
}

function hasLocalFile(ctx: Context, pageId: PageId): boolean {
	return ctx.files.byId.has(pageId);
}

// ---------------------------------------------------------------------------
// Remote deletions (page gone on the server)
// ---------------------------------------------------------------------------

/** Pages the server no longer lists: the local file follows (executor decides between trash and revival). */
export function planRemoteDeletions(ctx: Context): void {
	// A page may have moved into a collective that could not be scanned: nothing counts as deleted then.
	if (ctx.failed.size > 0) return;
	const dropped: PageId[] = [];
	for (const known of Object.values(ctx.state.pages)) {
		if (ctx.tree.pages.has(known.pageId) || !ctx.scanned.has(known.collectiveId) || ctx.blocked.has(known.collectiveId)) continue;
		if (ctx.files.duplicates.has(known.pageId)) continue;
		const file = locatePage(known, ctx.files);
		if (file === undefined || isCollision(known)) {
			dropped.push(known.pageId);
			continue;
		}
		ctx.finalOps.push({ kind: 'removeLocal', pageId: known.pageId, collectiveId: known.collectiveId, path: file.path, mode: ctx.behaviour.remoteDelete });
		// A kept file becomes a new page in the next pass.
		if (ctx.behaviour.remoteDelete === 'keepUnlinked') ctx.followUp = true;
	}
	if (dropped.length > 0) ctx.finalOps.push({ kind: 'dropState', pageIds: dropped, collectiveIds: [] });
}

// ---------------------------------------------------------------------------
// Local moves and renames of linked pages
// ---------------------------------------------------------------------------

/**
 * The user renamed or moved the file of a page that did not move on the server. Plans the matching change on the server;
 * the state follows (executor). Landing pages and pages the plan cannot place are left alone.
 */
export function planLocalMove(page: PageInfo, known: PageState, file: LocalFile, ctx: Context, placer: Placer): string {
	if (page.parentId === 0) return file.path;
	const collectiveId = placer.collectiveOf(file.path);
	if (collectiveId === undefined) return file.path; // a folder that is no collective yet: the next pass places the file
	if (ctx.failed.has(collectiveId) || ctx.blocked.has(collectiveId)) {
		ctx.skips.push({ reason: 'collectiveUnavailable', collectiveId });
		return file.path;
	}
	const folderPage = known.remoteFileName === FOLDER_NOTE;
	const parent = placer.parentFor(file.path, { self: page.id, folderPage });
	if (parent === null) return file.path;
	const oldStem = stemOf(known.localPath);
	const newStem = stemOf(file.path);
	const dir = dirnameOf(file.path);
	let title: string | null = null;
	let tidyTo: string | null = null;
	if (newStem !== oldStem) {
		title = newStem;
	} else if (
		folderPage &&
		lastSegment(dir) !== lastSegment(dirnameOf(known.localPath)) &&
		dirnameOf(dir) === dirnameOf(dirnameOf(known.localPath)) &&
		// The old folder is gone: it was renamed. If it is still there, only the note moved out of it.
		!ctx.input.local.occupied.has(pathKey(dirnameOf(known.localPath)))
	) {
		// The folder of a folder page was renamed in the vault: the page takes the folder's name, the note follows the folder.
		title = lastSegment(dir);
		tidyTo = `${dir}/${sanitizeName(title)}.md`;
	}
	if (title !== null && (title === page.title || title === sanitizeName(page.title))) title = null;
	const parentChanged = !(parent.kind === 'page' && parent.pageId === page.parentId);
	const tidy = tidyTo !== null && pathKey(tidyTo) !== pathKey(file.path) && !ctx.input.local.occupied.has(pathKey(tidyTo)) ? tidyTo : null;
	if (tidy !== null) {
		ctx.claimed.add(pathKey(tidy));
		ctx.vacated.add(pathKey(file.path));
	}
	ctx.structureOps.push({
		kind: 'moveRemote',
		pageId: page.id,
		fromCollectiveId: known.collectiveId,
		collectiveId,
		path: file.path,
		title,
		parent: parentChanged || collectiveId !== known.collectiveId ? parent : null,
		tidyTo: tidy,
		order: 0,
	});
	if (parentChanged && turnsIntoFolder(ctx, placer, parent)) ctx.followUp = true;
	return tidy ?? file.path;
}

// ---------------------------------------------------------------------------
// New files and files with unknown ids
// ---------------------------------------------------------------------------

/**
 * Local files the plugin does not know: without nc_page_id they become new pages; with an nc_page_id the server does not
 * list, the page is restored if it is in the Collectives trash, else the file is left alone.
 */
export function planLocalFiles(ctx: Context, placer: Placer): void {
	const collisionPaths = new Set<string>(
		Object.values(ctx.state.pages).filter(isCollision).map((p) => pathKey(p.localPath)),
	);
	for (const file of ctx.input.local.files) {
		if (file.pageId !== null) {
			planUnknownId(file, file.pageId, ctx);
			continue;
		}
		const key = pathKey(file.path);
		if (ctx.claimedUserFiles.has(key) || collisionPaths.has(key)) continue;
		planNewFile(file, ctx, placer);
	}
}

function planUnknownId(file: LocalFile, pageId: PageId, ctx: Context): void {
	if (ctx.state.pages[String(pageId)] !== undefined || ctx.tree.pages.has(pageId) || ctx.files.duplicates.has(pageId)) return;
	const trashed = ctx.input.remoteTrash?.get(pageId);
	if (trashed !== undefined && ctx.scanned.has(trashed) && !ctx.blocked.has(trashed)) {
		ctx.structureOps.push({ kind: 'restoreRemote', pageId, collectiveId: trashed, path: file.path });
		return;
	}
	ctx.skips.push({ reason: 'unknownId', pageId, path: file.path });
}

function planNewFile(file: LocalFile, ctx: Context, placer: Placer): void {
	const collectiveId = placer.collectiveOf(file.path);
	if (collectiveId === undefined) return; // top-level folder without a collective: planCollectives decides
	if (ctx.failed.has(collectiveId)) {
		ctx.skips.push({ reason: 'collectiveUnavailable', collectiveId });
		return;
	}
	if (ctx.blocked.has(collectiveId) || !ctx.scanned.has(collectiveId)) return;
	const parent = placer.parentFor(file.path, { self: null, folderPage: false });
	if (parent === null) return;
	ctx.structureOps.push({ kind: 'createRemote', path: file.path, title: stemOf(file.path), collectiveId, parent, fileExists: true, order: 0 });
	if (turnsIntoFolder(ctx, placer, parent)) ctx.followUp = true;
}

/** True for a note that lies in a folder of its own name (`Name/Name.md`): it needs no move into a folder. */
function inOwnFolder(path: string): boolean {
	return pathKey(stemOf(path)) === pathKey(lastSegment(dirnameOf(path)));
}

/**
 * True if a new child makes the parent a folder page on the server (a leaf page, or a page the plan creates from a local
 * file): its note then has to move into the folder, which the next pass does.
 */
function turnsIntoFolder(ctx: Context, placer: Placer, parent: ParentRef): boolean {
	if (parent.kind === 'new') return !placer.isVirtual(parent.path) && !inOwnFolder(parent.path);
	const page = ctx.tree.pages.get(parent.pageId)?.page;
	return page !== undefined && page.parentId !== 0 && page.fileName !== FOLDER_NOTE;
}
