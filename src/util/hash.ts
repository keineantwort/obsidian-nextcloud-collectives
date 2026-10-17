const encoder = new TextEncoder();

/** SHA-256 over the UTF-8 bytes, lowercase hex. crypto.subtle only. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash of emoji and tag names (sorted) – PLAN §6.3 metaHash. Deterministic: sha256Hex(JSON.stringify([emoji, [...tags].sort()])).
 * The title is not part of it: only the fields the user can edit in the note are compared (M6, ADR 0019); a renamed
 * page is a structure change.
 */
export async function metaHash(emoji: string | null, tags: readonly string[]): Promise<string> {
	return sha256Hex(JSON.stringify([emoji, [...tags].sort()]));
}

/** SHA-256 over raw bytes, lowercase hex (attachments). */
export async function sha256HexBytes(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
