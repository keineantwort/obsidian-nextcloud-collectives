# 0001 – ADRs as Markdown in the repository

- Status: accepted; language superseded by [0025](0025-english-documentation-user-manual-and-architecture.md)
- Date: 2026-10-16
- Related: ONC-1

## Context

Architecture decisions used to be scattered across `PLAN.md` §15 and chat histories. Coding agents and humans need a fixed, versioned place where they can read the reasoning before deviating from a decision.

## Decision

Decisions are stored as Markdown files in the [MADR](https://adr.github.io/madr/) format (simplified) under `docs/adr/NNNN-shortname.md`. Template: `template.md`, overview: `README.md`. New ADRs are submitted in the same PR as the implementation. Accepted ADRs are not rewritten but superseded by new ones.

## Alternatives considered

- **Docusaurus site** – its own npm toolchain, build and hosting for a plugin repo; Docusaurus could still render the same Markdown files later.
- **Only `PLAN.md` §15** – no reasoning or alternatives, becomes hard to follow.

## Consequences

- ADRs go through the same review as the code and are directly readable for agents (`AGENTS.md` points to them).
- A later documentation site remains possible without moving files.
