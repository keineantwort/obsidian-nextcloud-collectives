import { OCS_CIRCLES_BASE, OCS_CLOUD_USER, OCS_COLLECTIVES_BASE, type OcsClient } from './ocsClient';
import { parseAttachment, parseCollective, parseItem, parseList, parsePageInfo, parseTag, parseTrashedPage } from './parse';
import type { Attachment, AttachmentId, Collective, CollectiveId, PageId, PageInfo, Tag, TagId, TrashedPage } from './types';
import { ApiChangedError } from '../util/errors';
import { isRecord } from '../util/isRecord';

const TAG_COLOR = /^([0-9a-fA-F]{6})?$/;

/** Typed calls of the Collectives OCS API. Paths are relative to OCS_COLLECTIVES_BASE unless noted. */
export class CollectivesApi {
	private readonly ocs: OcsClient;

	constructor(ocs: OcsClient) {
		this.ocs = ocs;
	}

	/** Login-independent Nextcloud user ID (GET /ocs/v2.php/cloud/user → data.id). WebDAV paths need it. */
	async getCurrentUserId(): Promise<string> {
		const data = await this.ocs.request('GET', OCS_CLOUD_USER);
		const id: unknown = isRecord(data) ? data['id'] : undefined;
		if (typeof id !== 'string' || id === '') throw new ApiChangedError('Unexpected response: "id" is not a non-empty string');
		return id;
	}

	async listCollectives(): Promise<Collective[]> {
		const data = await this.ocs.request('GET', OCS_COLLECTIVES_BASE + '/collectives');
		return parseList(data, 'collectives', parseCollective);
	}

	async createCollective(name: string, emoji?: string): Promise<Collective> {
		const data = await this.ocs.request('POST', OCS_COLLECTIVES_BASE + '/collectives', { name, emoji });
		return parseItem(data, 'collective', parseCollective);
	}

	/** `null` removes the emoji. The server ignores a JSON null (M6, docs/api-notes.md); it removes the emoji for ''. */
	async setCollectiveEmoji(collectiveId: CollectiveId, emoji: string | null): Promise<void> {
		await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}`, { emoji: emoji ?? '' });
	}

	/** Renames a collective through the Circles API, which owns the circle name. */
	async renameCollective(circleId: string, name: string): Promise<void> {
		await this.ocs.request('PUT', `${OCS_CIRCLES_BASE}/circles/${encodeURIComponent(circleId)}/name`, { value: name });
	}

	async trashCollective(collectiveId: CollectiveId): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}`);
	}

	async listTrashedCollectives(): Promise<Collective[]> {
		const data = await this.ocs.request('GET', OCS_COLLECTIVES_BASE + '/collectives/trash');
		return parseList(data, 'collectives', parseCollective);
	}

	async restoreCollective(collectiveId: CollectiveId): Promise<void> {
		await this.ocs.request('PATCH', `${OCS_COLLECTIVES_BASE}/collectives/trash/${collectiveId}`);
	}

	async listPages(collectiveId: CollectiveId): Promise<PageInfo[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages`);
		return parseList(data, 'pages', parsePageInfo);
	}

	async getPage(collectiveId: CollectiveId, pageId: PageId): Promise<PageInfo> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async createPage(collectiveId: CollectiveId, parentId: PageId, title: string): Promise<PageInfo> {
		const data = await this.ocs.request('POST', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${parentId}`, { title });
		return parseItem(data, 'page', parsePageInfo);
	}

	async updatePage(
		collectiveId: CollectiveId,
		pageId: PageId,
		change: { title?: string; parentId?: PageId; index?: number },
	): Promise<PageInfo> {
		const body = { title: change.title, parentId: change.parentId, index: change.index, copy: false };
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`, body);
		return parseItem(data, 'page', parsePageInfo);
	}

	async movePageToCollective(
		collectiveId: CollectiveId,
		pageId: PageId,
		newCollectiveId: CollectiveId,
		target?: { parentId?: PageId; index?: number },
	): Promise<void> {
		const body = { parentId: target?.parentId, index: target?.index, copy: false };
		await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/to/${newCollectiveId}`, body);
	}

	/** `null` removes the emoji. The server ignores a JSON null (M6, docs/api-notes.md); it removes the emoji for ''. */
	async setPageEmoji(collectiveId: CollectiveId, pageId: PageId, emoji: string | null): Promise<PageInfo> {
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/emoji`, { emoji: emoji ?? '' });
		return parseItem(data, 'page', parsePageInfo);
	}

	async addPageTag(collectiveId: CollectiveId, pageId: PageId, tagId: TagId): Promise<PageInfo> {
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/tags/${tagId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async removePageTag(collectiveId: CollectiveId, pageId: PageId, tagId: TagId): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/tags/${tagId}`);
	}

	async trashPage(collectiveId: CollectiveId, pageId: PageId): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`);
	}

	async listTrashedPages(collectiveId: CollectiveId): Promise<TrashedPage[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/trash`);
		return parseList(data, 'pages', parseTrashedPage);
	}

	async restorePage(collectiveId: CollectiveId, pageId: PageId): Promise<PageInfo> {
		const data = await this.ocs.request('PATCH', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/trash/${pageId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async listTags(collectiveId: CollectiveId): Promise<Tag[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/tags`);
		return parseList(data, 'tags', parseTag);
	}

	/** `color` is 6 hex digits without '#', or '' (no color). Other values are rejected before any request is sent. */
	async createTag(collectiveId: CollectiveId, name: string, color: string): Promise<Tag> {
		if (!TAG_COLOR.test(color)) throw new Error('Invalid tag color');
		const data = await this.ocs.request('POST', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/tags`, { name, color });
		return parseItem(data, 'tag', parseTag);
	}

	async listAttachments(collectiveId: CollectiveId, pageId: PageId): Promise<Attachment[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/attachments`);
		return parseList(data, 'attachments', parseAttachment);
	}

	async deleteAttachment(collectiveId: CollectiveId, pageId: PageId, attachmentId: AttachmentId): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/attachments/${attachmentId}`);
	}
}
