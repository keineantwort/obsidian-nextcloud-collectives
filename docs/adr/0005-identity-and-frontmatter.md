# 0005 – Identity via `nc_page_id`, user frontmatter is uploaded too

- Status: accepted
- Date: 2026-10-15 (extended 2026-10-16 with the M0 finding)
- Related: architecture §6.2

## Context

After being renamed or moved in Obsidian, a local file must stay assigned to its remote page. Users maintain their own frontmatter (properties) that Collectives does not know about.

## Decision

- The page ID (= Nextcloud file ID) is stored as `nc_page_id` in the frontmatter and is the identity of the file. Further plugin fields: `nc_collective_id`, `nc_emoji`, `nc_tags`, `nc_title`.
- On upload only `nc_*` fields are removed; the remaining frontmatter is uploaded too. If nothing remains, the block is omitted.

## Alternatives considered

- **ID only in the sync state** – gets lost on renaming outside Obsidian or when the state is lost.
- **Keep all frontmatter locally** – user properties would be invisible on the server and would be lost when editing in the browser.

## Consequences

- M0 (manual check): the text editor shows frontmatter as a code block and preserves it byte-for-byte on saving. However, it inserts a blank line after the block and removes the trailing line break. Our remote format has to produce this normal form so that saves in the browser do not trigger phantom changes.
