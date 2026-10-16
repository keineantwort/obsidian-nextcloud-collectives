// Transport contract shared by all API clients. M2 adds the request wrapper (auth, retry, error mapping) here.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'MOVE';
export interface HttpRequest { url: string; method: HttpMethod; headers: Record<string, string>; body?: string; }
export interface HttpResponse { status: number; headers: Record<string, string>; text: string; }
/** Performs one HTTP request. Must resolve for every HTTP status (incl. 4xx/5xx); rejects only if no response was received. */
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;

/** Builds an HTTP Basic Authorization header value. Encodes UTF-8 bytes with web APIs only, so it works on mobile. */
export function basicAuthHeader(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return 'Basic ' + btoa(binary);
}
