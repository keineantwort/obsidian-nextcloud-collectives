// Fake WebDAV with a remote file store, for the executor tests.
import type { DavFile, DavWriteResult, PutPrecondition, WebdavClient } from '../../src/api/webdavClient';
import type { PageInfo } from '../../src/api/types';
import { remotePagePath } from '../../src/mapping/paths';
import { ConflictError, NotFoundError } from '../../src/util/errors';

/** A remote file as the fake server holds it: body, ETag and the two headers the confirmation check reads. */
export interface RemoteFile { content: string; etag: string; lastModified: string | null; date: string | null; }

/** Headers of a GET whose ETag can be trusted: the file was written in an earlier second than the response. */
export const CONFIRMED = { lastModified: 'Thu, 15 Oct 2026 10:00:00 GMT', date: 'Fri, 16 Oct 2026 12:30:00 GMT' };
/** Headers of a GET whose ETag cannot be trusted: last write and response in the same second. */
export const UNCONFIRMED = { lastModified: 'Fri, 16 Oct 2026 12:30:00 GMT', date: 'Fri, 16 Oct 2026 12:30:00 GMT' };

export interface DavRequest { method: 'GET' | 'PUT'; path: string; ifMatch: string | null; }

/**
 * Fake WebDAV with a remote file store. GET returns body, ETag and headers of the stored file. PUT checks If-Match against
 * the stored ETag (ConflictError, i.e. HTTP 412, on mismatch), stores the body under a new ETag and is recorded.
 * `beforePut` runs before the check of every PUT, so a test can change the remote as another client would.
 */
export class FakeDav {
	readonly files = new Map<string, RemoteFile>();
	readonly errors = new Map<string, Error>();
	readonly requests: DavRequest[] = [];
	beforePut: (() => void) | null = null;
	private counter = 0;

	readonly webdav: Pick<WebdavClient, 'get' | 'put'> = {
		get: async (path: string): Promise<DavFile> => {
			this.requests.push({ method: 'GET', path, ifMatch: null });
			const error = this.errors.get(path);
			if (error) throw error;
			const file = this.files.get(path);
			if (file === undefined) throw new NotFoundError(`Not found: ${path}`);
			return { content: file.content, etag: file.etag, lastModified: file.lastModified, date: file.date };
		},
		put: async (path: string, content: string, precondition: PutPrecondition): Promise<DavWriteResult> => {
			const ifMatch = 'ifMatch' in precondition ? precondition.ifMatch : null;
			this.requests.push({ method: 'PUT', path, ifMatch });
			this.beforePut?.();
			const file = this.files.get(path);
			if (file === undefined) throw new NotFoundError(`Not found: ${path}`);
			if (ifMatch !== file.etag) throw new ConflictError(`Precondition failed for ${path}`);
			this.counter++;
			const etag = `"put-${this.counter}"`;
			this.files.set(path, { content, etag, ...CONFIRMED });
			return { etag };
		},
	};

	serve(p: PageInfo, content: string, etag: string): void {
		this.set(p, content, etag, CONFIRMED);
	}

	serveUnconfirmed(p: PageInfo, content: string, etag: string): void {
		this.set(p, content, etag, UNCONFIRMED);
	}

	/** Another client writes the page: new content under a new ETag, with confirmed headers. */
	externalWrite(p: PageInfo, content: string): void {
		this.counter++;
		this.set(p, content, `"ext-${this.counter}"`, CONFIRMED);
	}

	/**
	 * Same-second write as Nextcloud does it: the content changes but the ETag stays (one-second resolution), and the
	 * headers are given as the caller needs them (UNCONFIRMED while the write and the response share a second).
	 */
	rewriteKeepingEtag(p: PageInfo, content: string, headers: { lastModified: string; date: string }): void {
		this.set(p, content, this.require(p).etag, headers);
	}

	fail(p: PageInfo, error: Error): void {
		this.errors.set(remotePagePath(p), error);
	}

	content(p: PageInfo): string {
		return this.require(p).content;
	}

	etagOf(p: PageInfo): string {
		return this.require(p).etag;
	}

	puts(): DavRequest[] {
		return this.requests.filter((req) => req.method === 'PUT');
	}

	gets(p: PageInfo): DavRequest[] {
		return this.requests.filter((req) => req.method === 'GET' && req.path === remotePagePath(p));
	}

	private set(p: PageInfo, content: string, etag: string, headers: { lastModified: string; date: string }): void {
		this.files.set(remotePagePath(p), { content, etag, ...headers });
	}

	private require(p: PageInfo): RemoteFile {
		const file = this.files.get(remotePagePath(p));
		if (file === undefined) throw new Error(`no remote file for page ${p.id}`);
		return file;
	}
}

