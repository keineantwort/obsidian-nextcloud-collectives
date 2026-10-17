import type { TagsProperty } from '../mapping/tags';
import { TAGS_PROPERTIES } from '../mapping/tags';
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
	/** Frontmatter key that carries the tags: Obsidian's `tags` (default, with the #tags of the text) or the plugin's `nc_tags` (PLAN §6.2, §7.5). */
	tagsProperty: TagsProperty;
	/** Show the page emoji in front of note titles (display only). */
	showEmojiInTitles: boolean;
	/** Hide the nc_* properties in the properties view of a note (display only). */
	hidePluginProperties: boolean;
}

export const DEFAULT_SETTINGS: NcSettings = {
	serverUrl: '',
	username: '',
	appPasswordSecretId: '',
	conflictStrategy: 'conflictFile',
	newFolderBehaviour: 'createCollective',
	localDeleteBehaviour: 'ask',
	remoteDeleteBehaviour: 'obsidianTrash',
	tagsProperty: 'tags',
	showEmojiInTitles: true,
	hidePluginProperties: true,
};

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

export function isTagsProperty(v: unknown): v is TagsProperty {
	return isOneOf(TAGS_PROPERTIES, v);
}
