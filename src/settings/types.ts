import { DEFAULT_ATTACHMENT_PATTERN, DEFAULT_MAX_ATTACHMENT_MB } from '../mapping/attachments';
import type { ConflictStrategy } from '../sync/decide';
import type { PlannerBehaviour } from '../sync/plannerTypes';

export interface NcSettings {
	/** Server base URL as entered by the user (normalized on use). */
	serverUrl: string;
	username: string;
	/** ID of the secret in Obsidian's secret storage holding the app password. Never the password itself. */
	appPasswordSecretId: string;
	/** What happens when a page changed both in the vault and on the server (PLAN §7.3). */
	conflictStrategy: ConflictStrategy;
	/** What a new top-level folder becomes (PLAN §7.4). */
	newFolderBehaviour: PlannerBehaviour['newFolder'];
	/** Whether a local deletion needs a confirmation before it reaches the server (PLAN §7.4). */
	localDeleteBehaviour: PlannerBehaviour['localDelete'];
	/** What happens to the local file of a page deleted on the server (PLAN §7.4). */
	remoteDeleteBehaviour: PlannerBehaviour['remoteDelete'];
	/** Show the page emoji in front of note titles (display only). */
	showEmojiInTitles: boolean;
	/** Hide the nc_* properties in the properties view of a note (display only). */
	hidePluginProperties: boolean;
	/** Folder for the attachments of a note, relative to the note's folder; `{title}` = the note's name (PLAN §9.4). */
	attachmentFolderPattern: string;
	/** Largest attachment that is transferred, in MB (PLAN §9.4). */
	maxAttachmentSizeMb: number;
	/** Delete the server file of an attachment deleted in the vault and no longer used (PLAN §9.4). */
	deleteRemoteAttachments: boolean;
	/** Show the note of a folder first in its folder in the file list (display only). */
	folderNoteFirst: boolean;
}

export const DEFAULT_SETTINGS: NcSettings = {
	serverUrl: '',
	username: '',
	appPasswordSecretId: '',
	conflictStrategy: 'conflictFile',
	newFolderBehaviour: 'createCollective',
	localDeleteBehaviour: 'ask',
	remoteDeleteBehaviour: 'obsidianTrash',
	showEmojiInTitles: true,
	hidePluginProperties: true,
	attachmentFolderPattern: DEFAULT_ATTACHMENT_PATTERN,
	maxAttachmentSizeMb: DEFAULT_MAX_ATTACHMENT_MB,
	deleteRemoteAttachments: true,
	folderNoteFirst: true,
};

/** A pattern is usable if it is a relative path of plain folder names (with `{title}`) that cannot leave the note's folder. */
export function isAttachmentFolderPattern(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	const pattern = v.trim().replace(/^\/+|\/+$/g, '');
	if (pattern === '' || /[*"\\<>:|?#^[\]]/.test(pattern.replace(/\{title\}/g, ''))) return false;
	return pattern.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}

/** A size limit in MB: a whole number from 1 to 1000. */
export function isMaxAttachmentSizeMb(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000;
}

export const CONFLICT_STRATEGIES = ['conflictFile', 'preferLocal', 'preferRemote'] as const;
export const NEW_FOLDER_BEHAVIOURS = ['createCollective', 'ask', 'ignore'] as const;
export const LOCAL_DELETE_BEHAVIOURS = ['ask', 'trashRemote'] as const;
export const REMOTE_DELETE_BEHAVIOURS = ['obsidianTrash', 'keepUnlinked'] as const;

function isOneOf<T extends string>(values: readonly T[], v: unknown): v is T {
	return typeof v === 'string' && (values as readonly string[]).includes(v);
}

/** True for the three strategy values; anything else (e.g. a hand-edited data.json) is rejected. */
export function isConflictStrategy(v: unknown): v is ConflictStrategy {
	return isOneOf(CONFLICT_STRATEGIES, v);
}

export function isNewFolderBehaviour(v: unknown): v is NcSettings['newFolderBehaviour'] {
	return isOneOf(NEW_FOLDER_BEHAVIOURS, v);
}

export function isLocalDeleteBehaviour(v: unknown): v is NcSettings['localDeleteBehaviour'] {
	return isOneOf(LOCAL_DELETE_BEHAVIOURS, v);
}

export function isRemoteDeleteBehaviour(v: unknown): v is NcSettings['remoteDeleteBehaviour'] {
	return isOneOf(REMOTE_DELETE_BEHAVIOURS, v);
}
