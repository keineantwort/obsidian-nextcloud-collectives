import { describe, expect, it } from 'vitest';
import { EMOJI_GROUPS, parseEmoji } from '../../src/mapping/emoji';

describe('parseEmoji', () => {
	it.each(['😀', '❤️', '👍🏽', '👨‍👩‍👧', '🇩🇪', '1️⃣', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '⭐'])('accepts the single emoji %s', (emoji) => {
		expect(parseEmoji(emoji)).toEqual({ emoji, valid: true });
	});

	it('trims, and takes an empty value as no emoji', () => {
		expect(parseEmoji(' 📘 ')).toEqual({ emoji: '📘', valid: true });
		expect(parseEmoji('  ')).toEqual({ emoji: null, valid: true });
	});

	it.each(['a', 'Text', '🚀🚀', '🚀 x', 'x🚀', '12', '#', ':smile:'])('rejects %s', (text) => {
		expect(parseEmoji(text)).toEqual({ emoji: null, valid: false });
	});

	it('offers only valid single emojis in the picker', () => {
		for (const group of EMOJI_GROUPS) for (const emoji of group.emojis) expect(parseEmoji(emoji)).toEqual({ emoji, valid: true });
	});
});
