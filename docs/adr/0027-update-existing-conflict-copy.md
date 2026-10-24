# 0027 – Update the existing conflict copy when the server changes again

- Status: accepted
- Date: 2026-10-24
- Related: architecture §6.3, §8, [ADR 0017](0017-push-etag-confirmation-and-conflict-resolution.md), issue ONC-33

## Context

While a page is in status `conflict` or `collision`, it is not pushed, and every further change on the server meets "both sides changed" again. Until now each such run created one more conflict copy (`Title (Conflict …).md`). A page edited often in the browser collected one copy per sync, and only the latest one was moved to the trash on resolution.

Two things must hold: the user's data is never overwritten without asking (AGENTS rule 4), and a choice in the conflict dialog only applies to the server version the dialog showed (ADR 0017).

## Decision

- If a page is already in `conflict`/`collision` and its recorded conflict copy (`conflictPath`) still exists, the new server version is written **into that copy** (`vault.process`) instead of a new one. The file name, and with it the timestamp of the first conflict, stays. `baseHash` moves on to the new server version, as before.
- The copy is only overwritten if it is unchanged: `sha256Hex(toRemote(copy))` must equal the page's `baseHash` (the hash of the server version written into it), and the file must not change between reading and writing (`writeIfUnchanged`). Otherwise, or if the copy is gone, a new copy is created as before. This covers copies the user edited, metadata conflict copies (they carry a `tags` line, so their hash differs) and states from before M4 (`baseHash: ''`).
- The conflict dialog guards against a stale view by the hash as well: `ConflictEntry` carries the `baseHash` from the time the list was taken, and `applyResolution` refuses the choice if it differs from the current one (`expectedBaseHash`), in addition to the existing check of the path (`expectedConflictPath`). The dialog then reloads the list ("stale" message).
- The run still counts the page as a conflict (`result.conflicts`), so the summary tells that the server changed again. The log says "Conflict copy updated" instead of "Conflict copy created".
- Attachment conflict copies (`name (Conflict …).png`) are not affected: an attachment has no conflict status, a copy is only created once per collision.

## Alternatives considered

- **Rename the copy to the time of the latest server version** – the name would show the current state, but every run with a server change would rename a file and could break a link the user set to it. The copy is a working file; its content shows the server version.
- **Always overwrite the copy** – simpler, but an edit the user made in the copy (for example while merging by hand) would be lost without asking.
- **Delete older copies after creating a new one** – the same pile-up is avoided, but it deletes a file instead of updating it; a user edit in the old copy would be lost as well.
- **Only compare the path in the dialog, as before** – the path no longer changes on an update, so a choice made against an older server version would be applied: "Keep local" would overwrite a server version the user never saw.

## Consequences

- positive: one conflict copy per page, however often the server changes; the copy always shows the current server version.
- negative / cost: one extra read and hash of the copy per conflict run. The timestamp in the name is the time of the first conflict, not of the server version in it. An open dialog that shows a copy updated in the background refuses the choice once and reloads.
- follow-up work: none.
