# Release

A release is a Git tag `x.y.z` (without `v`) that exactly matches the `version` in `manifest.json` (ADR 0023).

## Procedure

1. Raise the version in `manifest.json` and `package.json`, add `"<version>": "<minAppVersion>"` to `versions.json`, and add a section `## <version> – <date>` with the changes users notice to `CHANGELOG.md` (it becomes the description of the release on Forgejo and GitHub, `scripts/release-notes.mjs`). `npm run release:check` verifies that everything fits together.
2. Pull request to `main`; CI (`.forgejo/workflows/ci.yml`) builds, lints and tests.
3. **After** the merge, set the tag on the current `main` and push it: `git checkout main && git pull --ff-only origin main && git tag 0.2.0 && git push origin 0.2.0`. `release.yml` stops a tag that is not on `main` (set before the merge on the branch) and a tag on an older `main` whose `manifest.json` has another version; delete such a tag with `git push origin :refs/tags/0.2.0 && git tag -d 0.2.0` and set it again. If a release was created anyway, delete it on Forgejo together with the tag, otherwise the next run finds the old release (HTTP 409).
4. `.forgejo/workflows/release.yml` checks the tag, builds and creates a Forgejo release with `main.js`, `manifest.json` and `styles.css`, plus the same release on GitHub ([keineantwort/obsidian-nextcloud-collectives](https://github.com/keineantwort/obsidian-nextcloud-collectives/releases)). BRAT and the community directory read only GitHub. The directory checks for new releases periodically and reviews each one automatically; to check at once, open the entry on [community.obsidian.md](https://community.obsidian.md) and choose "…" › "Check for new releases". Prerequisite: Actions secret `RELEASE_TOKEN` (Forgejo token with write access to releases); for GitHub the variable `MIRROR_GITHUB_REPO` and the secret `MIRROR_GITHUB_TOKEN`.
   The release files carry no GitHub artifact attestations: they need an OIDC token of GitHub Actions, which a build on Forgejo cannot get ([ADR 0030](adr/0030-no-github-artifact-attestations.md)).
5. Before a release for others: run the checklist `docs/manual-test.md` on iOS and Android.

## Integration tests across several Nextcloud versions

Each job starts a fresh test server of the respective version (ADR 0024). Runner requirements: [ci-runner.md](ci-runner.md).

| Workflow | What | Versions | When |
|---|---|---|---|
| `integration.yml` | `npm run test:int` | the newest from `TESTED_NEXTCLOUD_MAJORS` (currently 35) and `latest` | every pull request and every push to `main` (each skips its steps if neither source code, tests, test server scripts, dependencies nor the test workflows are affected, `scripts/ci/affects-tests.sh`), "Run workflow" |
| `nightly.yml` | `npm run test:int` | the two before it (currently 33, 34) | nightly on `main` if a merge since the night before affected the tests (not for documentation only, `scripts/ci/affects-tests.sh`); the night from Wednesday to Thursday always; "Run workflow" |
| `nightly.yml` | `npm run test:perf` (500 pages) | all from `TESTED_NEXTCLOUD_MAJORS` and `latest` | as above |

A release tag does not start integration tests: the tagged state on `main` passed them at the pull request and at the merge. Before a release it is worth looking at the latest run of `nightly.yml`; when in doubt, use "Run workflow" there. The `latest` jobs may be red; they do not block a merge. As long as `nextcloud:apache` is the same image as the current version, they skip their steps (`scripts/dev-nextcloud/latest-is-current.sh`).

**Merging only with green checks**: the branch protection rule for `main` (Repository › Settings › Branches) has "Enable status check" switched on with these required checks:

```
CI / build-and-test (pull_request)
Integration (Nextcloud versions) / Nextcloud 35 (pull_request)
```

Not required: the `latest` job (may be red) and `CI / mirror-github` (runs only after the merge and stays "pending" on a pull request). Because the check is required, `integration.yml` has no paths filter; it reports on every pull request.

- The Nextcloud and app versions (Collectives, Circles, Text) appear in the "Versions under test" step and in the job summary.
- New major version: if the `latest` run shows a new Nextcloud version as green, add the number to `TESTED_NEXTCLOUD_MAJORS` (`src/api/versionCheck.ts`) **and** to the matrices: in `integration.yml` the new version replaces the previous one; the previous one moves to the `integration` job of `nightly.yml` (the oldest drops out there if it is no longer tested), and to the `performance` job of `nightly.yml`. Otherwise `tests/unit/testedVersions.test.ts` fails. Then replace the required check `Nextcloud <old>` with `Nextcloud <new>` in the branch protection rule, or no pull request can be merged.
- Locally against a second version: `NC_VERSION=35 NC_PORT=8135 docker compose -p nc-test-35 up -d --wait` in the folder `scripts/dev-nextcloud`, then `NC_PORT=8135 NC_VERSION=35 npm run test:int` (performance: `npm run test:perf`); `sh scripts/dev-nextcloud/versions.sh nc-test-35` shows the versions.

## Outside the repo (for the maintainer to do)

These items from ONC-11 cannot be done through code in the repo (completed ones stay checked off for tracking):

- [x] **Create the GitHub repository** (description and MIT license see below) and enable mirroring: in Forgejo under Repository › Settings › Actions › Variables create `MIRROR_GITHUB_REPO` (`owner/name`) and under Secrets `MIRROR_GITHUB_TOKEN` (GitHub token, fine-grained, only this repo, permission "Contents: Read and write"). After that `ci.yml` pushes every successful build on `main` to GitHub (without `--force`), and `release.yml` creates the GitHub release with the three files on a tag. Codeberg is dropped (no code that was predominantly created with AI).
- [x] **BRAT**: works since 0.2.0 (first GitHub release): in BRAT "Add beta plugin" with `keineantwort/obsidian-nextcloud-collectives`. User instructions: README › Installation.
- [x] **Publication in the Obsidian community directory** (ONC-31): listed since 0.3.2 at [community.obsidian.md/plugins/nextcloud-collectives](https://community.obsidian.md/plugins/nextcloud-collectives). Submissions no longer go through a pull request against `obsidianmd/obsidian-releases` (pull requests are disabled there) but through [community.obsidian.md](https://community.obsidian.md): sign in with the Obsidian account, connect the GitHub account, add the repository, agree to the [developer policies](https://docs.obsidian.md/Developer+policies). The directory mirrors its entries about every hour into `community-plugins.json` of `obsidianmd/obsidian-releases`, which the search in the app reads. The README must keep the disclosures the policies require (section "Network use and privacy").
- [x] **Screenshots** (settings, conflict dialog, deletion prompt, file list with emoji, log) for the README, the Obsidian detail page and the community page; without real server names or credentials (ONC-32). In `docs/images/en/` and `docs/images/de/`, taken against the Docker test server; to retake them after UI changes see [scripts/screenshots/README.md](../scripts/screenshots/README.md). The community page takes them over once it is published (ONC-31).
- [ ] **Listing in the community directory**: icon, long description, categories and screenshots (from `docs/images/en/`) under "Edit listing" on the entry's management page at [community.obsidian.md](https://community.obsidian.md); the public page is [community.obsidian.md/plugins/nextcloud-collectives](https://community.obsidian.md/plugins/nextcloud-collectives).

## GitHub repository

- **Description** ("About" field, at most 350 characters): *Obsidian plugin that syncs all Nextcloud Collectives of a server with your vault in both directions – pages, hierarchy, tags, emoji, links and attachments. Conflicts become copies instead of overwrites. Works on desktop and mobile.*
- **Topics**: `obsidian-plugin`, `obsidian-md`, `nextcloud`, `nextcloud-collectives`, `sync`, `markdown`, `webdav`
- **License**: MIT (the `LICENSE` file is in the repo; when creating the repository, add no template and no README/`.gitignore`, so that the first push works without a conflict)
- **Visibility**: public (for BRAT and the store); default branch `main`
- Optionally turn off issues there if feedback should keep going through Forgejo.
