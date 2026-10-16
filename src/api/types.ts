// Response types of the Collectives API and WebDAV. Only the fields the plugin uses; other server fields are ignored.

export interface Collective {
	id: number;
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
	id: number;
	slug: string;
	title: string;
	emoji: string | null;
	/** Tag IDs (not names). */
	tags: number[];
	/** mtime, Unix seconds. */
	timestamp: number;
	size: number;
	fileName: string;
	/** Relative to the collective folder, '' at root level. */
	filePath: string;
	/** User-relative folder of the collective, e.g. '.Collectives/Handbuch'. */
	collectivePath: string;
	parentId: number;
	subpageOrder: number[];
	lastUserId: string | null;
	linkedPageIds: number[];
	trashTimestamp: number | null;
}

/** Page from the trash list (`GET …/pages/trash`). The server sends `collectivePath: null` there (M2); all other fields as in PageInfo. */
export interface TrashedPage extends Omit<PageInfo, 'collectivePath'> {
	collectivePath: string | null;
}

export interface Tag {
	id: number;
	collectiveId: number;
	name: string;
	color: string;
}

export interface Attachment {
	id: number;
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
