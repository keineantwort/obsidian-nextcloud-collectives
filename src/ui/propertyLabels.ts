// Readable names for the plugin's properties in Obsidian's properties view (display only, the keys stay technical).
// The labels are set as CSS custom properties on the body; styles.css shows them in place of the key input.
import type { Translator } from '../i18n';

const PROPERTIES = ['nc_page_id', 'nc_collective_id', 'nc_emoji', 'nc_tags', 'nc_title'] as const;

const cssName = (property: string): string => `--nc-label-${property.replace(/_/g, '-')}`;

/** A CSS string literal for `text` (`content: var(--nc-label-…)`). */
export function cssString(text: string): string {
	return `"${text.replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ')}"`;
}

/** Sets the labels in the language of `t` on `body`. Returns a function that removes them again. */
export function applyPropertyLabels(body: { setCssProps(props: Record<string, string>): void; style: { removeProperty(name: string): string } }, t: Translator): () => void {
	const props: Record<string, string> = {};
	for (const property of PROPERTIES) props[cssName(property)] = cssString(t(`property.${property}`));
	body.setCssProps(props);
	return () => {
		for (const name of Object.keys(props)) body.style.removeProperty(name);
	};
}
