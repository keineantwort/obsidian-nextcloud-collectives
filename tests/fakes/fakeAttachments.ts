// Fake attachment storage: WebDAV folders of `.attachments.{id}` and the two OCS calls the attachment step uses.
import type { DavBinary, DavEntry, DavWriteResult, PutPrecondition, WebdavClient } from '../../src/api/webdavClient';
import type { CollectivesApi } from '../../src/api/collectivesApi';
import { asAttachmentId } from '../../src/api/types';
import type { Attachment, AttachmentId, CollectiveId, PageId } from '../../src/api/types';
import { ConflictError, NotFoundError } from '../../src/util/errors';

interface StoredFile { data: ArrayBuffer; etag: string; fileId: number; }

export const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
export const textOf = (data: ArrayBuffer): string => new TextDecoder().decode(data);

/** Fake server side of attachments. Folder paths and file names are user-relative WebDAV paths, like the real client's. */
export class FakeAttachmentDav {
	readonly folders = new Set<string>();
	readonly files = new Map<string, StoredFile>();
	readonly calls: string[] = [];
	readonly deleted: { pageId: PageId; attachmentId: AttachmentId }[] = [];
	/** Paths whose getBinary fails with this error. */
	readonly getErrors = new Map<string, Error>();
	private counter = 0;

	readonly webdav: Pick<WebdavClient, 'propfind' | 'mkcol' | 'getBinary' | 'putBinary'> = {
		propfind: async (path: string): Promise<DavEntry[]> => {
			this.calls.push(`PROPFIND ${path}`);
			if (!this.folders.has(path)) throw new NotFoundError(`Not found: ${path}`);
			const entries: DavEntry[] = [{ path, isCollection: true, etag: null, lastModified: null, contentLength: null, fileId: null }];
			for (const [filePath, file] of this.files) {
				if (!filePath.startsWith(`${path}/`) || filePath.slice(path.length + 1).includes('/')) continue;
				entries.push({ path: filePath, isCollection: false, etag: file.etag, lastModified: null, contentLength: file.data.byteLength, fileId: file.fileId });
			}
			return entries;
		},
		mkcol: async (path: string): Promise<void> => {
			this.calls.push(`MKCOL ${path}`);
			this.folders.add(path);
		},
		getBinary: async (path: string): Promise<DavBinary> => {
			this.calls.push(`GET ${path}`);
			const error = this.getErrors.get(path);
			if (error) throw error;
			const file = this.files.get(path);
			if (file === undefined) throw new NotFoundError(`Not found: ${path}`);
			return { data: file.data, etag: file.etag };
		},
		putBinary: async (path: string, data: ArrayBuffer, _contentType: string, precondition: PutPrecondition): Promise<DavWriteResult> => {
			this.calls.push(`PUT ${path} ${'ifNoneMatch' in precondition ? 'new' : 'match'}`);
			if ('ifNoneMatch' in precondition && this.files.has(path)) throw new ConflictError(`Precondition failed: ${path}`);
			return { etag: this.store(path, data) };
		},
	};

	readonly api: Pick<CollectivesApi, 'listAttachments' | 'deleteAttachment'> = {
		listAttachments: async (_collectiveId: CollectiveId, pageId: PageId): Promise<Attachment[]> => {
			const prefix = `.attachments.${pageId}/`;
			return [...this.files].filter(([path]) => path.includes(prefix)).map(([path, file]) => ({
				id: asAttachmentId(file.fileId), name: path.slice(path.lastIndexOf('/') + 1), filesize: file.data.byteLength, mimetype: '',
				timestamp: 0, path, src: '', internalPath: '', hasPreview: false, type: 'file',
			}));
		},
		deleteAttachment: async (_collectiveId: CollectiveId, pageId: PageId, attachmentId: AttachmentId): Promise<void> => {
			this.deleted.push({ pageId, attachmentId });
			for (const [path, file] of this.files) if (file.fileId === attachmentId) this.files.delete(path);
		},
	};

	/** A file as another client left it (the folder is created). Returns its ETag. */
	serve(folder: string, name: string, text: string): string {
		this.folders.add(folder);
		return this.store(`${folder}/${name}`, bytes(text));
	}

	remove(folder: string, name: string): void {
		this.files.delete(`${folder}/${name}`);
	}

	count(prefix: string): number {
		return this.calls.filter((call) => call.startsWith(prefix)).length;
	}

	private store(path: string, data: ArrayBuffer): string {
		this.counter++;
		const etag = `"att-${this.counter}"`;
		this.files.set(path, { data, etag, fileId: this.files.get(path)?.fileId ?? 1000 + this.counter });
		return etag;
	}
}
