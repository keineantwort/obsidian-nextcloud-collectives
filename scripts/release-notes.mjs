// Prints the JSON body for creating the release of a tag through the Forgejo or GitHub API (both take the same fields):
// tag, name and, as description, the section of the version in CHANGELOG.md; with a commit, also `target_commitish`, so
// that creating the release sets the tag on that commit. Used by .forgejo/workflows/release.yml after check-release.mjs
// has made sure that the section exists. Usage: node scripts/release-notes.mjs <tag> [commit]
import { readFileSync } from 'node:fs';
import { releaseNotes } from './check-release.mjs';

const [, , tag, commit] = process.argv;
if (tag === undefined) {
	console.error('Usage: node scripts/release-notes.mjs <tag> [commit]');
	process.exit(1);
}
const body = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), tag);
if (body === null) {
	console.error(`CHANGELOG.md has no section "## ${tag}"`);
	process.exit(1);
}
console.log(JSON.stringify({ tag_name: tag, name: tag, body, ...(commit === undefined ? {} : { target_commitish: commit }) }));
