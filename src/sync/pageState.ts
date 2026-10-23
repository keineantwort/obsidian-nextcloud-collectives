// PageState builders shared by the executor modules (architecture §6.3). Pure.
import type { CollectiveId, PageInfo } from '../api/types';
import type { NcMeta } from '../mapping/frontmatter';
import { ncTitleFor } from '../mapping/paths';
import { UNCONFIRMED_REMOTE_MTIME } from './state';
import type { PageState, PageStatus } from './state';

/** The remote version a state stores: its ETag and the remoteMtime that may be trusted for it. */
export interface RemoteVersion {
	etag: string;
	remoteMtime: number;
}

/** Remote fields of PageState, taken from the listing and the remote version. */
export function remoteFields(page: PageInfo, remote: RemoteVersion): Pick<PageState, 'remoteFilePath' | 'remoteFileName' | 'parentId' | 'remoteEtag' | 'remoteMtime' | 'remoteSize'> {
	return {
		remoteFilePath: page.filePath,
		remoteFileName: page.fileName,
		parentId: page.parentId,
		remoteEtag: remote.etag,
		remoteMtime: remote.remoteMtime,
		remoteSize: page.size,
	};
}

/** The local fields of a page state that an operation decides on. */
export interface LocalFields {
	localPath: string;
	localMtime: number;
	baseHash: string;
	metaHash: string;
	status: PageStatus;
	conflictPath: string | null;
	lastSyncedAt: number;
}

/** State of a page that the state does not know yet. Remote fields come from the listing and the GET. */
export function newPageState(page: PageInfo, collectiveId: CollectiveId, remote: RemoteVersion, fields: LocalFields): PageState {
	return { pageId: page.id, collectiveId, ...remoteFields(page, remote), attachments: [], ...fields };
}

/** State of a linked page after its file was written or checked against the remote text `baseHash`. */
export function markSynced(
	prev: PageState,
	update: { page: PageInfo; remote: RemoteVersion; baseHash: string; metaHash: string; localMtime: number; now: number },
): PageState {
	return {
		...prev,
		...remoteFields(update.page, update.remote),
		baseHash: update.baseHash,
		metaHash: update.metaHash,
		localMtime: update.localMtime,
		status: 'synced',
		conflictPath: null,
		lastSyncedAt: update.now,
	};
}

/** State of a page after a conflict copy was written next to its file. */
export function markConflict(
	prev: PageState,
	update: { page: PageInfo; remote: RemoteVersion; status: PageStatus; baseHash: string; conflictPath: string; localMtime: number; now: number },
): PageState {
	return {
		...prev,
		...remoteFields(update.page, update.remote),
		status: update.status,
		baseHash: update.baseHash,
		conflictPath: update.conflictPath,
		localMtime: update.localMtime,
		lastSyncedAt: update.now,
	};
}

/** Frontmatter metadata for a write to `path`: nc_title is derived from the file name actually written. */
export function metaFor(page: PageInfo, meta: NcMeta, path: string): NcMeta {
	return { ...meta, title: ncTitleFor(page.title, path, page.parentId === 0) };
}

/** The remote version after our own write (PUT or structure change): its ETag cannot be trusted, so the next run reads the page. */
export function unconfirmedRemote(etag: string): RemoteVersion {
	return { etag, remoteMtime: UNCONFIRMED_REMOTE_MTIME };
}
