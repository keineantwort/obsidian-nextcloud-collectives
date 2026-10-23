# 0002 – Own plugin instead of a fork of Nextcloud Sync

- Status: accepted
- Date: 2026-10-15
- Related: architecture §15

## Context

There is no Obsidian plugin for Nextcloud Collectives. The plugin "Nextcloud Sync" (siosig/obsidian-nextcloudsync, MIT) synchronises arbitrary Nextcloud folders via WebDAV and is mature.

## Decision

We write our own plugin. Existing plugins serve only as a reference; individual patterns or pieces of code are adopted with licence and source attribution (commits reviewed: `docs/api-notes.md` §11).

## Alternatives considered

- **Point Nextcloud Sync directly at `.Collectives/`** – no emojis, tags, link conversion or collective creation; the `Readme.md` structure stays visible.
- **Fork Nextcloud Sync** – large foreign codebase (diff3 merge, chunked upload, config sync …), upstream hardly accepts PRs, permanent fork maintenance. It also writes through the `DataAdapter` instead of the vault API (contradicts AGENTS rule 2).

## Consequences

- Full control over the Collectives-specific mapping.
- Proven solutions (Login Flow v2 with resume wake, mass-delete protection, PROPFIND parser) have to be rebuilt deliberately.
