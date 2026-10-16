// Response types of the Collectives API and WebDAV. Only the fields the plugin uses; other server fields are ignored.

declare const brand: unique symbol;
/** Nominal type: a number that cannot be mixed up with another ID kind at compile time. Runtime value is still a number. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
export type CollectiveId = Brand<number, 'CollectiveId'>;
export type PageId = Brand<number, 'PageId'>;
export type TagId = Brand<number, 'TagId'>;
export type AttachmentId = Brand<number, 'AttachmentId'>;
export const asCollectiveId = (n: number): CollectiveId => n as CollectiveId;
export const asPageId = (n: number): PageId => n as PageId;
export const asTagId = (n: number): TagId => n as TagId;
export const asAttachmentId = (n: number): AttachmentId => n as AttachmentId;

export interface Collective {
	id: CollectiveId;
	circleId: string;
	name: string;
	slug: string;
	emoji: string | null;
	/** Member level in the circle; >= 8 = admin/owner (may trash the collective). */
	level: number;
	canEdit: boolean;
	trashTimestamp: number | null;
}

export interface PageInfo {
	id: PageId;
	slug: string;
	title: string;
	emoji: string | null;
	/** Tag IDs (not names). */
	tags: TagId[];
	/** mtime, Unix seconds. */
	timestamp: number;
	size: number;
	fileName: string;
	/** Relative to the collective folder, '' at root level. */
	filePath: string;
	/** User-relative folder of the collective, e.g. '.Collectives/Handbuch'. */
	collectivePath: string;
	/** 0 for the landing page (no parent). */
	parentId: PageId;
	subpageOrder: PageId[];
	lastUserId: string | null;
	linkedPageIds: PageId[];
	trashTimestamp: number | null;
}

/**
 * Page from the trash list (`GET …/pages/trash`). The server sends `collectivePath: null` there (M2), and for leaf pages
 * `fileName` carries a `.d<timestamp>` suffix (M0). Never build a WebDAV path from it; restore the page first.
 */
export interface TrashedPage extends Omit<PageInfo, 'collectivePath'> {
	collectivePath: string | null;
}

export interface Tag {
	id: TagId;
	collectiveId: CollectiveId;
	name: string;
	color: string;
}

export interface Attachment {
	id: AttachmentId;
	name: string;
	filesize: number;
	mimetype: string;
	timestamp: number;
	/** User-relative path, e.g. '/.Collectives/Handbuch/.attachments.97/bild.png'. */
	path: string;
	/** Link target as used in page markdown, e.g. '.attachments.97/bild.png'. */
	src: string;
	internalPath: string;
	hasPreview: boolean;
	type: string;
}
