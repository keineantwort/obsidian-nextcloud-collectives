import type { Translator } from '../i18n';
import type { ConflictStrategy } from '../sync/decide';

/** Warning under the strategy dropdown; empty for the safe default, where nothing is overwritten without asking. */
export function strategyWarning(strategy: ConflictStrategy, t: Translator): string {
	switch (strategy) {
		case 'conflictFile': return '';
		case 'preferLocal': return t('settings.conflictStrategy.warning.preferLocal');
		case 'preferRemote': return t('settings.conflictStrategy.warning.preferRemote');
	}
}
