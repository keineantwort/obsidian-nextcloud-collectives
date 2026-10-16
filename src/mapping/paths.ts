import type { CollectiveId, PageId, PageInfo } from '../api/types';

/** Remote file name of a folder page (its folder note); every other page is a leaf file. */
const FOLDER_NOTE = 'Readme.md';

/** Characters that are not allowed in local file or folder names, plus the Obsidian/Windows-hostile ones. */
export const FORBIDDEN_CHARS: RegExp = /[*"\\/<>:|?#^[\]]/g;

/**
 * Makes a page or collective title usable as a file or folder name. Each forbidden character becomes `replacement`,
 * a leading '.' too (hidden names are excluded from sync). Whitespace is trimmed; an empty result becomes `replacement`.
 */
export function sanitizeName(name: string, replacement = '_'): string {
	let out = name.trim().replace(FORBIDDEN_CHARS, () => replacement);
	if (out.startsWith('.')) out = replacement + out.slice(1);
	return out === '' ? replacement : out;
}

/** Case- and Unicode-insensitive key for collision checks: name.normalize('NFC').toLowerCase(). */
export function pathKey(path: string): string {
	return path.normalize('NFC').toLowerCase();
}

/** Returns `base` if it is free, else the first `${base} (n)` (n >= 2) whose key is free. Does not mutate `taken`. */
export function withSuffix(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(pathKey(base))) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base} (${n})`;
		if (!taken.has(pathKey(candidate))) return candidate;
	}
}

export interface CollectiveTree {
	collectiveId: CollectiveId;
	name: string;
	pages: PageInfo[];
}

export interface LocalTarget {
	pageId: PageId;
	collectiveId: CollectiveId;
	/** Vault path of the Markdown file, e.g. 'Handbuch/Prozesse/Prozesse.md'. */
	path: string;
	/** Original title if it differs from the file base name (→ frontmatter nc_title), else null. Landing page: always null. */
	ncTitle: string | null;
}

export interface PathPlan {
	/** Collective id → vault folder (top level). */
	collectiveFolders: Map<CollectiveId, string>;
	targets: Map<PageId, LocalTarget>;
	/** Pages whose parent is missing in the list (orphans); they get no target. */
	orphans: PageId[];
}

/** Names already used in one container, keyed by pathKey. Files and folders have separate namespaces. */
interface Container {
	folder: string;
	/** File stems (without '.md') directly in `folder`. */
	fileNames: Set<string>;
	/** Sub-folder names directly in `folder`. */
	folderNames: Set<string>;
}

interface Walk {
	collectiveId: CollectiveId;
	children: Map<number, PageInfo[]>;
	reached: Set<number>;
	plan: PathPlan;
}

/**
 * Derives ideal local paths from the remote structure (PLAN §6.1, ADR 0004). Pure, deterministic.
 * `knownFolders`: collective id → folder already used locally (from state); kept unchanged and reserved first.
 */
export function planLocalPaths(trees: CollectiveTree[], knownFolders: ReadonlyMap<CollectiveId, string>): PathPlan {
	const plan: PathPlan = { collectiveFolders: new Map(), targets: new Map(), orphans: [] };
	const takenFolders = new Set<string>();
	for (const folder of knownFolders.values()) takenFolders.add(pathKey(folder));
	for (const tree of [...trees].sort((a, b) => Number(a.collectiveId) - Number(b.collectiveId))) {
		const folder = knownFolders.get(tree.collectiveId) ?? claim(takenFolders, sanitizeName(tree.name)).name;
		plan.collectiveFolders.set(tree.collectiveId, folder);
		planTree(tree, folder, plan);
	}
	return plan;
}

function planTree(tree: CollectiveTree, folder: string, plan: PathPlan): void {
	const pages = [...tree.pages].sort((a, b) => Number(a.id) - Number(b.id));
	const children = new Map<number, PageInfo[]>();
	for (const page of pages) {
		if (page.parentId === 0) continue;
		children.set(page.parentId, [...(children.get(page.parentId) ?? []), page]);
	}
	const walk: Walk = { collectiveId: tree.collectiveId, children, reached: new Set(), plan };
	// Only the lowest-id page without parent is the start page; further ones stay unreached and become orphans.
	const start = pages.find((page) => page.parentId === 0);
	if (start) {
		walk.reached.add(start.id);
		plan.targets.set(start.id, { pageId: start.id, collectiveId: tree.collectiveId, path: `${folder}/${folder}.md`, ncTitle: null });
		placeChildren(start.id, { folder, fileNames: new Set([pathKey(folder)]), folderNames: new Set() }, walk);
	}
	for (const page of pages) {
		if (!walk.reached.has(page.id)) plan.orphans.push(page.id);
	}
}

function placeChildren(parentId: number, container: Container, walk: Walk): void {
	for (const page of walk.children.get(parentId) ?? []) {
		walk.reached.add(page.id);
		const base = sanitizeName(page.title);
		if (page.fileName === FOLDER_NOTE) {
			const { name, suffixed } = claim(container.folderNames, base);
			const ownFolder = `${container.folder}/${name}`;
			addTarget(walk, page, `${ownFolder}/${name}.md`, base, suffixed);
			placeChildren(page.id, { folder: ownFolder, fileNames: new Set([pathKey(name)]), folderNames: new Set() }, walk);
		} else {
			const { name, suffixed } = claim(container.fileNames, base);
			addTarget(walk, page, `${container.folder}/${name}.md`, base, suffixed);
		}
	}
}

function addTarget(walk: Walk, page: PageInfo, path: string, base: string, suffixed: boolean): void {
	// A collision suffix makes the original title necessary to restore the page name.
	const ncTitle = suffixed || page.title !== base ? page.title : null;
	walk.plan.targets.set(page.id, { pageId: page.id, collectiveId: walk.collectiveId, path, ncTitle });
}

/** Reserves the first free name for `base` in `taken` and reports whether a suffix was needed. */
function claim(taken: Set<string>, base: string): { name: string; suffixed: boolean } {
	const name = withSuffix(base, taken);
	taken.add(pathKey(name));
	return { name, suffixed: name !== base };
}

/**
 * Sync scope (PLAN §6.1): false for files directly in the vault root, paths below configDir, any segment starting with '.',
 * conflict files (isConflictFileName), and non-'.md' files.
 */
export function isSyncedPath(path: string, configDir: string): boolean {
	if (!path.endsWith('.md')) return false;
	if (!path.includes('/')) return false;
	if (path === configDir || path.startsWith(configDir + '/')) return false;
	if (path.split('/').some((segment) => segment.startsWith('.'))) return false;
	return !isConflictFileName(path);
}

const CONFLICT_NAME = / \((?:Konflikt|Conflict) \d{4}-\d{2}-\d{2} \d{4}\)(?: \(\d+\))?\.md$/;

/** True for '... (Konflikt 2026-10-16 1430).md' and '... (Conflict 2026-10-16 1430).md'. */
export function isConflictFileName(path: string): boolean {
	return CONFLICT_NAME.test(path);
}

/**
 * Builds a conflict file path next to `path`: 'A/B.md' + label 'Konflikt' + date → 'A/B (Konflikt 2026-10-16 1430).md'
 * (local time, HHmm). If taken (pathKey in `taken`), appends ' (2)' etc. before '.md'.
 */
export function conflictPath(path: string, label: string, date: Date, taken: ReadonlySet<string>): string {
	const slash = path.lastIndexOf('/');
	const dir = path.slice(0, slash + 1);
	const file = path.slice(slash + 1);
	const stem = file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
	const base = `${dir}${stem} (${label} ${formatDate(date)})`;
	let candidate = `${base}.md`;
	for (let n = 2; taken.has(pathKey(candidate)); n++) candidate = `${base} (${n}).md`;
	return candidate;
}

function formatDate(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return `${day} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** User-relative WebDAV path of a page's Markdown file: collectivePath/filePath/fileName. Only for PageInfo, never TrashedPage (no collectivePath there). */
export function remotePagePath(page: Pick<PageInfo, 'collectivePath' | 'filePath' | 'fileName'>): string {
	return page.collectivePath + '/' + (page.filePath ? page.filePath + '/' : '') + page.fileName;
}
