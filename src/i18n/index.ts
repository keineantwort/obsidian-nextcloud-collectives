import { de } from './de';
import { en, type MessageKey } from './en';

export type Locale = 'de' | 'en';
export type { MessageKey } from './en';
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Matches 'de', 'de-DE', 'de_AT' and similar German language tags (case-insensitive). */
const GERMAN_LANGUAGE = /^de(?:[-_]|$)/i;

/** Maps an Obsidian language code (getLanguage()) to a supported locale: 'de', 'de-DE', 'de_AT' (case-insensitive) → 'de'; anything else, including '', → 'en'. */
export function resolveLocale(language: string): Locale {
	return GERMAN_LANGUAGE.test(language) ? 'de' : 'en';
}

const TABLES: Record<Locale, Record<MessageKey, string>> = { de, en };

/** Returns a translator for the locale. `{name}` placeholders are replaced from params; a placeholder without a matching param is left unchanged (visible, not silently dropped). */
export function createTranslator(locale: Locale): Translator {
	const table = TABLES[locale];
	return (key, params) => table[key].replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
		// hasOwnProperty check: a plain `in` would also match prototype keys such as "constructor".
		if (params && Object.prototype.hasOwnProperty.call(params, name)) return String(params[name]);
		return placeholder;
	});
}
