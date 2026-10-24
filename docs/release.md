# Release

A release is a Git tag `x.y.z` (without `v`) that exactly matches the `version` in `manifest.json` (ADR 0023).

## Procedure

1. Raise the version in `manifest.json` and `package.json`, add `"<version>": "<minAppVersion>"` to `versions.json`. `npm run release:check` verifies that everything fits together.
2. Pull request to `main`; CI (`.forgejo/workflows/ci.yml`) builds, lints and tests.
3. Set the tag on `main` and push it: `git tag 0.2.0 && git push origin 0.2.0`.
4. `.forgejo/workflows/release.yml` checks the tag, builds and creates a Forgejo release with `main.js`, `manifest.json` and `styles.css`, plus the same release on GitHub ([keineantwort/obsidian-nextcloud-collectives](https://github.com/keineantwort/obsidian-nextcloud-collectives/releases)). BRAT and, later, the store read only GitHub. Prerequisite: Actions secret `RELEASE_TOKEN` (Forgejo token with write access to releases); for GitHub the variable `MIRROR_GITHUB_REPO` and the secret `MIRROR_GITHUB_TOKEN`.
5. Before a release for others: run the checklist `docs/manual-test.md` on iOS and Android.

## Integration tests across several Nextcloud versions

Each job starts a fresh test server of the respective version (ADR 0024). Runner requirements: [ci-runner.md](ci-runner.md).

| Workflow | What | Versions | When |
|---|---|---|---|
| `integration.yml` | `npm run test:int` | the newest from `TESTED_NEXTCLOUD_MAJORS` (currently 35) and `latest` | every pull request (if source code, tests or test server scripts are affected), every push to `main`, "Run workflow" |
| `nightly.yml` | `npm run test:int` | the two before it (currently 33, 34) | nightly on `main` if there was a merge since the night before; the night from Wednesday to Thursday always; "Run workflow" |
| `nightly.yml` | `npm run test:perf` (500 pages) | all from `TESTED_NEXTCLOUD_MAJORS` and `latest` | as above |

A release tag does not start integration tests: the tagged state on `main` passed them at the pull request and at the merge. Before a release it is worth looking at the latest run of `nightly.yml`; when in doubt, use "Run workflow" there. The `latest` jobs may be red; they do not block a merge. As long as `nextcloud:apache` is the same image as the current version, they skip their steps (`scripts/dev-nextcloud/latest-is-current.sh`).

- The Nextcloud and app versions (Collectives, Circles, Text) appear in the "Versions under test" step and in the job summary.
- New major version: if the `latest` run shows a new Nextcloud version as green, add the number to `TESTED_NEXTCLOUD_MAJORS` (`src/api/versionCheck.ts`) **and** to the matrices: in `integration.yml` the new version replaces the previous one; the previous one moves to the `integration` job of `nightly.yml` (the oldest drops out there if it is no longer tested), and to the `performance` job of `nightly.yml`. Otherwise `tests/unit/testedVersions.test.ts` fails.
- Locally against a second version: `NC_VERSION=35 NC_PORT=8135 docker compose -p nc-test-35 up -d --wait` in the folder `scripts/dev-nextcloud`, then `NC_PORT=8135 NC_VERSION=35 npm run test:int` (performance: `npm run test:perf`); `sh scripts/dev-nextcloud/versions.sh nc-test-35` shows the versions.

## Outside the repo (for the maintainer to do)

These items from ONC-11 cannot be done through code in the repo (completed ones stay checked off for tracking):

- [x] **Create the GitHub repository** (description and MIT license see below) and enable mirroring: in Forgejo under Repository › Settings › Actions › Variables create `MIRROR_GITHUB_REPO` (`owner/name`) and under Secrets `MIRROR_GITHUB_TOKEN` (GitHub token, fine-grained, only this repo, permission "Contents: Read and write"). After that `ci.yml` pushes every successful build on `main` to GitHub (without `--force`), and `release.yml` creates the GitHub release with the three files on a tag. Codeberg is dropped (no code that was predominantly created with AI).
- [x] **BRAT**: works since 0.2.0 (first GitHub release): in BRAT "Add beta plugin" with `keineantwort/obsidian-nextcloud-collectives`. User instructions: README › Installation.
- [ ] **Publication in the Obsidian store**: pull request against `obsidianmd/obsidian-releases` (`community-plugins.json`); for this the repository must be public on GitHub and contain a `README.md`, a `LICENSE` and a release with the three files. Decide on store publication first (ONC-31, after the mobile checklist ONC-30).
- [x] **Screenshots** (settings, conflict dialog, deletion prompt, file list with emoji, log) for the README, the Obsidian detail page and the community page; without real server names or credentials (ONC-32). In `docs/images/en/` and `docs/images/de/`, taken against the Docker test server; to retake them after UI changes see [scripts/screenshots/README.md](../scripts/screenshots/README.md). The community page takes them over once it is published (ONC-31).
- [ ] **Help and detail pages** in Obsidian as well as the **community page** `https://community.obsidian.md/plugins/nextcloud-collectives` to be published once the store entry is accepted (ONC-31).

## GitHub repository

- **Description** ("About" field, at most 350 characters): *Obsidian plugin that syncs all Nextcloud Collectives of a server with your vault in both directions – pages, hierarchy, tags, emoji, links and attachments. Conflicts become copies instead of overwrites. Works on desktop and mobile.*
- **Topics**: `obsidian-plugin`, `obsidian-md`, `nextcloud`, `nextcloud-collectives`, `sync`, `markdown`, `webdav`
- **License**: MIT (the `LICENSE` file is in the repo; when creating the repository, add no template and no README/`.gitignore`, so that the first push works without a conflict)
- **Visibility**: public (for BRAT and the store); default branch `main`
- Optionally turn off issues there if feedback should keep going through Forgejo.
