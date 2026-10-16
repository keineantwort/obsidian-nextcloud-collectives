import { describe, expect, it } from 'vitest';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';
import { createTranslator, resolveLocale } from '../../src/i18n';

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholdersOf(text: string): string[] {
	return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').sort();
}

describe('resolveLocale', () => {
	it.each([
		['de', 'de'],
		['de-DE', 'de'],
		['de_AT', 'de'],
		['DE', 'de'],
		['de-CH', 'de'],
	])('maps "%s" to %s', (language, expected) => {
		expect(resolveLocale(language)).toBe(expected);
	});

	it.each([
		['', 'en'],
		['en', 'en'],
		['en-US', 'en'],
		['fr', 'en'],
		['deu', 'en'],
		['dev', 'en'],
	])('maps "%s" to %s (not German)', (language, expected) => {
		expect(resolveLocale(language)).toBe(expected);
	});
});

describe('createTranslator', () => {
	it('returns the English text for a key in en', () => {
		const t = createTranslator('en');

		expect(t('settings.test.button')).toBe('Test connection');
	});

	it('returns the German text for a key in de', () => {
		const t = createTranslator('de');

		expect(t('settings.test.button')).toBe('Verbindung testen');
	});

	it('replaces a placeholder with the given parameter', () => {
		const t = createTranslator('en');

		expect(t('connection.error.server', { status: 503 })).toBe(
			'The server responded with an error (HTTP 503).',
		);
	});

	it('leaves a placeholder visible when no parameter is given', () => {
		const t = createTranslator('en');

		expect(t('connection.error.server')).toContain('{status}');
	});

	it('ignores inherited properties when substituting placeholders', () => {
		const t = createTranslator('en');
		const params = Object.create({ count: 9 }) as Record<string, number>;

		expect(t('connection.success.other', params)).toBe(
			'Connection successful: {count} collectives found.',
		);
	});
});

describe('message tables', () => {
	it('contain exactly the same keys in de and en', () => {
		expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
	});

	it.each(Object.keys(en) as (keyof typeof en)[])('have a non-blank German and English text for %s', (key) => {
		expect(de[key].trim()).not.toBe('');
		expect(en[key].trim()).not.toBe('');
	});

	it.each(Object.keys(en) as (keyof typeof en)[])('use the same placeholders in German and English for %s', (key) => {
		expect(placeholdersOf(de[key])).toEqual(placeholdersOf(en[key]));
	});
});
