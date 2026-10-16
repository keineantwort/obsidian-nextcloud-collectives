export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'MOVE';
export interface HttpRequest { url: string; method: HttpMethod; headers: Record<string, string>; body?: string; }
export interface HttpResponse { status: number; headers: Record<string, string>; text: string; }
/** Performs one HTTP request. Must resolve for every HTTP status (incl. 4xx/5xx); rejects only if no response was received. */
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;

export interface ConnectionCredentials { serverUrl: string; username: string; appPassword: string; }
export interface ConnectionResult { collectiveCount: number; }

export const COLLECTIVES_OCS_BASE = '/ocs/v2.php/apps/collectives/api/v1.0';

export function normalizeServerUrl(input: string): string { void input; throw new Error('not implemented'); }
export function basicAuthHeader(username: string, password: string): string { void username; void password; throw new Error('not implemented'); }
export async function testConnection(creds: ConnectionCredentials, request: RequestFn): Promise<ConnectionResult> { void creds; void request; throw new Error('not implemented'); }
