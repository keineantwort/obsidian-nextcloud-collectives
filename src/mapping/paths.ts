import type { PageInfo } from '../api/types';
/** User-relative WebDAV path of a page's Markdown file: collectivePath/filePath/fileName. Only for PageInfo, never TrashedPage (no collectivePath there). */
export function remotePagePath(page: Pick<PageInfo, 'collectivePath' | 'filePath' | 'fileName'>): string {
	return page.collectivePath + '/' + (page.filePath ? page.filePath + '/' : '') + page.fileName;
}
