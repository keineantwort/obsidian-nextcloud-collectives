# 0007 – Content via WebDAV, metadata via OCS, no `touch`

- Status: accepted
- Date: 2026-10-16
- Related: architecture §4, `docs/api-notes.md` §3–5, ONC-1

## Context

The Collectives OCS API does not deliver page contents. Content lives as a file in the Collectives folder (configurable per user).

## Decision

- Read/write content via WebDAV (`GET`, `PUT` with `If-Match`, new files with `If-None-Match: *`), always taking paths from `collectivePath`/`filePath`/`fileName` of the API.
- Structure and metadata (create, rename, move, emoji, tags, trash) via OCS.
- No `touch` after the `PUT`: Collectives' `NodeWrittenListener` itself sets the last editor on WebDAV writes, sends notifications and updates `linkedPageIds` (confirmed in M0).

## Alternatives considered

- **Everything via WebDAV** (Collectives detects raw PUT/MOVE/DELETE, M0) – title sanitising, emoji and tags would not be controllable that way; creating pages via OCS returns the ID immediately.
- **`touch` after every PUT** – an additional request with no benefit, duplicate notifications.

## Consequences

- Conflict detection via ETag/412 (confirmed in M0).
- ETags propagate up to `.Collectives/`; a depth-0 PROPFIND detects content changes cheaply. Emoji/tags do not change an ETag – the page list has to be loaded anyway.
