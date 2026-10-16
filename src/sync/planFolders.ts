// Collective-level planning (PLAN §7.4): new, renamed, deleted and vanished collectives. Pure.
import type { CollectiveId } from '../api/types';
import { pathKey, sanitizeName, withSuffix } from '../mapping/paths';
import type { LocalFile } from './localScanner';
import type { Context } from './plannerContext';
import { lastSegment } from './plannerContext';
import type { CollectiveState } from './state';

/** Circle level from which a member may rename or delete a collective (PLAN §4.2, M0). */
const ADMIN_LEVEL = 8;

/** Top-level folder of a path. */
function topOf(path: string): string {
	const slash = path.indexOf('/');
	return slash < 0 ? path : path.slice(0, slash);
}

/** The decision for a proposal id, or undefined if the user was not asked yet. */
function decisionFor(ctx: Context, id: string): 'accept' | 'reject' | 'defer' | undefined {
	return ctx.decisions.get(id);
}

function pageCount(ctx: Context, collectiveId: CollectiveId): number {
	const remote = ctx.tree.counts.get(collectiveId);
	if (remote !== undefined) return remote;
	return Object.values(ctx.state.pages).filter((page) => page.collectiveId === collectiveId).length;
}

/**
 * Plans everything that concerns a whole collective. A collective with a pending folder change is blocked: its pages are
 * planned in the next pass, when the vault and the state agree again.
 */
export function planCollectives(ctx: Context): void {
	const { local } = ctx.input;
	const topFolders = local.folders.filter((folder) => !folder.includes('/') && !folder.startsWith('.'));
	const knownKeys = new Set<string>(Object.values(ctx.state.collectives).map((c) => pathKey(c.localFolder)));
	const plannedKeys = new Set<string>([...ctx.input.paths.collectiveFolders.values()].map(pathKey));
	const unknownFolders = topFolders.filter((folder) => !knownKeys.has(pathKey(folder)) && !plannedKeys.has(pathKey(folder)));
	const claimedFolders = new Set<string>();

	for (const collective of Object.values(ctx.state.collectives)) {
		planKnownCollective(ctx, collective, unknownFolders, claimedFolders);
	}
	planNewFolders(ctx, unknownFolders.filter((folder) => !claimedFolders.has(pathKey(folder))));
}

function planKnownCollective(ctx: Context, collective: CollectiveState, unknownFolders: string[], claimedFolders: Set<string>): void {
	const id = collective.collectiveId;
	if (ctx.failed.has(id)) {
		ctx.blocked.add(id);
		return;
	}
	const remote = ctx.remoteCollectives.get(id);
	if (remote === undefined) {
		planVanishedCollective(ctx, collective);
		return;
	}
	const { local } = ctx.input;
	const folderExists = local.folders.some((folder) => pathKey(folder) === pathKey(collective.localFolder));
	const renamedFolder = folderExists ? null : findRenamedFolder(ctx, collective, unknownFolders, claimedFolders);

	if (remote.collective.name !== collective.name) {
		// The server's name wins, wherever the folder is now.
		const from = folderExists ? collective.localFolder : renamedFolder;
		if (from !== null) {
			if (renamedFolder !== null) claimedFolders.add(pathKey(renamedFolder));
			const to = freeFolderName(ctx, id, remote.collective.name, from);
			ctx.collectiveOps.push({ kind: 'renameCollectiveFolder', collectiveId: id, from, to, name: remote.collective.name });
			ctx.blocked.add(id);
			ctx.followUp = true;
			return;
		}
	}
	if (folderExists) return;

	if (renamedFolder !== null) {
		claimedFolders.add(pathKey(renamedFolder));
		ctx.blocked.add(id);
		ctx.followUp = true;
		if (remote.collective.level >= ADMIN_LEVEL) {
			ctx.collectiveOps.push({ kind: 'renameCollective', collectiveId: id, circleId: remote.collective.circleId, name: lastSegment(renamedFolder), folder: renamedFolder });
		} else {
			ctx.collectiveOps.push({ kind: 'renameCollectiveFolder', collectiveId: id, from: renamedFolder, to: collective.localFolder, name: collective.name });
			ctx.skips.push({ reason: 'renameForbidden', collectiveId: id });
		}
		return;
	}
	planDeletedFolder(ctx, collective, remote.collective.level);
}

/** Local folder of a collective is gone: delete the collective (admins, after confirmation) or restore the folder. */
function planDeletedFolder(ctx: Context, collective: CollectiveState, level: number): void {
	const id = collective.collectiveId;
	if (level < ADMIN_LEVEL) {
		ctx.skips.push({ reason: 'deleteForbidden', collectiveId: id });
		ctx.restore.add(id);
		return;
	}
	const proposalId = `deleteCollective:${id}`;
	const decision = decisionFor(ctx, proposalId);
	ctx.blocked.add(id);
	if (decision === 'accept') {
		ctx.finalOps.push({ kind: 'trashCollective', collectiveId: id, folder: collective.localFolder });
	} else if (decision === 'reject') {
		ctx.blocked.delete(id);
		ctx.restore.add(id);
	} else if (decision === 'defer') {
		ctx.skips.push({ reason: 'deferred', proposalId });
	} else {
		ctx.proposals.push({ id: proposalId, kind: 'deleteCollective', collectiveId: id, name: collective.name, pages: pageCount(ctx, id) });
	}
}

/** The collective is not on the server any more (deleted, or the user left it): its local folder follows after confirmation. */
function planVanishedCollective(ctx: Context, collective: CollectiveState): void {
	const id = collective.collectiveId;
	const proposalId = `removeCollectiveLocal:${id}`;
	const decision = decisionFor(ctx, proposalId);
	ctx.blocked.add(id);
	if (decision === 'accept') {
		ctx.finalOps.push({ kind: 'removeCollectiveLocal', collectiveId: id, folder: collective.localFolder });
	} else if (decision === 'reject') {
		// The folder stays; the plugin forgets the collective, so the next pass treats the folder as a new one.
		ctx.finalOps.push({ kind: 'dropState', pageIds: Object.values(ctx.state.pages).filter((p) => p.collectiveId === id).map((p) => p.pageId), collectiveIds: [id] });
		ctx.followUp = true;
	} else if (decision === 'defer') {
		ctx.skips.push({ reason: 'deferred', proposalId });
	} else {
		ctx.proposals.push({ id: proposalId, kind: 'removeCollectiveLocal', collectiveId: id, name: collective.name, pages: pageCount(ctx, id) });
	}
}

/**
 * The unknown top-level folder that now holds the files of a collective whose own folder is gone (a rename in the vault),
 * or null. The folder with the most of the collective's files wins.
 */
function findRenamedFolder(ctx: Context, collective: CollectiveState, unknownFolders: string[], claimedFolders: Set<string>): string | null {
	const pageIds = new Set<number>(Object.values(ctx.state.pages).filter((p) => p.collectiveId === collective.collectiveId).map((p) => p.pageId));
	const counts = new Map<string, number>();
	for (const file of ctx.input.local.files) {
		if (file.pageId === null || !pageIds.has(file.pageId)) continue;
		counts.set(pathKey(topOf(file.path)), (counts.get(pathKey(topOf(file.path))) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const folder of unknownFolders) {
		if (claimedFolders.has(pathKey(folder))) continue;
		const count = counts.get(pathKey(folder)) ?? 0;
		if (count > bestCount) {
			best = folder;
			bestCount = count;
		}
	}
	return best;
}

/**
 * A top-level folder name for a collective: the sanitized name, or the first free `name (n)`. The collective's own folders
 * (`from`, its folder in the state and the one planned for it) do not count as taken.
 */
function freeFolderName(ctx: Context, collectiveId: CollectiveId, name: string, from: string): string {
	const taken = new Set<string>(ctx.input.local.folders.filter((f) => !f.includes('/')).map(pathKey));
	for (const [id, folder] of ctx.input.paths.collectiveFolders) if (id !== collectiveId) taken.add(pathKey(folder));
	for (const c of Object.values(ctx.state.collectives)) if (c.collectiveId !== collectiveId) taken.add(pathKey(c.localFolder));
	taken.delete(pathKey(from));
	return withSuffix(sanitizeName(name), taken);
}

/** New top-level folders with notes become collectives (PLAN §7.4), as the setting says. */
function planNewFolders(ctx: Context, folders: string[]): void {
	for (const folder of folders) {
		const files = ctx.input.local.files.filter((file) => pathKey(topOf(file.path)) === pathKey(folder));
		if (files.length === 0) continue;
		const create = (): void => {
			ctx.collectiveOps.push({ kind: 'createCollective', folder, landingFile: landingFileOf(folder, files) });
			ctx.followUp = true;
		};
		if (ctx.behaviour.newFolder === 'ignore') {
			ctx.skips.push({ reason: 'folderIgnored', path: folder });
		} else if (ctx.behaviour.newFolder === 'createCollective') {
			create();
		} else {
			const proposalId = `newCollective:${folder}`;
			const decision = decisionFor(ctx, proposalId);
			if (decision === 'accept') create();
			else if (decision === 'reject') ctx.skips.push({ reason: 'folderIgnored', path: folder });
			else if (decision === 'defer') ctx.skips.push({ reason: 'deferred', proposalId });
			else ctx.proposals.push({ id: proposalId, kind: 'newCollective', folder, files: files.length });
		}
	}
}

/** The file named like the folder (without nc_page_id) becomes the landing page. */
function landingFileOf(folder: string, files: LocalFile[]): string | null {
	const key = pathKey(`${folder}/${folder}.md`);
	return files.find((file) => file.pageId === null && pathKey(file.path) === key)?.path ?? null;
}
