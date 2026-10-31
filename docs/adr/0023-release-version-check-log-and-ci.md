# 0023 – Release: version check, log view, release CI

- Status: accepted
- Date: 2026-10-18
- Related: [0032](0032-release-workflow-sets-the-tag.md) (tag set by the workflow), architecture §12, milestone M10, the open decision on store publication, issue ONC-11

## Context

M10 turns the development state into an installable plugin: The user must notice when the server is outside the tested range, and have something to report when problems occur. The release artifacts must be produced reproducibly.

## Decision

- **Version check** (`src/api/versionCheck.ts`): On every run, `runSync` reads the Nextcloud version from `/ocs/v2.php/cloud/capabilities` and reports it to the `SyncController`. The major versions in `TESTED_NEXTCLOUD_MAJORS` are tested (currently 33, 34, 35); a unit test keeps the list equal to the matrix of `integration.yml`. A different major version (older or newer) yields **one** warning per session and version; the sync continues. A failing or unreadable check never stops the sync, it is only logged. The Collectives version cannot be queried by users (M0); `ApiChanged` remains for that.
- **Log view** (`src/ui/logModal.ts`, `logView.ts`): The command "Show log" and a button in the settings show the ring buffer (500 entries) as text with "Copy log". `debugLogging` (setting "Detailed log") additionally logs every request as method, path, status, duration via `HttpClient.onAttempt`; never headers, bodies or passwords.
- **`deferred` counter**: A push whose remote state remains unconfirmed even after the second GET no longer counts as `unchanged` but as `deferred` and triggers a warning (note from the M4 review).
- **Release CI** (`.forgejo/workflows/`): `ci.yml` builds, lints and tests every PR and push to `main`. `release.yml` runs on a tag `x.y.z` (without `v`, as Obsidian and BRAT require), checks via `scripts/check-release.mjs` that tag, `manifest.json`, `package.json` and `versions.json` match, builds, tests and attaches `main.js`, `manifest.json` and `styles.css` individually to a Forgejo release.
- **Mirroring to GitHub**: After a passing build, `ci.yml` pushes every state of `main` to GitHub without `--force`; on a tag, `release.yml` creates the release there with the three files (BRAT and the store read GitHub). Both are off as long as the variable `MIRROR_GITHUB_REPO` is missing; the token is stored as secret `MIRROR_GITHUB_TOKEN`.
- **Integration tests across several versions** (`integration.yml`, triggers and split superseded by [0024](0024-integration-tests-split-pr-and-nightly.md)): A matrix starts a fresh Docker test server for each tested Nextcloud major version (with the newest matching Collectives version) and runs `npm run test:int`; on every pull request with changes to code, tests or test server, on push to `main`, on release tags, weekly and manually. A new push to the same branch cancels the running run. A `latest` run is an early-warning system for the next major version and may fail. `scripts/dev-nextcloud/versions.sh` writes Nextcloud and app versions (including Collectives, which cannot be read via the API) into every log. The open decision on integration tests in CI is thereby implemented, provided the runner offers Docker.

## Alternatives considered

- **Block the version hard** – would lock out working newer servers; the structural check of the responses protects more reliably.
- **Write the log to a file in the vault** – would be synchronized or touch user data; the in-memory ring buffer suffices for reporting.
- **Version script via `npm version`** – changes `package-lock.json` and creates tags; here the version is visible in the pull request and the tag is a deliberate step.

## Consequences

- positive: Deviating server versions are noticed; bug reports contain a log; a release is a tag.
- negative / cost: A new Nextcloud major version counts as "tested" only after the entry in `TESTED_NEXTCLOUD_MAJORS` and in the matrix; the `latest` run shows when that point is reached. The Collectives version is not enforced but only logged (the app store delivers the newest matching one). The log is lost on restart.
- Open (cannot be solved in the repo): mirroring to GitHub (Codeberg is ruled out because it does not allow predominantly AI-written code), publication in the community store, screenshots and community page – see `docs/release.md`.
