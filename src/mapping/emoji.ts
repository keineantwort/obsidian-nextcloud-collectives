// The emoji of a page: exactly one emoji (also with skin tone, ZWJ sequence, flag or keycap), or none. Pure.

/** One emoji: a flag, a keycap, or a pictograph with optional variation selector/skin tone, joined by ZWJ, or a tag-sequence flag. */
const ONE_EMOJI = new RegExp(
	'^(?:' +
		'\\p{Regional_Indicator}{2}' +
		'|[0-9#*]\\uFE0F?\\u20E3' +
		'|\\p{Extended_Pictographic}[\\u{E0020}-\\u{E007F}]+' +
		'|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*' +
		')$',
	'u',
);

export interface ParsedEmoji {
	/** The emoji, or null for none (empty input, or invalid). */
	emoji: string | null;
	/** False if the input is something else than one emoji (text, several emojis). */
	valid: boolean;
}

/** Empty input means no emoji; anything but a single emoji is invalid. */
export function parseEmoji(input: string): ParsedEmoji {
	const text = input.trim();
	if (text === '') return { emoji: null, valid: true };
	return ONE_EMOJI.test(text) ? { emoji: text, valid: true } : { emoji: null, valid: false };
}

/** Emojis offered by the picker (command "Set page emoji"), in groups. */
export type EmojiGroupName = 'smileys' | 'gestures' | 'objects' | 'nature' | 'food' | 'travel';

export const EMOJI_GROUPS: readonly { name: EmojiGroupName; emojis: readonly string[] }[] = [
	{ name: 'smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '🤩', '😎', '🤔', '😴', '😇', '🥳', '😢', '😡', '🤯'] },
	{ name: 'gestures', emojis: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🧠', '❤️', '🔥', '⭐', '✨', '💡', '🎉', '✅', '❌', '⚠️', '❓', '❗', '🚀'] },
	{ name: 'objects', emojis: ['📘', '📗', '📙', '📕', '📓', '📝', '📄', '📁', '📂', '📌', '📎', '🔗', '🔒', '🔑', '🛠️', '⚙️', '💻', '📱', '📅', '📊'] },
	{ name: 'nature', emojis: ['🌱', '🌳', '🌍', '☀️', '🌙', '⚡', '🌈', '🐱', '🐶', '🦊', '🐝', '🌸'] },
	{ name: 'food', emojis: ['☕', '🍕', '🍎', '🍰', '🍺', '🍷', '🥗', '🍳'] },
	{ name: 'travel', emojis: ['🏠', '🏢', '🚗', '✈️', '🚲', '🗺️', '🏁', '🎯'] },
];
