import { AuthError, ConflictError, ForbiddenError, NcError, NetworkError, NotFoundError, ServerError } from '../util/errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'MOVE';
export interface HttpRequest { url: string; method: HttpMethod; headers: Record<string, string>; body?: string; }
export interface HttpResponse { status: number; headers: Record<string, string>; text: string; }
/** Performs one HTTP request. Must resolve for every HTTP status (incl. 4xx/5xx); rejects only if no response was received. */
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;

/** Delays before retry 1, 2, 3 (PLAN §12: backoff 1/2/4 s, max. 3 retries). */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

/** Methods that are retried. Only reading requests: a retried write could be applied twice or turn into a false 412. */
export const RETRYABLE_METHODS: readonly HttpMethod[] = ['GET', 'PROPFIND'];

/** Builds an HTTP Basic Authorization header value. Encodes UTF-8 bytes with web APIs only, so it works on mobile. */
export function basicAuthHeader(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}

/**
 * Central status → error mapping. Returns null for 2xx (200–299).
 * 401 → AuthError(401); 403 → ForbiddenError; 404 → NotFoundError; 412 → ConflictError;
 * every other status → ServerError(status).
 * `what` is a short, credential-free description used in the message, e.g. 'GET /ocs/v2.php/…/collectives'.
 */
export function errorForStatus(status: number, what: string): NcError | null {
	if (status >= 200 && status <= 299) return null;
	if (status === 401) return new AuthError(401, `Authentication failed (HTTP 401) for ${what}`);
	if (status === 403) return new ForbiddenError(`Access denied (HTTP 403) for ${what}`);
	if (status === 404) return new NotFoundError(`Not found (HTTP 404) for ${what}`);
	if (status === 412) return new ConflictError(`Precondition failed (HTTP 412) for ${what}`);
	return new ServerError(status, `Unexpected HTTP ${status} for ${what}`);
}

/** Case-insensitive header lookup (requestUrl does not guarantee lower-case keys on every platform). Returns undefined if absent. */
export function getHeader(headers: Record<string, string>, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value;
	}
	return undefined;
}

export interface HttpClientOptions {
	/** Server base URL, already normalized by normalizeServerUrl (origin + optional sub-path, no trailing slash). */
	baseUrl: string;
	username: string;
	appPassword: string;
	request: RequestFn;
	/** Retry reading requests on NetworkError and 5xx. Default true. The connection test passes false for fast feedback. */
	retry?: boolean;
	/** Waits `ms` milliseconds. Injectable for tests. Default: promise around window.setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export interface SendOptions {
	method: HttpMethod;
	/** Absolute path below the server base URL, must start with '/'. Already URL-encoded by the caller. */
	path: string;
	headers?: Record<string, string>;
	body?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export class HttpClient {
	readonly baseUrl: string;
	readonly username: string;
	private readonly appPassword: string;
	private readonly request: RequestFn;
	private readonly retry: boolean;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(options: HttpClientOptions) {
		this.baseUrl = options.baseUrl;
		this.username = options.username;
		this.appPassword = options.appPassword;
		this.request = options.request;
		this.retry = options.retry ?? true;
		this.sleep = options.sleep ?? defaultSleep;
	}

	/**
	 * Sends baseUrl + path with the caller's headers plus `Authorization: Basic …` (the caller can not override it).
	 * - A path that does not start with '/' or contains '://' is a programming error: throw `Error('Invalid request path')`
	 *   synchronously-in-promise (reject) without sending anything.
	 * - If the RequestFn rejects: an NcError is passed through unchanged; anything else becomes
	 *   NetworkError('Request failed: <METHOD> <path>', { cause }).
	 * - 2xx → resolves with the HttpResponse.
	 * - non-2xx → rejects with errorForStatus(status, `${method} ${path}`).
	 * - Retry: only if retry is enabled AND method is in RETRYABLE_METHODS AND the failure is a NetworkError or a status >= 500.
	 *   Before retry n (n = 1..3) it awaits sleep(RETRY_DELAYS_MS[n-1]). After the 3rd retry fails, the last error is thrown.
	 *   So at most 4 attempts in total. 4xx are never retried.
	 */
	async send(options: SendOptions): Promise<HttpResponse> {
		if (!options.path.startsWith('/') || options.path.includes('://')) throw new Error('Invalid request path');

		for (let retriesDone = 0; ; retriesDone++) {
			try {
				return await this.attempt(options);
			} catch (err) {
				const delay = RETRY_DELAYS_MS[retriesDone];
				if (!this.retry || delay === undefined || !isRetryable(options.method, err)) throw err;
				await this.sleep(delay);
			}
		}
	}

	private async attempt(options: SendOptions): Promise<HttpResponse> {
		const { method, path } = options;
		const what = `${method} ${path}`;
		// Authorization is set last, so no caller header (in any letter case) can replace it.
		const headers = withoutAuthorization(options.headers ?? {});
		headers['Authorization'] = basicAuthHeader(this.username, this.appPassword);

		let res: HttpResponse;
		try {
			res = await this.request({ url: this.baseUrl + path, method, headers, body: options.body });
		} catch (err) {
			if (err instanceof NcError) throw err;
			throw new NetworkError(`Request failed: ${what}`, { cause: err });
		}

		const error = errorForStatus(res.status, what);
		if (error) throw error;
		return res;
	}
}

function withoutAuthorization(headers: Record<string, string>): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== 'authorization') kept[key] = value;
	}
	return kept;
}

function isRetryable(method: HttpMethod, err: unknown): boolean {
	if (!RETRYABLE_METHODS.includes(method)) return false;
	if (err instanceof NetworkError) return true;
	return err instanceof ServerError && err.status >= 500;
}
