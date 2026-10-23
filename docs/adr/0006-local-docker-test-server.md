# 0006 – Local Docker test server for verification and integration tests

- Status: accepted
- Date: 2026-10-16
- Related: architecture §13, AGENTS rule 6, ONC-1

## Context

M0 has to clarify real server behaviour (link format, 412, file IDs), and from M4 on integration tests are mandatory. Tests against production servers are ruled out.

## Decision

`scripts/dev-nextcloud/`: a single container `nextcloud:<NC_VERSION>-apache` with SQLite; a post-install hook installs Collectives and Circles and creates the test user. Bound to `127.0.0.1` only, throwaway credentials in `.env` (gitignored). Unit tests run without a server against the M0 fixtures.

## Alternatives considered

- **Mocks/fake server** – would only repeat our own assumptions.
- **Non-production Nextcloud in the HomeLab** – no local load, but cannot be reset reproducibly; left open as an option for CI.
- **Full stack (Postgres, Redis, TLS)** as with Nextcloud Sync – unnecessary to begin with.

## Consequences

- About 1.2 GB image, container active only when needed; `down.sh --reset` gives a fresh state.
- SQLite behaves differently from MySQL in string comparisons (e.g. case-sensitive tag names) – code must not rely on it.
- Open (milestone M4 decision, formerly open decision #8): remote test server so that Forgejo Actions can run `test:int`; decision before M4.
