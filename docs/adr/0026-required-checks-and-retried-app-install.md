# 0026 – Required checks for main, in-job change detection, retried app installation

- Status: accepted
- Date: 2026-10-24
- Related: [0024](0024-integration-tests-split-pr-and-nightly.md), [0006](0006-local-docker-test-server.md)

## Context

A pull request could be merged before CI and the integration tests had run. Forgejo prevents this with required status checks in the branch protection rule for `main`. A required check must report on every pull request, but `integration.yml` was started only by changes to code, tests or the test server (paths filter, ADR 0024); a pull request that changes only documentation would never get the check and could never be merged.

Separately, a nightly run for Nextcloud 34 failed while the test server was being set up: `occ app:install collectives` reported "not found on the appstore", although the app store lists Collectives 4.7.1 for Nextcloud 32 to 35. The server had received no app list at that moment.

## Decision

- **Required checks** for `main`: `CI / build-and-test (pull_request)` and `Integration (Nextcloud versions) / Nextcloud <current> (pull_request)`. Not required: `latest` (may fail) and `CI / mirror-github` (runs only on `main`). The maintainer sets them in Forgejo; `docs/release.md` lists them.
- **No paths filter on `integration.yml`.** The first step of the job compares the pull request with its base (`git diff` against the fetched base branch; the checkout is the merge commit) and skips all further steps when nothing under `src/`, `tests/`, `scripts/dev-nextcloud/`, `integration.yml`, `vitest.*.config.ts` or `package*.json` changed. The job is then green. If git cannot tell, the tests run. The same step skip (`SKIP_TESTS`) also covers `latest` while it equals the current version.
- **Retried app installation** in `scripts/dev-nextcloud/hooks/10-collectives.sh`: Circles and Collectives are tried up to five times with waits of 10, 20, 30 and 40 s (100 s in total, below the roughly 5 minutes the health check gives the hook).

## Alternatives considered

- **Keep the paths filter and not require the integration check** – a pull request with code changes could again be merged before the tests ran.
- **Run the integration tests on every pull request** – a documentation change would occupy the Docker hosts for several minutes.
- **Install Collectives from a pinned release archive instead of the app store** – independent of the store, but the test server would no longer pick the newest Collectives that fits each Nextcloud version.

## Consequences

- positive: nothing reaches `main` without green build, unit tests and integration tests on the current version; documentation pull requests stay fast. A brief app store outage no longer fails a run.
- negative / costs: the required check names the current version; with a new major version the maintainer must replace it in the branch protection rule (`docs/release.md`). A permanent store outage still fails the run, after about 100 s more.
- follow-up work: none.
