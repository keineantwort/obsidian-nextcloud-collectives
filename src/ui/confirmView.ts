// Texts and answers of the confirmation dialog (architecture §7.4). No 'obsidian' import: the modal only renders what is built here.
import type { Translator } from '../i18n';
import type { Decision, Proposal } from '../sync/types';

export interface ConfirmRow {
	id: string;
	kind: Proposal['kind'];
	/** What happens if the box is checked. */
	label: string;
	/** Further short lines: where and how much. Explanations live in the README, not in the dialog. */
	details: string[];
	/** Warning for a mass deletion (architecture §14), or null. */
	warning: string | null;
}

const KIND_ORDER: Record<Proposal['kind'], number> = { deleteCollective: 0, deletePage: 1, removeCollectiveLocal: 2, newCollective: 3 };

/** Why the dialog asks: the user deleted something in the vault, the server deleted something, the vault has something new. */
export type ConfirmGroupKind = 'localDeleted' | 'remoteDeleted' | 'localNew';

const GROUP_OF: Record<Proposal['kind'], ConfirmGroupKind> = {
	deleteCollective: 'localDeleted',
	deletePage: 'localDeleted',
	removeCollectiveLocal: 'remoteDeleted',
	newCollective: 'localNew',
};

const GROUP_ORDER: readonly ConfirmGroupKind[] = ['localDeleted', 'remoteDeleted', 'localNew'];

export interface ConfirmGroup {
	kind: ConfirmGroupKind;
	heading: string;
	rows: ConfirmRow[];
}

/** The rows grouped by cause, in a fixed order; empty groups are left out. */
export function buildConfirmGroups(proposals: readonly Proposal[], t: Translator): ConfirmGroup[] {
	const rows = buildConfirmRows(proposals, t);
	return GROUP_ORDER.map((kind) => ({ kind, heading: t(`confirm.group.${kind}`), rows: rows.filter((row) => GROUP_OF[row.kind] === kind) }))
		.filter((group) => group.rows.length > 0);
}

/** One row per question: mass deletions first within the page deletions, collective questions before page questions. */
export function buildConfirmRows(proposals: readonly Proposal[], t: Translator): ConfirmRow[] {
	const rows = proposals.map((proposal) => ({ proposal, row: toRow(proposal, t) }));
	rows.sort((a, b) => KIND_ORDER[a.proposal.kind] - KIND_ORDER[b.proposal.kind] || Number(b.row.warning !== null) - Number(a.row.warning !== null));
	return rows.map((entry) => entry.row);
}

function toRow(proposal: Proposal, t: Translator): ConfirmRow {
	switch (proposal.kind) {
		case 'deletePage': {
			const details = [proposal.path];
			if (proposal.descendants > 0) details.push(t('confirm.deletePage.descendants', { count: proposal.descendants }));
			const warning = proposal.mass === null
				? null
				: t('confirm.mass.warning', { name: proposal.mass.collectiveName, deleted: proposal.mass.deleted, total: proposal.mass.total });
			return { id: proposal.id, kind: proposal.kind, label: t('confirm.deletePage.label', { title: proposal.title }), details, warning };
		}
		case 'deleteCollective':
			return {
				id: proposal.id,
				kind: proposal.kind,
				label: t('confirm.deleteCollective.label', { name: proposal.name }),
				details: [t('confirm.deleteCollective.detail', { count: proposal.pages })],
				warning: null,
			};
		case 'removeCollectiveLocal':
			return {
				id: proposal.id,
				kind: proposal.kind,
				label: t('confirm.removeCollectiveLocal.label', { name: proposal.name }),
				details: proposal.notes > 0 ? [t('confirm.removeCollectiveLocal.detail', { count: proposal.notes })] : [],
				warning: null,
			};
		case 'newCollective':
			return {
				id: proposal.id,
				kind: proposal.kind,
				label: t('confirm.newCollective.label', { name: proposal.folder }),
				details: [t('confirm.newCollective.detail', { count: proposal.files })],
				warning: null,
			};
	}
}

/** Checked rows are accepted, unchecked rows are refused. */
export function decisionsFor(rows: readonly ConfirmRow[], checked: ReadonlySet<string>): Map<string, Decision> {
	return new Map(rows.map((row): [string, Decision] => [row.id, checked.has(row.id) ? 'accept' : 'reject']));
}

/** Closing the dialog decides nothing: every question is asked again in the next run. */
export function laterDecisions(rows: readonly ConfirmRow[]): Map<string, Decision> {
	return new Map(rows.map((row): [string, Decision] => [row.id, 'defer']));
}
