// Checks that the release files agree on one version (Obsidian/BRAT need tag == manifest.json version, and
// versions.json must map it to a minAppVersion). Usage: node scripts/check-release.mjs [tag]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Returns a list of problems; empty = consistent. `files` = parsed manifest, package and versions objects. */
export function checkRelease({ manifest, pkg, versions }, tag) {
	const problems = [];
	const version = manifest.version;
	if (typeof version !== 'string' || !SEMVER.test(version)) return [`manifest.json: version "${String(version)}" is not x.y.z`];
	if (pkg.version !== version) problems.push(`package.json version ${pkg.version} differs from manifest.json ${version}`);
	if (versions[version] === undefined) problems.push(`versions.json has no entry for ${version}`);
	else if (versions[version] !== manifest.minAppVersion) problems.push(`versions.json maps ${version} to ${versions[version]}, manifest.json minAppVersion is ${manifest.minAppVersion}`);
	if (tag !== undefined && tag !== version) problems.push(`tag "${tag}" differs from manifest.json version ${version} (no "v" prefix)`);
	return problems;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const problems = checkRelease({ manifest: readJson('manifest.json'), pkg: readJson('package.json'), versions: readJson('versions.json') }, process.argv[2]);
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		process.exit(1);
	}
	console.log('Release files are consistent.');
}
