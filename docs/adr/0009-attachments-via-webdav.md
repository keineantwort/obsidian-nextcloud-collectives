# 0009 – Attachments via WebDAV PUT instead of OCS multipart

- Status: accepted
- Date: 2026-10-16
- Related: architecture §9.4, ONC-1

## Context

Collectives lists attachments from the folder `.attachments.{pageId}/` next to the page file. Upload is possible via OCS multipart or via WebDAV (both confirmed in M0).

## Decision

Upload via WebDAV: `MKCOL .attachments.{pageId}/` if needed, then `PUT` of the file. ETags via `PROPFIND`. Deletion via OCS `DELETE …/attachments/{attId}` (ends up in the trash).

## Alternatives considered

- **OCS multipart** – the body would have to be built manually for `requestUrl`, and on a name collision the server renames on its own (`name (1).ext`), so local embeds no longer match.

## Consequences

- Same code path as for page contents, deterministic file names.
- The OCS attachment list contains no ETags – reconciliation via PROPFIND.
