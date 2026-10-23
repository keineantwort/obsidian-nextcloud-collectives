// Builds the index of pages that links are converted with (architecture §9). Pure: no Obsidian, no network imports.
import type { PageId } from '../api/types';
import { AttachmentIndex, attachmentFolderFor } from '../mapping/attachments';
import type { AttachmentOptions } from '../mapping/attachments';
import { LinkIndex } from '../mapping/links';
import type { LinkTarget } from '../mapping/links';
import type { PathPlan } from '../mapping/paths';
import type { LocalSnapshot } from './localScanner';
import { indexFiles } from './locate';
import type { RemoteSnapshot } from './remoteScanner';
import type { SyncState } from './state';

/**
 * Every page of the remote listing, with the vault path of its note: the file that carries its nc_page_id, else the path the
 * plan gives it. Pages without a local path can be linked to from Collectives, but not from a note.
 */
export function buildLinkIndex(
	remote: RemoteSnapshot,
	local: LocalSnapshot,
	paths: PathPlan,
	serverUrl: string,
	attachments?: { options: AttachmentOptions; state: SyncState },
): LinkIndex {
	const files = indexFiles(local.files);
	const targets: LinkTarget[] = [];
	for (const rc of remote.collectives) {
		for (const page of rc.pages) {
			const located = files.byId.get(page.id)?.path;
			targets.push({
				pageId: page.id,
				collectiveId: rc.collective.id,
				collectiveSlug: rc.collective.slug,
				slug: page.slug,
				landing: page.parentId === 0,
				title: page.title,
				remotePath: page.filePath === '' ? page.fileName : `${page.filePath}/${page.fileName}`,
				localPath: located ?? paths.targets.get(page.id)?.path ?? null,
			});
		}
	}
	return new LinkIndex(targets, serverUrl, attachments === undefined ? undefined : buildAttachmentIndex(targets, local, attachments));
}

/** Attachment folders by page (from the note's path and the pattern), what the state knows, and the vault's candidate files. */
function buildAttachmentIndex(targets: readonly LinkTarget[], local: LocalSnapshot, input: { options: AttachmentOptions; state: SyncState }): AttachmentIndex {
	const folders = new Map<PageId, string>();
	for (const target of targets) {
		if (target.localPath !== null) folders.set(target.pageId, attachmentFolderFor(target.localPath, input.options.pattern));
	}
	const known = new Map<PageId, { name: string; localPath: string }[]>();
	for (const page of Object.values(input.state.pages)) {
		if (page.attachments.length > 0) known.set(page.pageId, page.attachments.map((entry) => ({ name: entry.name, localPath: entry.localPath })));
	}
	return new AttachmentIndex({ files: local.attachmentFiles, folders, known, maxBytes: input.options.maxBytes });
}
