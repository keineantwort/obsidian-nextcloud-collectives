# 0020 – Links: page index, anchors unchanged, hash in the remote format

- Status: accepted
- Date: 2026-10-17
- Related: architecture §9.1–9.3, ADR 0008, issue ONC-8

## Context

M7 converts page links between Collectives (`[Text](Path.md?fileId=…)` and others) and Obsidian wikilinks. The conversion needs knowledge about all pages (titles, paths, slugs). The hash (`baseHash`, local hash) must be independent of the link spelling, otherwise phantom changes arise. Heading anchors of the target page are planned as slug → heading in the plan, but the server's slug rule is not verified and the target texts are not available during pull.

## Decision

- `src/mapping/links.ts` (pure) converts in both directions on the basis of a `LinkIndex`. The index is built per pass from the remote list, local scan and path plan (`src/sync/linkIndex.ts`) and passed on via `ExecutorDeps.links`.
- Canonical remote format: relative with `?fileId=` (ADR 0008); for another collective as `/apps/collectives/{slug}-{cId}/{pageSlug}-{id}`. Canonical local format: `[[Vault/Path/Page|Text]]` (alias only if text ≠ title).
- `toRemote` and `canonicalRemote` optionally take a `LinkContext`; all hashes (local and remote) are computed over the remote format with context. This makes all three server spellings and a renamed target page hash-equal.
- Anchors are adopted **unchanged** (URL-encoded in the remote format), no slug↔heading mapping.
- Conflict copies contain wikilinks; "Take remote" converts them back via `toRemote`. The conflict dialog uses the index of the last pass.
- Code blocks, inline code, frontmatter, embeds (`![[…]]`, `![](…)`) are not touched. Unresolvable links are left as they are. Markdown links to notes are converted to remote like wikilinks and come back as wikilinks.

## Alternatives considered

- **Slug → heading via the target page** – needs the text of every target page and a verified slug rule; can be added later.
- **Hash over the local text** – would report all linking pages as changed whenever a target page is renamed.

## Consequences

- Anchors on headings with umlauts/spaces may not jump exactly in Obsidian or Collectives; the link to the page works.
- Wikilinks to pages that only come into existence in this run are converted only in the following run (the hash then catches up, a push follows).
- The index is built at the start of the run; moves within the same run take effect only in the next one.

## Known limitations (review ONC-8)

- A link without alias locally means "text = current title". If the target page is renamed, the canonical link text of the linking pages changes (a one-time push, a conflict if the same page changes on the server at the same time). Accepted deliberately; unavoidable without an alias marker in the state.
- Relative links and `fileId` resolve only within the own collective; links into other collectives only as a URL with a matching `{slug}-{id}` and the server's host (protection against reading foreign collectives via guessed IDs). Server under a subpath: the path is taken into account in URLs.
- The conflict dialog needs the page index of a sync pass; after startup a sync therefore runs before the resolution.
