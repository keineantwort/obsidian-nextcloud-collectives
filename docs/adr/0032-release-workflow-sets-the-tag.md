# 0032 – The release workflow sets the tag

- Status: accepted
- Date: 2026-10-31
- Related: [0023](0023-release-version-check-log-and-ci.md), [docs/release.md](../release.md)

## Context

ADR 0023 made the tag the trigger: after the merge, the maintainer set the tag `x.y.z` on `main` and pushed it, and `release.yml` built it. That order allowed errors the workflow could only catch afterwards: a tag set before the merge (on a branch commit), a tag on an older `main`, a version that was released already (HTTP 409 when creating the release, with a stale tag left behind), or a release built while the checks of the merge were still running.

## Decision

`release.yml` is started by hand (`workflow_dispatch`, branch `main`). It reads the version from `manifest.json` and checks first, before building, that no tag and no release of that version exist on the repository, on Forgejo and (if mirroring is on) on GitHub. A concurrency group `release` prevents two runs at once.

Then `scripts/ci/wait-for-checks.mjs` waits (up to 60 minutes) until the other workflows on the commit (CI, integration tests, mirror) are finished and stops on a red one; the `latest` job and the mirror job may be red. After build, lint and tests the workflow sets the tag: creating the Forgejo release with `target_commitish` = the built commit creates the tag there; the same tag is pushed to GitHub before the GitHub release is created. `scripts/release-notes.mjs` takes the commit as optional second argument. A run on a branch other than `main` is stopped.

If a step fails or the run is cancelled after the tag was set, a final step removes tag and release again on Forgejo and GitHub (all or nothing). The existence check at the start guarantees that only what this run created is removed.

## Alternatives considered

- **Keep the tag trigger and only add the existence check** – the tag would already exist when the check runs, and a failing check would leave a tag behind that has to be deleted.
- **Push the tag from the runner with git** – needs push rights for the runner token and a second credential path; the release API sets the tag in the same call that creates the release.
- **Delete tag and release by hand after a failure** – error-prone and blocks the next run until done.

## Consequences

- positive: No manual tagging, no tag on a wrong commit; a version that exists is rejected before the build; a failed run leaves no tag; no release from an unchecked or red commit.
- negative / cost: A release needs a click on "Run workflow" instead of a tag push. The rollback needs delete rights (`RELEASE_TOKEN` on the tag, `MIRROR_GITHUB_TOKEN` on contents); if it fails, the log names what to delete by hand. A GitHub release removed again may have been seen by BRAT or the directory for a moment. The wait relies on the commit statuses Forgejo sets per job (names in `wait-for-checks.mjs`); a renamed workflow or job needs the script adjusted.
