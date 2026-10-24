// Attachments of a page (architecture §9.4, ADR 0021): download, upload and deletion, after the content step of the page.
// Imports nothing from 'obsidian': all vault access goes through VaultWriter.
import type { DavEntry } from '../api/webdavClient';
import type { PageId, PageInfo } from '../api/types';
import { asAttachmentId } from '../api/types';
import { baseName, isInCollectiveFolder, isSafeAttachmentName, isUploadable, mimeTypeOf } from '../mapping/attachments';
import { toRemote } from '../mapping/frontmatter';
import { attachmentRefs, embeddedFiles } from '../mapping/links';
import { conflictPath, pathKey } from '../mapping/paths';
import { ConflictError, NotFoundError, errorLogFields, isRunFatal } from '../util/errors';
import { sha256HexBytes } from '../util/hash';
import { linkContext } from './executorContent';
import type { AttachmentDeps, ExecutorDeps } from './executorDeps';
import { livePage } from './executorScratch';
import { isCollision } from './state';
import type { AttachmentState, PageState } from './state';
import type { SyncResult } from './types';

/** What the attachment step needs of a page operation. */
export interface AttachmentOp {
	page: PageInfo;
	path: string;
}

/** What one page's reconciliation works with. */
interface PageRun {
	deps: ExecutorDeps;
	att: AttachmentDeps;
	result: SyncResult;
	pageId: PageId;
	notePath: string;
	collectiveId: PageState['collectiveId'];
	/** User-relative WebDAV folder `.attachments.{id}` of the page. */
	folder: string;
	/** Files in that folder by name; null if the folder does not exist. */
	listing: Map<string, DavEntry> | null;
	/** Names the page text embeds. */
	refs: ReadonlySet<string>;
	/** False for a page in conflict: its text differs from the server's, so nothing is deleted on either side. */
	synced: boolean;
	/** True once the folder is known to exist. */
	folderReady: boolean;
	/** True if a file was uploaded or deleted: etags and ids are read again. */
	touchedRemote: boolean;
}

/**
 * Brings the attachments of a page in line, after its text is in line: files the text embeds but the vault lacks are
 * downloaded, local files it embeds but the server lacks are uploaded, files the server deleted leave the vault (setting),
 * files deleted in the vault and no longer embedded are deleted on the server (setting). Unchanged files are not transferred
 * (ETag compared). Returns true if the sync state changed. A failing file is logged and counted; the others go on.
 */
export async function syncAttachments(op: AttachmentOp, deps: ExecutorDeps, result: SyncResult): Promise<boolean> {
	const att = deps.attachments;
	const context = linkContext(deps, op.page.id);
	const s = deps.state.pages[String(op.page.id)];
	if (att === undefined || context === undefined || s === undefined || isCollision(s) || !deps.vault.exists(op.path)) return false;

	const text = await deps.vault.read(op.path);
	const embedded = embeddedFiles(text, context);
	const refs = new Set<string>([...attachmentRefs(toRemote(text, context), op.page.id), ...embedded.keys()]);
	const known = new Map<string, AttachmentState>(s.attachments.map((entry) => [entry.name, entry]));
	const names = [...new Set<string>([...refs, ...known.keys()])];
	if (names.length === 0) return false;

	const page = livePage(deps, op.page);
	const folder = `${page.collectivePath}/${page.filePath === '' ? '' : page.filePath + '/'}.attachments.${page.id}`;
	const listing = await listFolder(att, folder);
	if (listing === null && known.size > 0) {
		// A folder that vanished with synced files in it is more likely a page in motion than a deletion of everything.
		deps.log.info('Attachment folder missing: attachments left alone', { pageId: page.id });
		return false;
	}
	const run: PageRun = {
		deps, att, result, pageId: page.id, notePath: op.path, collectiveId: s.collectiveId, folder, listing, refs,
		folderReady: listing !== null, touchedRemote: false, synced: s.status === 'synced',
	};

	const next = new Map<string, AttachmentState>();
	for (const name of names) {
		const rec = known.get(name);
		const path = embedded.get(name) ?? deps.links?.attachments?.localPath(page.id, name) ?? rec?.localPath;
		// Nothing is written, replaced or trashed outside the collective's folder, whatever the state or the server says.
		if (path === undefined || !isSafeAttachmentName(name) || !isUploadable(path, op.path)) {
			if (rec !== undefined) next.set(name, rec);
			continue;
		}
		try {
			const kept = await reconcile(run, name, rec, path);
			if (kept !== null) next.set(name, kept);
		} catch (err) {
			if (isRunFatal(err)) throw err;
			result.failed++;
			deps.log.warn('Attachment failed', { pageId: page.id, ...errorLogFields(err) });
			if (rec !== undefined) next.set(name, rec);
			else next.set(name, pending(name, path));
		}
	}
	if (run.touchedRemote) await refreshRemoteFields(run, next);

	const after = [...next.values()].sort((a, b) => a.name.localeCompare(b.name));
	if (JSON.stringify(after) === JSON.stringify(s.attachments)) return false;
	deps.state.pages[String(page.id)] = { ...s, attachments: after };
	return true;
}

/** A file whose transfer failed or is still to do: `etag` '' makes the next run try again. */
function pending(name: string, localPath: string): AttachmentState {
	return { id: asAttachmentId(0), name, etag: '', localPath, hash: '' };
}

/** The files in the page's attachment folder by name, or null if there is no such folder. */
async function listFolder(att: AttachmentDeps, folder: string): Promise<Map<string, DavEntry> | null> {
	try {
		const entries = await att.webdav.propfind(folder, 1);
		return new Map(entries.filter((entry) => !entry.isCollection && isSafeAttachmentName(baseName(entry.path))).map((entry) => [baseName(entry.path), entry]));
	} catch (err) {
		if (err instanceof NotFoundError) return null;
		throw err;
	}
}

/** Decides one file. Returns its new state entry, or null if it is not tracked (any more). */
async function reconcile(run: PageRun, name: string, rec: AttachmentState | undefined, path: string): Promise<AttachmentState | null> {
	const { deps } = run;
	const remote = run.listing?.get(name);
	const exists = deps.vault.exists(path);

	if (remote === undefined) {
		if (rec !== undefined && rec.etag !== '') return run.synced ? removedOnServer(run, rec, path) : rec;
		// Never on the server: a local file the page embeds is uploaded; without the file there is nothing to do.
		return exists ? upload(run, name, path) : null;
	}
	if (!exists) {
		if (rec !== undefined && rec.etag !== '' && !run.refs.has(name)) return run.synced ? deletedLocally(run, rec) : rec;
		return download(run, name, remote, path, rec);
	}
	if (rec === undefined || rec.hash === '') return compareExisting(run, name, remote, path, rec);
	if (rec.etag === remote.etag) return rec.localPath === path ? rec : { ...rec, localPath: path };
	return updateFromServer(run, name, remote, path, rec);
}

/** True if the server did not report a size or reports one above the limit: such a file is not downloaded. */
function tooBig(run: PageRun, remote: DavEntry): boolean {
	return remote.contentLength === null || remote.contentLength > run.att.options.maxBytes;
}

/** The server no longer has a file we synced: it leaves the vault (to Obsidian's trash) unless the user changed it. */
async function removedOnServer(run: PageRun, rec: AttachmentState, path: string): Promise<AttachmentState | null> {
	const { deps } = run;
	// A file outside the collective folder (a pasted image in the vault root) is never trashed because of the server.
	if (!deps.vault.exists(path) || !isInCollectiveFolder(path, run.notePath)) return null;
	if (run.att.remoteDelete === 'keepUnlinked') return null;
	if ((await sha256HexBytes(await deps.vault.readBinary(path))) !== rec.hash) {
		deps.log.info('Attachment deleted on the server but changed here: kept', { pageId: run.pageId });
		return null;
	}
	await deps.vault.trash(path);
	run.result.attachments++;
	return null;
}

/** The file is gone from the vault and no longer embedded: delete it on the server (setting), else just forget it. */
async function deletedLocally(run: PageRun, rec: AttachmentState): Promise<AttachmentState | null> {
	if (!run.att.deleteRemote) return null;
	const attachments = await run.att.api.listAttachments(run.collectiveId, run.pageId);
	const found = attachments.find((attachment) => attachment.name === rec.name);
	if (found !== undefined) {
		await run.att.api.deleteAttachment(run.collectiveId, run.pageId, found.id);
		run.touchedRemote = true;
		run.result.attachments++;
	}
	return null;
}

/** Writes the file from the server into the vault (new file, or a lost one restored). */
async function download(run: PageRun, name: string, remote: DavEntry, path: string, rec: AttachmentState | undefined): Promise<AttachmentState | null> {
	const { deps } = run;
	if (tooBig(run, remote)) {
		deps.log.info('Attachment above the size limit not downloaded', { pageId: run.pageId });
		return rec ?? null;
	}
	const file = await run.att.webdav.getBinary(remotePath(run, name));
	if (file.data.byteLength > run.att.options.maxBytes) return rec ?? null;
	await ensureFolders(deps, path.slice(0, path.lastIndexOf('/')));
	if (deps.vault.exists(path)) await deps.vault.modifyBinary(path, file.data);
	else await deps.vault.createBinary(path, file.data);
	deps.occupied.add(pathKey(path));
	run.result.attachments++;
	return entryOf(name, remote, path, await sha256HexBytes(file.data));
}

/**
 * The file lies in the vault and on the server, but nothing is known about what they shared: equal bytes are adopted,
 * different ones keep the vault file and put the server's bytes next to it as a conflict copy.
 */
async function compareExisting(run: PageRun, name: string, remote: DavEntry, path: string, rec: AttachmentState | undefined): Promise<AttachmentState | null> {
	const { deps } = run;
	if (tooBig(run, remote)) return rec ?? null;
	const file = await run.att.webdav.getBinary(remotePath(run, name));
	if (file.data.byteLength > run.att.options.maxBytes) return rec ?? null;
	const remoteHash = await sha256HexBytes(file.data);
	const localHash = await sha256HexBytes(await deps.vault.readBinary(path));
	if (localHash !== remoteHash) await writeConflictCopy(run, path, file.data);
	return entryOf(name, remote, path, remoteHash);
}

/** The server file changed: the vault file takes it if the user did not change it, else the server's bytes become a conflict copy. */
async function updateFromServer(run: PageRun, name: string, remote: DavEntry, path: string, rec: AttachmentState): Promise<AttachmentState | null> {
	const { deps } = run;
	if (tooBig(run, remote) || !isInCollectiveFolder(path, run.notePath)) return rec;
	const file = await run.att.webdav.getBinary(remotePath(run, name));
	if (file.data.byteLength > run.att.options.maxBytes) return rec;
	const remoteHash = await sha256HexBytes(file.data);
	const localHash = await sha256HexBytes(await deps.vault.readBinary(path));
	if (localHash === remoteHash) return entryOf(name, remote, path, remoteHash);
	if (localHash === rec.hash) {
		await deps.vault.modifyBinary(path, file.data);
		run.result.attachments++;
		return entryOf(name, remote, path, remoteHash);
	}
	await writeConflictCopy(run, path, file.data);
	// The base moves on to the server's bytes: the vault file stays a local change, so the next server change is a conflict again.
	return entryOf(name, remote, path, remoteHash);
}

/** Uploads a vault file as a new attachment (never over an existing file: If-None-Match). */
async function upload(run: PageRun, name: string, path: string): Promise<AttachmentState | null> {
	const { deps } = run;
	const data = await deps.vault.readBinary(path);
	if (data.byteLength > run.att.options.maxBytes) {
		deps.log.info('Attachment above the size limit not uploaded', { pageId: run.pageId });
		return null;
	}
	if (!run.folderReady) {
		await run.att.webdav.mkcol(run.folder);
		run.folderReady = true;
	}
	let etag: string;
	try {
		etag = (await run.att.webdav.putBinary(remotePath(run, name), data, mimeTypeOf(name), { ifNoneMatch: '*' })).etag;
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		// A file of this name appeared on the server since the listing: it is not overwritten.
		deps.log.warn('Attachment not uploaded: the name is taken on the server', { pageId: run.pageId });
		return pending(name, path);
	}
	run.touchedRemote = true;
	run.result.attachments++;
	return { id: asAttachmentId(0), name, etag, localPath: path, hash: await sha256HexBytes(data) };
}

/** After uploads or deletions: ETags and ids as the server lists them now, so the next run sees no change. */
async function refreshRemoteFields(run: PageRun, entries: Map<string, AttachmentState>): Promise<void> {
	const listing = await listFolder(run.att, run.folder);
	if (listing === null) return;
	for (const [name, entry] of entries) {
		const remote = listing.get(name);
		if (remote !== undefined && entry.etag !== '') entries.set(name, { ...entry, etag: remote.etag ?? entry.etag, id: asAttachmentId(remote.fileId ?? 0) });
	}
}

function entryOf(name: string, remote: DavEntry, localPath: string, hash: string): AttachmentState {
	return { id: asAttachmentId(remote.fileId ?? 0), name, etag: remote.etag ?? '', localPath, hash };
}

function remotePath(run: PageRun, name: string): string {
	return `${run.folder}/${name}`;
}

/** Creates `folder` and the folders above it that are missing. */
async function ensureFolders(deps: ExecutorDeps, folder: string): Promise<void> {
	if (folder === '' || deps.vault.exists(folder)) return;
	await ensureFolders(deps, folder.slice(0, Math.max(0, folder.lastIndexOf('/'))));
	await deps.vault.createFolder(folder);
}

/** `name (Konflikt 2026-10-16 1430).png` next to the file; the server's bytes go there. */
async function writeConflictCopy(run: PageRun, path: string, data: ArrayBuffer): Promise<void> {
	const { deps } = run;
	const slash = path.lastIndexOf('/');
	const dot = path.lastIndexOf('.');
	const extension = dot > slash ? path.slice(dot) : '';
	const stem = extension === '' ? path : path.slice(0, dot);
	const base = conflictPath(`${stem}.md`, deps.conflictLabel, deps.now(), deps.occupied).slice(0, -'.md'.length);
	let copy = `${base}${extension}`;
	for (let n = 2; deps.vault.exists(copy); n++) copy = `${base} (${n})${extension}`;
	await deps.vault.createBinary(copy, data);
	deps.log.info('Attachment conflict copy created', { pageId: run.pageId, path: copy });
	run.result.conflicts++;
}
