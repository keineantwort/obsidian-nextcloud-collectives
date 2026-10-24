// Extracts the server's own error reason from a failed response body (ADR 0028).
import { isRecord } from '../util/isRecord';

/** Longest detail kept; longer text is cut and ends with '…'. */
export const MAX_DETAIL_LENGTH = 200;

/** Namespace of the Sabre/DAV exception elements in WebDAV error bodies. */
const SABRE_NS = 'http://sabredav.org/ns';
const DAV_NS = 'DAV:';
const MIN_SECRET_LENGTH = 3;

/**
 * Pure. Extracts the server's own error reason from a non-2xx response body, or undefined (ADR 0028).
 * - JSON body with a non-empty string at `ocs.meta.message` → that message.
 * - XML body whose root is `{DAV:}error` → `<s:exception>: <s:message>` (Sabre namespace, looked up by namespace).
 * - Anything else (empty, HTML, plain text, other JSON, malformed XML/JSON) → undefined, never throws, never returns the raw body.
 * The reason is cleaned: whitespace collapsed, secrets replaced by '***', and cut to MAX_DETAIL_LENGTH characters.
 */
export function extractErrorDetail(text: string, secrets: readonly string[]): string | undefined {
	const reason = readReason(text);
	if (reason === undefined) return undefined;
	let cleaned = reason.replace(/\s+/g, ' ').trim();
	for (const secret of secrets) {
		if (secret.length >= MIN_SECRET_LENGTH) cleaned = cleaned.split(secret).join('***');
	}
	if (cleaned.length > MAX_DETAIL_LENGTH) cleaned = cleaned.slice(0, MAX_DETAIL_LENGTH - 1) + '…';
	return cleaned === '' ? undefined : cleaned;
}

/** Picks the raw reason out of the body, by its first non-whitespace character (trimStart also drops a BOM). */
function readReason(text: string): string | undefined {
	const trimmed = text.trimStart();
	try {
		if (trimmed.startsWith('{')) return readOcsMessage(trimmed);
		if (trimmed.startsWith('<')) return readSabreError(trimmed);
	} catch {
		return undefined;
	}
	return undefined;
}

/** `ocs.meta.message` of a JSON body, if it is a non-empty string. */
function readOcsMessage(text: string): string | undefined {
	const body: unknown = JSON.parse(text);
	if (!isRecord(body) || !isRecord(body['ocs'])) return undefined;
	const meta = body['ocs']['meta'];
	if (!isRecord(meta)) return undefined;
	const message = meta['message'];
	return typeof message === 'string' && message !== '' ? message : undefined;
}

/** `<s:exception>: <s:message>` of a WebDAV error body whose root is `{DAV:}error`. */
function readSabreError(text: string): string | undefined {
	const doc = new DOMParser().parseFromString(text, 'application/xml');
	if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) return undefined;
	const root = doc.documentElement;
	if (!root || root.localName !== 'error' || root.namespaceURI !== DAV_NS) return undefined;
	const exception = sabreText(root, 'exception');
	const message = sabreText(root, 'message');
	if (exception && message) return `${exception}: ${message}`;
	return exception || message || undefined;
}

/** Text of the first Sabre element with the given local name, or undefined if missing or empty. */
function sabreText(root: Element, localName: string): string | undefined {
	const element = root.getElementsByTagNameNS(SABRE_NS, localName).item(0);
	const text = element?.textContent?.trim();
	return text ? text : undefined;
}
