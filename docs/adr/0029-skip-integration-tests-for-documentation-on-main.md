# 0029 – Skip the integration and nightly tests for documentation-only changes on main too

- Status: accepted
- Date: 2026-10-25
- Related: [0024](0024-integration-tests-split-pr-and-nightly.md), [0026](0026-required-checks-and-retried-app-install.md), issue ONC-31

## Context

Since [0026](0026-required-checks-and-retried-app-install.md), `integration.yml` skips its steps on a pull request that touches nothing the tests depend on, and still reports green for the required check. After the merge, though, the push to `main` ran the integration tests in full, and `nightly.yml` started a night (two older versions plus the performance test on all versions) for every merge since the night before ([0024](0024-integration-tests-split-pr-and-nightly.md)). A merge that changed only the README or the user manual thus occupied the Docker LXCs twice for nothing.

## Decision

- The rule for "affects the tests" lives in one place, **`scripts/ci/affects-tests.sh <base> [<head>]`**: true if the diff touches `src/`, `tests/`, `scripts/dev-nextcloud/`, `scripts/ci/`, `integration.yml`, `nightly.yml`, `vitest.*.config.ts`, `package.json` or `package-lock.json`. If git cannot compare the two commits, it says true.
- **`integration.yml`**: the skip step runs for pull requests (compared with the base branch, as before) and now for pushes to `main` too (compared with `github.event.before`, so a merge holds everything it brought in). If the base cannot be fetched, the tests run. Started by hand, they always run.
- **`nightly.yml`**: the job `changes` fetches the whole history and compares `main` with its state 25 hours ago, following `main` only (`git rev-list --first-parent --before="25 hours ago"`). A night runs only if that diff affects the tests. Unchanged: the night from Wednesday to Thursday and runs started by hand always run; if there is no state of `main` older than 25 hours, the night runs.

## Alternatives considered

- **Compare with the commit of the last successful nightly run via the Forgejo API** – rejected already in [0024](0024-integration-tests-split-pr-and-nightly.md) (needs a token, the Actions API varies by Forgejo version).
- **`paths` filter on the push trigger of `integration.yml`** – would leave `main` without a status for documentation merges and could not be combined with the pull request trigger, which must always report ([0026](0026-required-checks-and-retried-app-install.md)).
- **Keep the regular expression in each workflow** – two copies would drift apart; the script also makes the rule testable locally.
- **Also skip `ci.yml` (build, lint, unit tests)** – it is a required check too, takes about a minute, and the GitHub mirror depends on it.

## Consequences

- positive: Documentation-only merges no longer start integration tests on `main` or a night; the LXCs stay free.
- negative / cost: A change outside the listed paths that does affect the tests (for example a new top-level config file) is not tested on `main` until the next relevant merge or the weekly night. New such files must be added to `scripts/ci/affects-tests.sh`. A version bump counts as relevant because it changes `package.json`.
- follow-up work: none.
