import { AuthError, ConflictError, ForbiddenError, NcError, NetworkError, NotFoundError, ServerError } from '../util/errors';
import { extractErrorDetail } from './errorDetail';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'MOVE';
export interface HttpRequest {
	url: string;
	method: HttpMethod;
	headers: Record<string, string>;
	body?: string | ArrayBuffer;
	/** Timeout for this request; the transport's default if absent (large attachments need more). */
	timeoutMs?: number;
	/** Deliver the body as `data` (bytes) instead of `text`. */
	binaryResponse?: boolean;
}
export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	/** Response bytes, set when the request asked for `binaryResponse` (then `text` is empty). */
	data?: ArrayBuffer;
}
/** Performs one HTTP request. Must resolve for every HTTP status (incl. 4xx/5xx); rejects only if no response was received. */
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;

/** Delays before retry 1, 2, 3 (architecture §12: backoff 1/2/4 s, max. 3 retries). */
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
 * every other status → ServerError(status, message).
 * `what` is a short, credential-free description used in the message, e.g. 'GET /ocs/v2.php/…/collectives'.
 * `detail` is the server's cleaned reason (extractErrorDetail); it is put on every error as `detail`.
 */
export function errorForStatus(status: number, what: string, detail?: string): NcError | null {
	if (status >= 200 && status <= 299) return null;
	const options = detail === undefined ? undefined : { detail };
	if (status === 401) return new AuthError(401, `Authentication failed (HTTP 401) for ${what}`, options);
	if (status === 403) return new ForbiddenError(`Access denied (HTTP 403) for ${what}`, options);
	if (status === 404) return new NotFoundError(`Not found (HTTP 404) for ${what}`, options);
	if (status === 412) return new ConflictError(`Precondition failed (HTTP 412) for ${what}`, options);
	return new ServerError(status, `Unexpected HTTP ${status} for ${what}`, options);
}

/**
 * The error for a response, with the server's reason as detail (ADR 0028); null for 2xx. The body is read only on
 * failure. A binary response has no text, so its bytes are decoded as UTF-8. `secrets` are masked in the detail.
 */
export function errorForResponse(res: HttpResponse, what: string, secrets: readonly string[]): NcError | null {
	if (res.status >= 200 && res.status <= 299) return null;
	const body = res.text === '' && res.data !== undefined ? new TextDecoder().decode(res.data) : res.text;
	return errorForStatus(res.status, what, extractErrorDetail(body, secrets));
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
	/** Called after every attempt with method, path (no host, no headers, no body) and status (0 = no response). For debug logging. */
	onAttempt?: (info: AttemptInfo) => void;
}

export interface AttemptInfo { method: HttpMethod; path: string; status: number; ms: number; }

export interface SendOptions {
	method: HttpMethod;
	/** Absolute path below the server base URL, must start with '/'. Already URL-encoded by the caller. */
	path: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	timeoutMs?: number;
	binaryResponse?: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export class HttpClient {
	readonly baseUrl: string;
	readonly username: string;
	private readonly appPassword: string;
	private readonly request: RequestFn;
	private readonly retry: boolean;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly onAttempt: ((info: AttemptInfo) => void) | undefined;

	constructor(options: HttpClientOptions) {
		this.baseUrl = options.baseUrl;
		this.username = options.username;
		this.appPassword = options.appPassword;
		this.request = options.request;
		this.retry = options.retry ?? true;
		this.sleep = options.sleep ?? defaultSleep;
		this.onAttempt = options.onAttempt;
	}

	/**
	 * Sends baseUrl + path with the caller's headers plus `Authorization: Basic …` (the caller can not override it).
	 * - A path that does not start with '/' or contains '://' is a programming error: throw `Error('Invalid request path')`
	 *   synchronously-in-promise (reject) without sending anything.
	 * - If the RequestFn rejects: an NcError is passed through unchanged; anything else becomes
	 *   NetworkError('Request failed: <METHOD> <path>', { cause }).
	 * - 2xx → resolves with the HttpResponse.
	 * - non-2xx → rejects with errorForResponse(res, `${method} ${path}`, secrets), where the detail is the server's own reason
	 *   from the body (extractErrorDetail, password and username removed). Never the raw body.
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
		// Electron (requestUrl) keeps WebDAV responses in its HTTP cache: Nextcloud sends no Cache-Control for them, so a
		// later GET returns the old text and ETag without asking the server (seen in M5). Every read goes to the server.
		if (method === 'GET' || method === 'PROPFIND') {
			headers['Cache-Control'] = 'no-cache';
			headers['Pragma'] = 'no-cache';
		}
		headers['Authorization'] = basicAuthHeader(this.username, this.appPassword);

		const started = Date.now();
		let res: HttpResponse;
		try {
			res = await this.request({
				url: this.baseUrl + path,
				method,
				headers,
				body: options.body,
				timeoutMs: options.timeoutMs,
				binaryResponse: options.binaryResponse,
			});
		} catch (err) {
			this.onAttempt?.({ method, path, status: 0, ms: Date.now() - started });
			if (err instanceof NcError) throw err;
			throw new NetworkError(`Request failed: ${what}`, { cause: err });
		}

		this.onAttempt?.({ method, path, status: res.status, ms: Date.now() - started });
		const error = errorForResponse(res, what, [this.appPassword, this.username]);
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
