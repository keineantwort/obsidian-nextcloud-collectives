# 0024 – Integration tests split: current version and latest per PR, older versions and performance nightly

- Status: accepted
- Date: 2026-10-23
- Related: the open decisions on target versions and on integration tests in CI, ADR 0023

## Context

`integration.yml` (ADR 0023) ran on every PR, every push to `main`, every release tag and weekly against all tested Nextcloud versions and `latest`, each time including the performance test (500 pages). A run blocked the Docker LXCs for a long time. On the release tag, the same suite ran a third time for a state that had already passed it at the PR and at the merge.

## Decision

- **`npm run test:int`** excludes the performance test; it runs via **`npm run test:perf`** (`vitest.performance.config.ts`).
- **`integration.yml`**: `test:int` against the current, i.e. newest, version from `TESTED_NEXTCLOUD_MAJORS` (currently 35), and against `latest` (newest image on Docker Hub, may fail as an early warning); on every PR (path filter as before, plus `vitest.*.config.ts`; replaced by a check inside the job in [0026](0026-required-checks-and-retried-app-install.md)), every push to `main` and manually. No tag trigger, no schedule.
- **`nightly.yml`**: on `main`, daily at 01:00 UTC.
  - Job `integration`: `test:int` against the two versions before the current one (currently 33, 34).
  - Job `performance`: `test:perf` against all tested versions and `latest` (`latest` may fail).
  - An upstream job `changes` lets the night run only if the head of `main` is younger than 25 hours (committer date; Forgejo sets it to the merge time on merge). In the night from Wednesday to Thursday (Thursday 01:00 UTC) it always runs, so that every version is tested at least once a week. When started manually it always runs.
- **`latest` only if it differs from the current version**: The first step of the `latest` jobs (integration and performance) compares via the Docker Hub API the digest of `nextcloud:apache` with that of `nextcloud:<current>-apache` (`scripts/dev-nextcloud/latest-is-current.sh`, current = highest number in `TESTED_NEXTCLOUD_MAJORS`). If they are equal, the job skips all further steps and is green. Because `<major>-apache` always points to the newest release of that major version, an equal digest is the same as an equal full version; comparing only the major version would give the same result but needs a running server. If Docker Hub is unreachable, the job runs.
- `tests/unit/testedVersions.test.ts` checks: The integration matrices of both workflows together cover exactly `TESTED_NEXTCLOUD_MAJORS`, the PR workflow the newest one, the performance job all of them.
- Performance jobs use their own Compose projects (`nc-perf-<version>`) and ports (82xx) so that they can run next to the integration jobs on one host.

## Alternatives considered

- **Query the last successful nightly run via the Forgejo API** and compare its commit with `main` – more accurate, but needs a token and an Actions API whose scope varies by Forgejo version. The committer date suffices as long as merging is done via merge commit, squash or rebase.
- **One workflow with a dynamic matrix per trigger** – fewer duplicated steps, but a matrix computed from job outputs is harder to read and verify in the Forgejo runner than two fixed workflows.
- **Omit `latest` entirely via a job condition** – a condition at job level cannot address individual matrix entries; a separate job just for `latest` would have repeated all steps once more.
- **Keep the performance test in `test:int`, only nightly via an environment variable** – local runs of `test:int` would then stay slow.

## Consequences

- positive: PRs and merges wait for only one version (plus `latest`, which does not block) without the performance test; a new major version is noticed already in the PR; the LXCs are free sooner. Release tags only build now.
- negative / cost: A failure that occurs only on an older version or only in the performance test is noticed only after the merge (at the latest the following night). If a night is skipped (runner off), a merge is caught up only with the next merge or in the night from Wednesday to Thursday. A fast-forward push of old commits to `main` does not trigger a night.
- Follow-up work: On a new major version, shift the matrices in both workflows (`docs/release.md`).
