// Renaming a page in the vault (architecture §7.4, ADR 0004/0018): the note of a page with sub-pages and its folder carry the same
// name and are renamed together. Pure: no Obsidian, no network.
import { pathKey, sanitizeName } from './paths';

export interface RenameStep {
	from: string;
	to: string;
}

export type RenamePlan =
	| { ok: true; steps: RenameStep[]; name: string; folderPage: boolean }
	/** empty: no usable name; unchanged: same name; exists: a file or folder of that name is there; landing: the start page of a collective. */
	| { ok: false; reason: 'empty' | 'unchanged' | 'exists' | 'landing' };

/** Name of a note without folder and `.md`. */
export function noteStem(path: string): string {
	const file = path.slice(path.lastIndexOf('/') + 1);
	return file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
}

/** True for `Folder/Name/Name.md` (below a collective folder): the note of a page that has sub-pages. */
export function isFolderPageNote(path: string): boolean {
	const segments = path.split('/');
	return segments.length >= 3 && pathKey(segments[segments.length - 2] ?? '') === pathKey(noteStem(path));
}

/** True for `Collective/Collective.md`: its name is the collective's, which only an admin changes (by renaming the folder). */
export function isLandingNote(path: string): boolean {
	const segments = path.split('/');
	return segments.length === 2 && pathKey(segments[0] ?? '') === pathKey(noteStem(path));
}

/**
 * Steps that rename the page whose note is `notePath` to `newName`: the note alone for a page without sub-pages, the note and
 * then its folder for a page with sub-pages. `exists` answers for any path in the vault (files and folders).
 */
export function planPageRename(notePath: string, newName: string, exists: (path: string) => boolean): RenamePlan {
	if (isLandingNote(notePath)) return { ok: false, reason: 'landing' };
	const typed = newName.trim();
	const name = sanitizeName(typed.endsWith('.md') ? typed.slice(0, -'.md'.length) : typed);
	if (typed === '' || name.trim() === '') return { ok: false, reason: 'empty' };
	if (pathKey(name) === pathKey(noteStem(notePath))) return { ok: false, reason: 'unchanged' };
	const segments = notePath.split('/');
	if (isFolderPageNote(notePath)) {
		const folder = segments.slice(0, -1).join('/');
		const parent = segments.slice(0, -2).join('/');
		const newFolder = `${parent}/${name}`;
		if (exists(newFolder) || exists(`${newFolder}.md`)) return { ok: false, reason: 'exists' };
		return { ok: true, name, folderPage: true, steps: [{ from: notePath, to: `${folder}/${name}.md` }, { from: folder, to: newFolder }] };
	}
	const to = `${segments.slice(0, -1).join('/')}/${name}.md`;
	if (exists(to) || exists(to.slice(0, -'.md'.length))) return { ok: false, reason: 'exists' };
	return { ok: true, name, folderPage: false, steps: [{ from: notePath, to }] };
}
