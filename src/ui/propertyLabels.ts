// Readable names for the plugin's properties in Obsidian's properties view (display only, the keys stay technical):
// the input with the key is hidden and a label in the language of the UI is shown instead. Pure DOM helpers; the wiring to
// Obsidian's events is in main.ts.
import type { Translator } from '../i18n';

const PROPERTIES = ['nc_page_id', 'nc_collective_id', 'nc_emoji', 'nc_tags', 'nc_title'] as const;

export const LABEL_CLASS = 'nc-property-label';
export const LABELLED_CLASS = 'nc-property-labelled';

/** The label of each plugin property in the language of `t`. */
export function propertyLabels(t: Translator): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const property of PROPERTIES) labels[property] = t(`property.${property}`);
	return labels;
}

/** Shows `labels[key]` in place of the key of every plugin property below `root` (the properties of a note). */
export function decorateProperties(root: ParentNode, labels: Readonly<Record<string, string>>): void {
	for (const row of Array.from(root.querySelectorAll('.metadata-property[data-property-key]'))) {
		const key = row.getAttribute('data-property-key') ?? '';
		const label = labels[key];
		const keyEl = row.querySelector('.metadata-property-key');
		if (label === undefined || keyEl === null) continue;
		let span = keyEl.querySelector(`.${LABEL_CLASS}`);
		if (span === null) {
			span = keyEl.createSpan({ cls: LABEL_CLASS });
		}
		if (span.textContent !== label) span.textContent = label;
		row.classList.add(LABELLED_CLASS);
	}
}

/** Removes the labels again and shows the keys. */
export function clearProperties(root: ParentNode): void {
	for (const span of Array.from(root.querySelectorAll(`.${LABEL_CLASS}`))) span.remove();
	for (const row of Array.from(root.querySelectorAll(`.${LABELLED_CLASS}`))) row.classList.remove(LABELLED_CLASS);
}
