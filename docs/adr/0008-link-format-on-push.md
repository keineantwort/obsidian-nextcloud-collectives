# 0008 – Link format on push: relative with `?fileId=`

- Status: accepted
- Date: 2026-10-16
- Related: architecture §9.1, §9.3, `docs/api-notes.md` §7, ONC-1

## Context

Collectives recognises three link forms (relative with `?fileId=`, absolute, root-relative). The link picker of the web UI writes absolute URLs with `/index.php/`. Locally, wikilinks are wanted.

Manual check in the text editor (2026-10-16, pretty URLs active):

| Form | Click leads to the page |
|---|---|
| `Target.md?fileId=138` | ✔ |
| `http://host/index.php/apps/collectives/Admins-Wiki-3/Target-138` | ✘ new tab, "Collective not found" |
| `/index.php/apps/collectives/Admins-Wiki-3/Target-138` | ✘ new tab, "Collective not found" |
| `/apps/collectives/Admins-Wiki-3/Target-138` | ✔ |
| `Target.md` | ✔ |
| `Target.md?fileId=138#section-two` | ✔ (anchor not verifiable) |

## Decision

Push writes page links as a **path relative to the source file with `?fileId={id}`** (anchor as `#slug` after it). Pull resolves all known forms (relative, absolute, root-relative, with/without `index.php`, collective as `{slug}-{id}` or name).

## Alternatives considered

- **Absolute picker format** – not clickable in the test (cause open: presumably `/index.php/` with active pretty URLs), and also server-dependent.
- **Relative without `fileId`** – clickable, but not recognised by the server as a page link (no backlinks) and breaks on renames.

## Consequences

- Links stay resolvable across renames via the file ID; backlinks in Collectives work.
- Round-trip tests in milestone M7 use this form as the canonical remote format.
