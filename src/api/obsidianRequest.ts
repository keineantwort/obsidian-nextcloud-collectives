import { requestUrl } from 'obsidian';
import { withTimeout } from '../util/timeout';
import type { RequestFn } from './http';

export const REQUEST_TIMEOUT_MS = 30_000;

/** RequestFn backed by Obsidian's requestUrl (throw: false), with timeout. */
export const obsidianRequest: RequestFn = async (req) => {
	const res = await withTimeout(
		requestUrl({ url: req.url, method: req.method, headers: req.headers, body: req.body, throw: false }),
		REQUEST_TIMEOUT_MS,
	);
	return { status: res.status, headers: res.headers, text: readText(res) };
};

/**
 * `res.text` decodes the body as text and can throw for non-text payloads. An empty string is
 * returned in that case; the caller then reports the unexpected body (e.g. ApiChangedError),
 * so the failure stays visible.
 */
function readText(res: { readonly text: string }): string {
	try {
		return res.text;
	} catch {
		return '';
	}
}
