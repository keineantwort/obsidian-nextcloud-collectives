const encoder = new TextEncoder();

/** SHA-256 over the UTF-8 bytes, lowercase hex. crypto.subtle only. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash of title, emoji and tag names (sorted) – PLAN §6.3 metaHash. Deterministic: sha256Hex(JSON.stringify([title, emoji, [...tags].sort()])). */
export async function metaHash(title: string | null, emoji: string | null, tags: readonly string[]): Promise<string> {
	return sha256Hex(JSON.stringify([title, emoji, [...tags].sort()]));
}
