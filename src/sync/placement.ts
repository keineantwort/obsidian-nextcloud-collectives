// Where a local file belongs in the page tree of its collective (architecture §7.4, ADR 0004, ADR 0018). Pure.
import type { CollectiveId, PageId } from '../api/types';
import { pathKey } from '../mapping/paths';
import type { LocalFile } from './localScanner';
import { locatePage } from './locate';
import type { Context } from './plannerContext';
import { collectivesByFolder, dirnameOf, lastSegment, stemOf } from './plannerContext';
import type { ParentRef } from './plannerTypes';
import { isCollision } from './state';

/** Remote file name of a folder page. */
const FOLDER_NOTE = 'Readme.md';

/** Resolves collectives and parent pages from local paths. Creates the missing folder pages (virtual parents) it needs. */
export class Placer {
	private readonly ctx: Context;
	private readonly folderToCollective: Map<string, CollectiveId>;
	/** pathKey of a folder → the folder page whose notes live in it. */
	private readonly owners = new Map<string, ParentRef>();
	/** pathKey of a local file → the file. */
	private readonly filesByKey = new Map<string, LocalFile>();
	/** Virtual parents created in this plan, by pathKey of their folder-note path. */
	private readonly virtuals = new Map<string, ParentRef>();

	constructor(ctx: Context) {
		this.ctx = ctx;
		this.folderToCollective = collectivesByFolder(ctx);
		for (const file of ctx.input.local.files) this.filesByKey.set(pathKey(file.path), file);
		this.indexOwners();
	}

	/** True if the page at `path` is a folder page this plan creates for a folder without a note. */
	isVirtual(path: string): boolean {
		return this.virtuals.has(pathKey(path));
	}

	/** The collective whose folder holds `path`, or undefined (no collective yet, or not a note path). */
	collectiveOf(path: string): CollectiveId | undefined {
		const slash = path.indexOf('/');
		const top = slash < 0 ? path : path.slice(0, slash);
		return this.folderToCollective.get(pathKey(top));
	}

	/**
	 * The parent for the page of the file at `path`. A folder page (the file is the note of its folder) hangs below the page
	 * that owns the folder above; every other page below the page that owns its own folder. `self` is excluded from the
	 * search for the owner, so a page never becomes its own parent.
	 */
	parentFor(path: string, options: { self: PageId | null; folderPage: boolean }): ParentRef | null {
		const collectiveId = this.collectiveOf(path);
		if (collectiveId === undefined) return null;
		const dir = dirnameOf(path);
		const isRoot = !dir.includes('/');
		const asNote = options.folderPage || (!isRoot && this.isNoteOfItsFolder(path, options.self));
		if (asNote) {
			if (isRoot) return null; // the landing page has no parent
			return this.ownerOfDir(dirnameOf(dir), collectiveId, path);
		}
		return this.ownerOfDir(dir, collectiveId, path);
	}

	/** True if the new file at `path` is the note of its folder: its stem names the folder and no other page owns the folder. */
	private isNoteOfItsFolder(path: string, self: PageId | null): boolean {
		const dir = dirnameOf(path);
		const owner = this.owners.get(pathKey(dir));
		if (owner !== undefined) return owner.kind === 'page' && owner.pageId === self;
		return pathKey(stemOf(path)) === pathKey(lastSegment(dir));
	}

	/** The page that owns folder `dir`, creating virtual parents for folders without a page. */
	private ownerOfDir(dir: string, collectiveId: CollectiveId, selfPath: string): ParentRef | null {
		if (!dir.includes('/')) {
			const landing = this.ctx.tree.landing.get(collectiveId);
			return landing === undefined ? null : { kind: 'page', pageId: landing };
		}
		const known = this.owners.get(pathKey(dir));
		if (known !== undefined) return known;
		const name = lastSegment(dir);
		const note = this.refOfFile(`${dir}/${name}.md`, selfPath);
		if (note !== null) return note;
		const leaf = this.refOfFile(`${dirnameOf(dir)}/${name}.md`, selfPath);
		if (leaf !== null) return leaf;
		return this.virtualParent(dir, name, collectiveId);
	}

	/** Reference to the page of the local file at `path` (an existing page, or a page this plan creates), or null. */
	private refOfFile(path: string, selfPath: string): ParentRef | null {
		if (pathKey(path) === pathKey(selfPath)) return null;
		const file = this.filesByKey.get(pathKey(path));
		if (file === undefined) return null;
		// Only pages the server lists can be parents (not a foreign or unknown id, not an id that two files carry).
		if (file.pageId !== null) return this.ctx.tree.pages.has(file.pageId) && !this.ctx.files.duplicates.has(file.pageId) ? { kind: 'page', pageId: file.pageId } : null;
		const collision = Object.values(this.ctx.state.pages).find((p) => isCollision(p) && pathKey(p.localPath) === pathKey(file.path));
		return collision === undefined ? { kind: 'new', path: file.path } : { kind: 'page', pageId: collision.pageId };
	}

	/** A folder page for a folder that has none: created on the server from the folder name, with an empty note. */
	private virtualParent(dir: string, name: string, collectiveId: CollectiveId): ParentRef | null {
		const path = `${dir}/${name}.md`;
		const cached = this.virtuals.get(pathKey(path));
		if (cached !== undefined) return cached;
		const parent = this.ownerOfDir(dirnameOf(dir), collectiveId, path);
		if (parent === null) return null;
		const ref: ParentRef = { kind: 'new', path };
		this.virtuals.set(pathKey(path), ref);
		this.ctx.structureOps.push({ kind: 'createRemote', path, title: name, collectiveId, parent, fileExists: false, order: 0 });
		return ref;
	}

	/** Folders owned by folder pages: the known folder pages, and the ones this run creates in the vault. */
	private indexOwners(): void {
		for (const known of Object.values(this.ctx.state.pages)) {
			if (isCollision(known) || known.remoteFileName !== FOLDER_NOTE) continue;
			const file = locatePage(known, this.ctx.files);
			if (file === undefined) continue;
			this.owners.set(pathKey(dirnameOf(file.path)), { kind: 'page', pageId: known.pageId });
		}
		for (const [pageId, target] of this.ctx.input.paths.targets) {
			if (this.ctx.state.pages[String(pageId)] !== undefined) continue;
			const remote = this.ctx.tree.pages.get(pageId);
			if (remote === undefined || remote.page.fileName !== FOLDER_NOTE) continue;
			const key = pathKey(dirnameOf(target.path));
			if (!this.owners.has(key)) this.owners.set(key, { kind: 'page', pageId });
		}
	}
}
