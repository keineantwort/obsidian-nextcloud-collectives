import { OCS_CIRCLES_BASE, OCS_COLLECTIVES_BASE, type OcsClient } from './ocsClient';
import { parseAttachment, parseCollective, parseItem, parseList, parsePageInfo, parseTag, parseTrashedPage } from './parse';
import type { Attachment, Collective, PageInfo, Tag, TrashedPage } from './types';

const TAG_COLOR = /^([0-9a-fA-F]{6})?$/;

/** Typed calls of the Collectives OCS API. Paths are relative to OCS_COLLECTIVES_BASE unless noted. */
export class CollectivesApi {
	private readonly ocs: OcsClient;

	constructor(ocs: OcsClient) {
		this.ocs = ocs;
	}

	async listCollectives(): Promise<Collective[]> {
		const data = await this.ocs.request('GET', OCS_COLLECTIVES_BASE + '/collectives');
		return parseList(data, 'collectives', parseCollective);
	}

	async createCollective(name: string, emoji?: string): Promise<Collective> {
		const data = await this.ocs.request('POST', OCS_COLLECTIVES_BASE + '/collectives', { name, emoji });
		return parseItem(data, 'collective', parseCollective);
	}

	async setCollectiveEmoji(collectiveId: number, emoji: string | null): Promise<void> {
		await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}`, { emoji });
	}

	/** Renames a collective through the Circles API, which owns the circle name. */
	async renameCollective(circleId: string, name: string): Promise<void> {
		await this.ocs.request('PUT', `${OCS_CIRCLES_BASE}/circles/${encodeURIComponent(circleId)}/name`, { value: name });
	}

	async trashCollective(collectiveId: number): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}`);
	}

	async listTrashedCollectives(): Promise<Collective[]> {
		const data = await this.ocs.request('GET', OCS_COLLECTIVES_BASE + '/collectives/trash');
		return parseList(data, 'collectives', parseCollective);
	}

	async restoreCollective(collectiveId: number): Promise<void> {
		await this.ocs.request('PATCH', `${OCS_COLLECTIVES_BASE}/collectives/trash/${collectiveId}`);
	}

	async listPages(collectiveId: number): Promise<PageInfo[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages`);
		return parseList(data, 'pages', parsePageInfo);
	}

	async getPage(collectiveId: number, pageId: number): Promise<PageInfo> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async createPage(collectiveId: number, parentId: number, title: string): Promise<PageInfo> {
		const data = await this.ocs.request('POST', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${parentId}`, { title });
		return parseItem(data, 'page', parsePageInfo);
	}

	async updatePage(
		collectiveId: number,
		pageId: number,
		change: { title?: string; parentId?: number; index?: number },
	): Promise<PageInfo> {
		const body = { title: change.title, parentId: change.parentId, index: change.index, copy: false };
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`, body);
		return parseItem(data, 'page', parsePageInfo);
	}

	async movePageToCollective(
		collectiveId: number,
		pageId: number,
		newCollectiveId: number,
		target?: { parentId?: number; index?: number },
	): Promise<void> {
		const body = { parentId: target?.parentId, index: target?.index, copy: false };
		await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/to/${newCollectiveId}`, body);
	}

	async setPageEmoji(collectiveId: number, pageId: number, emoji: string | null): Promise<PageInfo> {
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/emoji`, { emoji });
		return parseItem(data, 'page', parsePageInfo);
	}

	async addPageTag(collectiveId: number, pageId: number, tagId: number): Promise<PageInfo> {
		const data = await this.ocs.request('PUT', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/tags/${tagId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async removePageTag(collectiveId: number, pageId: number, tagId: number): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/tags/${tagId}`);
	}

	async trashPage(collectiveId: number, pageId: number): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}`);
	}

	async listTrashedPages(collectiveId: number): Promise<TrashedPage[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/trash`);
		return parseList(data, 'pages', parseTrashedPage);
	}

	async restorePage(collectiveId: number, pageId: number): Promise<PageInfo> {
		const data = await this.ocs.request('PATCH', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/trash/${pageId}`);
		return parseItem(data, 'page', parsePageInfo);
	}

	async listTags(collectiveId: number): Promise<Tag[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/tags`);
		return parseList(data, 'tags', parseTag);
	}

	/** `color` is 6 hex digits without '#', or '' (no color). Other values are rejected before any request is sent. */
	async createTag(collectiveId: number, name: string, color: string): Promise<Tag> {
		if (!TAG_COLOR.test(color)) throw new Error('Invalid tag color');
		const data = await this.ocs.request('POST', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/tags`, { name, color });
		return parseItem(data, 'tag', parseTag);
	}

	async listAttachments(collectiveId: number, pageId: number): Promise<Attachment[]> {
		const data = await this.ocs.request('GET', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/attachments`);
		return parseList(data, 'attachments', parseAttachment);
	}

	async deleteAttachment(collectiveId: number, pageId: number, attachmentId: number): Promise<void> {
		await this.ocs.request('DELETE', `${OCS_COLLECTIVES_BASE}/collectives/${collectiveId}/pages/${pageId}/attachments/${attachmentId}`);
	}
}
