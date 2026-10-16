import { ApiChangedError } from '../util/errors';
import { isRecord } from '../util/isRecord';
import type { HttpClient, HttpMethod } from './http';

export const OCS_COLLECTIVES_BASE = '/ocs/v2.php/apps/collectives/api/v1.0';
export const OCS_CIRCLES_BASE = '/ocs/v2.php/apps/circles';

/** Calls Nextcloud OCS endpoints and unwraps the `ocs.data` envelope. */
export class OcsClient {
	private readonly http: HttpClient;

	constructor(http: HttpClient) {
		this.http = http;
	}

	/**
	 * Calls an OCS endpoint. `path` is absolute below the server, e.g. OCS_COLLECTIVES_BASE + '/collectives'.
	 * Headers: 'OCS-APIRequest': 'true', 'Accept': 'application/json'; with a body additionally
	 * 'Content-Type': 'application/json' and body = JSON.stringify(body).
	 * Returns the unwrapped `ocs.data` (any JSON value, may be [] for void endpoints).
	 * Non-2xx statuses are already mapped by HttpClient.send.
	 * 2xx body not JSON, or not { ocs: { data: … } } (ocs must be an object and contain the key 'data') → ApiChangedError.
	 */
	async request(method: HttpMethod, path: string, body?: Record<string, unknown>): Promise<unknown> {
		const headers: Record<string, string> = { 'OCS-APIRequest': 'true', 'Accept': 'application/json' };
		let payload: string | undefined;
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json';
			payload = JSON.stringify(body);
		}
		const res = await this.http.send({ method, path, headers, body: payload });
		return unwrapOcsData(res.text);
	}
}

function unwrapOcsData(text: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new ApiChangedError('OCS response is not JSON', { cause: err });
	}
	const ocs: unknown = isRecord(parsed) ? parsed['ocs'] : undefined;
	if (!isRecord(ocs) || !('data' in ocs)) throw new ApiChangedError('OCS response has no ocs.data');
	return ocs['data'];
}
