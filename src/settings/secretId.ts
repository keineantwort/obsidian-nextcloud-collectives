export const SECRET_ID_PREFIX = 'nextcloud-collectives-';

/** Secret IDs allowed by Obsidian: lowercase letters, digits and dashes, non-empty. */
const VALID_SECRET_ID = /^[a-z0-9-]+$/;

/** Builds a secret-storage ID from random bytes: prefix + lowercase hex of the bytes. Throws Error if bytes is empty. */
export function buildSecretId(randomBytes: Uint8Array): string {
	if (randomBytes.length === 0) throw new Error('buildSecretId requires at least one random byte');
	const hex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return SECRET_ID_PREFIX + hex;
}

/** Secret IDs allowed by Obsidian: lowercase letters, digits and dashes, non-empty. */
export function isValidSecretId(id: string): boolean {
	return VALID_SECRET_ID.test(id);
}
