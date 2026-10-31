# Runners for the Forgejo Actions workflows

For the workflows in `.forgejo/workflows/` of this repo. Status: feedback from the HomeLab project (2026-10-20); the requirements below are thereby met.

## Which workflow runs where

| Workflow | Trigger | `runs-on` | Needs |
|---|---|---|---|
| `ci.yml` | every PR, push to `main` | `ubuntu-latest` | job container `node:24-bookworm`, the runner's cache server (see below); about 1–2 minutes |
| `release.yml` | "Run workflow" on `main` (sets the tag `x.y.z`) | `ubuntu-latest` | job container `node:24-bookworm` (ships `curl` and `git`), cache server; secret `RELEASE_TOKEN` |
| `integration.yml` | every pull request and push to `main` (the test steps only on changes to `src/`, `tests/`, `scripts/dev-nextcloud/`, `scripts/ci/`, `vitest.*.config.ts`, `package*.json` or the test workflows, `scripts/ci/affects-tests.sh`), manual | **`docker-host`** | Docker with Compose, see below |
| `nightly.yml` | daily 01:00 UTC, but only if `main` changed since the night before in something the tests depend on (as `integration.yml`); the night from Wednesday to Thursday always; manual | `ubuntu-latest` (check) and **`docker-host`** | as `integration.yml` |

## `ubuntu-latest` (job container)

- `ci.yml` and `release.yml` run in the image `node:24-bookworm`; Node is not downloaded on every run. `jq` is missing from the image; JSON is read with `node -p`.
- `actions/cache` stores `~/.npm` (key: hash of `package-lock.json`). For this, the cache server must be enabled in act_runner (`cache.enabled`, `host` reachable from the job containers, not `localhost`). Without it the step only warns and `npm ci` downloads everything again.
- `container.force_pull: false` in the runner, so that the image is not pulled again for every job.
- Implemented in the HomeLab (2026-10-20, act_runner v13.2): `cicd-runner1` and `cicd-runner2` each have their own cache server on `172.17.0.1:8088` (reachable only from the Docker bridge in the LXC), data under `/srv/act-runner/actcache`. For each runner there is a first run without a hit for every new hash of `package-lock.json`. The runner cleans up by itself: unused entries after 7 days, all of them after 30 days at the latest.

## `docker-host` (host runner on the Docker LXCs)

- The runner has **no job container image**; the job uses what is on the LXC: Node 24, `curl`, `jq`, `git`, Docker with Compose v5.1.4. Hence no `actions/setup-node` in `integration.yml` and `nightly.yml`. Neither `sudo` nor `apt-get` is available to the runner user: **the workflow must not install anything**, only `npm ci` in the working directory.
- The job runs in the host's network; `http://localhost:<port>` reaches the published port of the test server.
- Forgejo distributes the matrix jobs across both LXCs: integration against Nextcloud 35 and `latest` (`integration.yml`) as well as 33 and 34 (`nightly.yml`) with Compose project `nc-test-<version>` and port 81xx (8133, 8134, 8135, 8199), performance against 33, 34, 35 and `latest` (`nightly.yml`) with `nc-perf-<version>` and port 82xx (8233, 8234, 8235, 8299). They do not collide, even when several jobs run on the same host, because each job has its own port and project name.
- The test server binds only to `127.0.0.1`; credentials are throwaway values from `scripts/dev-nextcloud/.env.example`; at the end `docker compose down -v` runs (also on errors).

## Requirements per Nextcloud job

- about 1–2 CPU cores, 2 GB RAM, image about 1.2 GB per version plus data volume; at least 10 GB free on the Docker host.
- Runtime: startup about 2–5 minutes, integration tests about 5–15 minutes (timeout 45 minutes), performance test up to 20 minutes (timeout 60 minutes). A new push to the same PR branch cancels the running run and restarts it (`concurrency`), so that several runs do not occupy the LXCs.
- Outbound: Docker Hub (`nextcloud`, plus `hub.docker.com/v2` for the digest comparison of the `latest` jobs), `apps.nextcloud.com` (Collectives, Circles), npm registry.

## Cleanup

Aborted jobs (timeout, runner restart) can leave behind containers and volumes `nc-test-*` or `nc-perf-*`. The next run of the same job and the same version cleans them up itself before starting (`docker compose down -v` in the "Start Nextcloud" step). Otherwise it would keep using the old server with all pages of the aborted run. Targeted: `docker compose -p nc-test-<version> down -v` (or `nc-perf-<version>`) on the affected LXC; when in doubt, `docker system prune`.
