# 0004 – Folder-note convention instead of `Readme.md`

- Status: accepted
- Date: 2026-10-15
- Related: architecture §6.1

## Context

Collectives stores landing pages and parent pages as `Readme.md`. In Obsidian, many identically named `Readme.md` files are unusable in the quick switcher, in wikilinks and in tabs.

## Decision

Locally, the file of a parent page is named like its folder (`Processes/Processes.md`), the landing page like the collective (`Handbook/Handbook.md`). The mapping in `src/mapping/paths.ts` translates in both directions.

## Alternatives considered

- **Keep `Readme.md`** – 1:1 mirror, but poorly usable in Obsidian.
- **Parent page as a file next to the folder** (`Processes.md` + `Processes/`) – common, but moving things in Obsidian easily separates file and folder.

## Consequences

- M0: parent pages remain folders on the server, even without subpages; locally this is a folder note without siblings.
- If a subpage is created locally under a leaf page, the leaf page has to move into the new folder (Collectives turns `Title.md` into `Title/Readme.md`, the file ID stays).
