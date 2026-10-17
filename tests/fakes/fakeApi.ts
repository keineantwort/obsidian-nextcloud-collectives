// Fake Collectives API with a small server model, for the executor tests of the structure operations.
import type { StructureApi } from '../../src/sync/executorDeps';
import { asCollectiveId, asPageId } from '../../src/api/types';
import { asTagId } from '../../src/api/types';
import type { Collective, CollectiveId, PageId, PageInfo, Tag, TagId } from '../../src/api/types';
import { NotFoundError, ServerError } from '../../src/util/errors';
import type { FakeDav } from './fakeDav';

interface Entry {
	page: PageInfo;
	collectiveId: CollectiveId;
	trashed: boolean;
}

/** Pages are kept flat: a page's file is `<title>.md` in the folder of its collective, a parent with children is `<title>/Readme.md`. */
export class FakeApi implements StructureApi {
	readonly entries = new Map<PageId, Entry>();
	readonly collectives = new Map<CollectiveId, Collective & { trashed: boolean }>();
	/** Calls in order, e.g. 'createPage 1 5 Titel'. */
	readonly calls: string[] = [];
	/** Errors by method name; thrown once by the next call of that method. */
	readonly failures = new Map<string, Error>();
	/** Tags per collective. Names are compared case-sensitively like the server on SQLite; a duplicate is a 400. */
	readonly tags = new Map<CollectiveId, Tag[]>();
	private nextId = 1000;
	private nextTagId = 500;

	constructor(private readonly dav: FakeDav) {}

	addCollective(id: number, name: string, level = 9): Collective {
		const collective: Collective & { trashed: boolean } = {
			id: asCollectiveId(id), circleId: `circle-${id}`, name, slug: name.toLowerCase(), emoji: null, level, canEdit: true, trashTimestamp: null, trashed: false,
		};
		this.collectives.set(collective.id, collective);
		this.addPage(id, { title: name, fileName: 'Readme.md', parentId: asPageId(0), id: asPageId(id * 100) });
		return collective;
	}

	addPage(collectiveId: number, over: Partial<PageInfo> & { title: string }): PageInfo {
		const collective = this.collectives.get(asCollectiveId(collectiveId));
		const id = over.id ?? asPageId(this.nextId++);
		const page: PageInfo = {
			id, slug: `s-${id}`, title: over.title, emoji: null, tags: [], timestamp: 1000, size: 0, fileName: `${over.title}.md`, filePath: '',
			collectivePath: `.Collectives/${collective?.name ?? 'Coll'}`, parentId: asPageId(1), subpageOrder: [], lastUserId: null, linkedPageIds: [],
			trashTimestamp: null, ...over,
		};
		this.entries.set(id, { page, collectiveId: asCollectiveId(collectiveId), trashed: false });
		this.dav.serve(page, '', `"e-${id}"`);
		return page;
	}

	private fail(method: string): void {
		const error = this.failures.get(method);
		if (error !== undefined) {
			this.failures.delete(method);
			throw error;
		}
	}

	private require(collectiveId: CollectiveId, pageId: PageId): Entry {
		const entry = this.entries.get(pageId);
		if (entry === undefined || entry.collectiveId !== collectiveId || entry.trashed) throw new NotFoundError(`page ${pageId}`);
		return entry;
	}

	async createPage(collectiveId: CollectiveId, parentId: PageId, title: string): Promise<PageInfo> {
		this.calls.push(`createPage ${collectiveId} ${parentId} ${title}`);
		this.fail('createPage');
		const parent = this.require(collectiveId, parentId);
		if (parent.page.parentId !== 0 && parent.page.fileName !== 'Readme.md') {
			parent.page = { ...parent.page, fileName: 'Readme.md', filePath: parent.page.title };
		}
		return this.addPage(collectiveId, { title, parentId, filePath: parent.page.parentId === 0 ? '' : parent.page.title });
	}

	async getPage(collectiveId: CollectiveId, pageId: PageId): Promise<PageInfo> {
		this.calls.push(`getPage ${collectiveId} ${pageId}`);
		return this.require(collectiveId, pageId).page;
	}

	async updatePage(collectiveId: CollectiveId, pageId: PageId, change: { title?: string; parentId?: PageId }): Promise<PageInfo> {
		this.calls.push(`updatePage ${collectiveId} ${pageId} ${JSON.stringify(change)}`);
		this.fail('updatePage');
		const entry = this.require(collectiveId, pageId);
		entry.page = { ...entry.page, ...(change.title === undefined ? {} : { title: change.title, fileName: `${change.title}.md` }), ...(change.parentId === undefined ? {} : { parentId: change.parentId }) };
		return entry.page;
	}

	async movePageToCollective(collectiveId: CollectiveId, pageId: PageId, newCollectiveId: CollectiveId, target?: { parentId?: PageId }): Promise<void> {
		this.calls.push(`movePageToCollective ${collectiveId} ${pageId} ${newCollectiveId} ${JSON.stringify(target ?? {})}`);
		this.fail('movePageToCollective');
		const entry = this.require(collectiveId, pageId);
		entry.collectiveId = newCollectiveId;
		entry.page = { ...entry.page, parentId: target?.parentId ?? entry.page.parentId };
		for (const child of this.entries.values()) if (child.page.parentId === pageId) child.collectiveId = newCollectiveId;
	}

	async trashPage(collectiveId: CollectiveId, pageId: PageId): Promise<void> {
		this.calls.push(`trashPage ${collectiveId} ${pageId}`);
		this.fail('trashPage');
		this.require(collectiveId, pageId).trashed = true;
	}

	async restorePage(collectiveId: CollectiveId, pageId: PageId): Promise<PageInfo> {
		this.calls.push(`restorePage ${collectiveId} ${pageId}`);
		this.fail('restorePage');
		const entry = this.entries.get(pageId);
		if (entry === undefined || entry.collectiveId !== collectiveId || !entry.trashed) throw new NotFoundError(`trashed page ${pageId}`);
		entry.trashed = false;
		return entry.page;
	}

	async listPages(collectiveId: CollectiveId): Promise<PageInfo[]> {
		this.calls.push(`listPages ${collectiveId}`);
		return [...this.entries.values()].filter((e) => e.collectiveId === collectiveId && !e.trashed).map((e) => e.page);
	}

	async createCollective(name: string): Promise<Collective> {
		this.calls.push(`createCollective ${name}`);
		this.fail('createCollective');
		const id = this.nextId++;
		return this.addCollective(id, name);
	}

	async renameCollective(circleId: string, name: string): Promise<void> {
		this.calls.push(`renameCollective ${circleId} ${name}`);
		this.fail('renameCollective');
		const collective = [...this.collectives.values()].find((c) => c.circleId === circleId);
		if (collective === undefined) throw new NotFoundError(circleId);
		collective.name = name;
	}

	async trashCollective(collectiveId: CollectiveId): Promise<void> {
		this.calls.push(`trashCollective ${collectiveId}`);
		this.fail('trashCollective');
		const collective = this.collectives.get(collectiveId);
		if (collective === undefined) throw new NotFoundError(String(collectiveId));
		collective.trashed = true;
	}

	async setPageEmoji(collectiveId: CollectiveId, pageId: PageId, emoji: string | null): Promise<PageInfo> {
		this.calls.push(`setPageEmoji ${collectiveId} ${pageId} ${emoji ?? 'null'}`);
		this.fail('setPageEmoji');
		const entry = this.require(collectiveId, pageId);
		entry.page = { ...entry.page, emoji };
		return entry.page;
	}

	async addPageTag(collectiveId: CollectiveId, pageId: PageId, tagId: TagId): Promise<PageInfo> {
		this.calls.push(`addPageTag ${collectiveId} ${pageId} ${tagId}`);
		this.fail('addPageTag');
		const entry = this.require(collectiveId, pageId);
		if (!entry.page.tags.includes(tagId)) entry.page = { ...entry.page, tags: [...entry.page.tags, tagId] };
		return entry.page;
	}

	async removePageTag(collectiveId: CollectiveId, pageId: PageId, tagId: TagId): Promise<void> {
		this.calls.push(`removePageTag ${collectiveId} ${pageId} ${tagId}`);
		this.fail('removePageTag');
		const entry = this.require(collectiveId, pageId);
		entry.page = { ...entry.page, tags: entry.page.tags.filter((id) => id !== tagId) };
	}

	async listTags(collectiveId: CollectiveId): Promise<Tag[]> {
		this.calls.push(`listTags ${collectiveId}`);
		return [...(this.tags.get(collectiveId) ?? [])];
	}

	/** Adds a tag the server has (no call recorded). */
	addTag(collectiveId: number, name: string): Tag {
		const tag: Tag = { id: asTagId(this.nextTagId++), collectiveId: asCollectiveId(collectiveId), name, color: '' };
		this.tags.set(tag.collectiveId, [...(this.tags.get(tag.collectiveId) ?? []), tag]);
		return tag;
	}

	async createTag(collectiveId: CollectiveId, name: string, color: string): Promise<Tag> {
		this.calls.push(`createTag ${collectiveId} ${name} ${color}`);
		this.fail('createTag');
		if ((this.tags.get(collectiveId) ?? []).some((tag) => tag.name === name)) throw new ServerError(400);
		const tag = this.addTag(collectiveId, name);
		return { ...tag, color };
	}
}
