// Checks that the release files agree on one version (Obsidian/BRAT need tag == manifest.json version, and
// versions.json must map it to a minAppVersion) and that CHANGELOG.md describes it (the description of the release,
// scripts/release-notes.mjs). Usage: node scripts/check-release.mjs [tag]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * The section of `version` in CHANGELOG.md without its heading ("## x.y.z …"), up to the next "## ", trimmed; null if
 * there is no such section or it is empty.
 */
export function releaseNotes(changelog, version) {
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((line) => line.startsWith(`## ${version}`) && !/[\w.]/.test(line.charAt(3 + version.length)));
	if (start === -1) return null;
	const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
	const notes = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
	return notes === '' ? null : notes;
}

/** Returns a list of problems; empty = consistent. `files` = parsed manifest, package and versions objects, CHANGELOG.md text. */
export function checkRelease({ manifest, pkg, versions, changelog }, tag) {
	const problems = [];
	const version = manifest.version;
	if (typeof version !== 'string' || !SEMVER.test(version)) return [`manifest.json: version "${String(version)}" is not x.y.z`];
	if (pkg.version !== version) problems.push(`package.json version ${pkg.version} differs from manifest.json ${version}`);
	if (versions[version] === undefined) problems.push(`versions.json has no entry for ${version}`);
	else if (versions[version] !== manifest.minAppVersion) problems.push(`versions.json maps ${version} to ${versions[version]}, manifest.json minAppVersion is ${manifest.minAppVersion}`);
	if (releaseNotes(changelog, version) === null) problems.push(`CHANGELOG.md has no section "## ${version}" with the changes`);
	if (tag !== undefined && tag !== version) problems.push(`tag "${tag}" differs from manifest.json version ${version} (no "v" prefix)`);
	return problems;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const problems = checkRelease({ manifest: readJson('manifest.json'), pkg: readJson('package.json'), versions: readJson('versions.json'), changelog: readFileSync('CHANGELOG.md', 'utf8') }, process.argv[2]);
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		process.exit(1);
	}
	console.log('Release files are consistent.');
}
