// Builds the index of pages that links are converted with (PLAN §9). Pure: no Obsidian, no network imports.
import { LinkIndex } from '../mapping/links';
import type { LinkTarget } from '../mapping/links';
import type { PathPlan } from '../mapping/paths';
import type { LocalSnapshot } from './localScanner';
import { indexFiles } from './locate';
import type { RemoteSnapshot } from './remoteScanner';

/**
 * Every page of the remote listing, with the vault path of its note: the file that carries its nc_page_id, else the path the
 * plan gives it. Pages without a local path can be linked to from Collectives, but not from a note.
 */
export function buildLinkIndex(remote: RemoteSnapshot, local: LocalSnapshot, paths: PathPlan, serverUrl: string): LinkIndex {
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
	return new LinkIndex(targets, serverUrl);
}
