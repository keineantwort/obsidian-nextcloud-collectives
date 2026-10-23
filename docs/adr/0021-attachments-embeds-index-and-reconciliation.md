# 0021 – Attachments: embeds via the index, reconciliation via ETags, step after the content

- Status: accepted
- Date: 2026-10-17
- Related: architecture §9.2–9.4, ADR 0009, ADR 0020, issue ONC-9

## Context

M8 brings images and files in both directions: Collectives writes `![name](.attachments.{pageId}/name)`, Obsidian embeds `![[image.png]]` (files lie somewhere in the vault, usually where Obsidian puts pasted images). Hash and base (`baseHash`) are computed over the remote format (ADR 0020), so the embed must be convertible in both directions without additional state. Attachments must not be transferred on every run, and user data must never be overwritten or deleted without asking (AGENTS rule 4).

## Decision

- **Embeds in the text.** `links.ts` converts `![alt](.attachments.{id}/name)` ⇄ `![[Vault/Path/name]]` (`![[Path|alt]]` if the alt text differs from the file name; an empty alt text is canonicalized to the file name). Locally, `![[…]]` and `![alt](path)` are recognized for files in the vault (path from the root, relative to the note, or a name that only one file has). Notes, missing files, files above the size limit, code and embeds with a heading stay unchanged.
- **`AttachmentIndex`** (`mapping/attachments.ts`, pure) belongs to the `LinkIndex` and is built per pass: files of the vault with size (`LocalSnapshot.attachmentFiles`), default folder per page (pattern, relative to the note's folder, `{title}` = file name of the note) and the already synced paths from the state. A path in the default folder or from the state counts as an attachment of the page even if the file is still missing – this keeps the hash stable while the download is pending.
- **Storage.** Downloaded files are placed in `{folder of the note}/_attachments/{note name}/` (setting `attachmentFolderPattern`). Pasted files stay where the user has them; the state remembers the actual path. When a note is renamed or moved, attachments are not moved along (the state path stays valid).
- **Own step after the content** (`executorAttachments.ts`). After `create`/`adopt`/`update`/`push` of a page, the attachment step runs; for pages where nothing else is to be done and that have attachments in the state, the planner plans an operation `attachments` (so that changes on the server are noticed without a change to the page text). The step reads the folder `.attachments.{id}` via PROPFIND depth 1 (ETag, size, `fileid`) and decides per file. So at most one PROPFIND per page when nothing is to be done.
- **State.** `attachments: { id, name, etag, localPath, hash }`; `hash` = SHA-256 of the bytes that both sides last had. `etag: ''` marks "not yet transferred" (error during transfer, name on the server occupied): the next run tries again. The attachment ID is the `fileid` from PROPFIND (confirmed against the OCS list in the integration test); `0` = unknown.
- **Reconciliation per file.**
  - Only local and embedded by the note → upload via `MKCOL` (if necessary) and `PUT` with `If-None-Match: *` (never over an existing file). Then a PROPFIND for ETag and ID.
  - Only on the server and embedded → download. Same ETag as in the state → no transfer.
  - Server ETag changed → download; the vault file is only replaced if it still matches the state hash; otherwise it stays, and the server version is placed next to it as a conflict file (`name (Conflict …).ext`).
  - On both sides without a common state → compare bytes: identical, adopt; different: conflict file.
  - Deleted on the server → vault file to the Obsidian trash (`remoteDeleteBehaviour`), but only if it is unchanged.
  - Deleted in the vault and no longer embedded → delete on the server (Collectives trash; setting `deleteRemoteAttachments`, default on). If it is still embedded, it is restored.
  - Moved in the vault → the embed (updated by Obsidian) provides the new path; no transfer.
  - If the folder is missing on the server although the state knows attachments, everything is left untouched.
- **Size limit.** `maxAttachmentSizeMb` (1–1000, default 20). Larger files are neither uploaded nor downloaded; a local file that is too large is not converted (the embed stays `![[…]]` in the page text).
- **Transport.** `HttpRequest.body` may be an `ArrayBuffer`, `binaryResponse` delivers `HttpResponse.data`, `timeoutMs` per request (attachments 180 s instead of 30 s). `WebdavClient.getBinary`/`putBinary`. Writing requests are still never retried.

## Security (review ONC-9)

- The page text comes from the server and must not be able to make the plugin upload files from the vault. Only files below the folder of the own collective and images directly in the vault root folder are uploaded (that is where Obsidian puts pasted images by default). Other attachment folders of Obsidian must lie within the collective folder (e.g. "in the note's folder").
- At the server's initiative, files are only moved, replaced or put into the trash below the collective folder; file names from the server are plain names (no separators, control characters, leading dot, characters forbidden in Obsidian).
- Without a reported size (`getcontentlength`), nothing is downloaded; the size of the bytes is checked again before every write.
- A page in the state `conflict` deletes no attachments, neither in the vault nor on the server.

## Alternatives considered

- **OCS multipart upload** – see ADR 0009 (renaming on collision).
- **Decide attachments in the planner only** – the planner does not know the embeds (text); the step needs the page text after the content.
- **Upload local changes of existing attachments** – not implemented (see limitations).
- **File hashes before every run** – cost on mobile devices; server changes are detected via ETag, bytes are only read if the ETag differs.

## Consequences

- One PROPFIND per page with synced attachments per run.
- If the same file is embedded in several pages, it is uploaded per page (own `.attachments.{id}` folder).

## Known limitations

- A locally changed file with the same name is not uploaded; if the file changes on the server, a conflict file arises.
- If two embedded files of a page have the same name (different folders), only one is uploaded.
- Files whose name contains `[ ] | # ^` are downloaded but not embedded as a wikilink.
- Non-image links (`[Name](.attachments.{id}/file.pdf)`) are neither converted nor downloaded.
- If an attachment is already occupied by a foreign file at the target path when pulling a new page, the bytes are compared (identical: adopted; different: conflict file).
- Pages that stand without attachments in a state from M7 only fetch existing attachments when their text changes on the server; files above the limit are not remembered and, after the limit is raised, are only fetched on the next text change.
- If a transfer fails permanently (e.g. quota), it is retried on every run.
- A new local note with an image first goes to the server with `![[…]]`; conversion and upload follow in the next run.
- Attachments are not moved along when the note is renamed or moved.
- The page text of a page in the state `conflict` only refers to attachments that the note itself embeds; attachments that appear only in the server version arrive after resolution.
