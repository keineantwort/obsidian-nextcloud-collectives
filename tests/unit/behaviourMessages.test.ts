import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { strategyWarning } from '../../src/settings/behaviourMessages';

const en = createTranslator('en');
const de = createTranslator('de');

describe('strategyWarning', () => {
	it('shows no warning for the default strategy, which asks instead of overwriting', () => {
		expect(strategyWarning('conflictFile', en)).toBe('');
	});

	it('warns that server changes are overwritten when preferring this vault', () => {
		expect(strategyWarning('preferLocal', en)).toBe(
			'Caution: changes on the server are overwritten without asking if the page was also changed in this vault. Pages that already have a conflict still need your decision.',
		);
	});

	it('warns that vault changes are overwritten when preferring the server', () => {
		expect(strategyWarning('preferRemote', en)).toBe(
			'Caution: your changes in this vault are overwritten without asking if the page was also changed on the server. Pages that already have a conflict still need your decision.',
		);
	});

	it('uses the German warning for a strategy that overwrites', () => {
		expect(strategyWarning('preferRemote', de)).toBe(
			'Achtung: Deine Änderungen in diesem Vault werden ohne Rückfrage überschrieben, wenn die Seite auch auf dem Server geändert wurde. Seiten mit bestehendem Konflikt brauchen weiterhin deine Entscheidung.',
		);
	});
});
