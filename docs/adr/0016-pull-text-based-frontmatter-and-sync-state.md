# 0016 – Pull: text-based frontmatter, sync state as its own file, conflict copy instead of overwriting

- Status: accepted
- Date: 2026-10-16
- Related: architecture §6.2, §6.3, §7.3, §7.4, §11, issue ONC-4 (M3)

## Context

M3 writes remote content into the vault for the first time. Three questions were open:

1. The `nc_*` fields must go into the frontmatter without changing the user's YAML. If the YAML changes on write (different indentation, quoting, order), the remote format deviates from the `baseHash`. The next check then reports a local change although the user did nothing (ping-pong, architecture §6.3).
2. Where does the sync state live, and how does an idle run stay free of write accesses (acceptance criterion of M3)?
3. What happens if a foreign file already sits at the target path of a remote page (first sync into a non-empty vault), or if content was changed on both sides before push exists in M4?

## Decision

- **Text-based frontmatter** (`src/mapping/frontmatter.ts`): The `nc_*` lines are placed as flat top-level lines (values via `JSON.stringify`) in front of the user's YAML, or removed together with their continuation lines. The user's YAML is preserved byte for byte. `processFrontMatter` is not used for plugin fields because it re-serializes the whole YAML. Writing goes through `vault.create` or `vault.process` (AGENTS rule 2).
- **Canonical remote format**: `baseHash` = SHA-256 of `canonicalRemote(remote)` = `toRemote(toLocal(remote))`, i.e. the normal form of the text editor (ADR 0005). A server text that is not in normal form therefore does not count as locally changed.
- **Sync state in `sync-state.json`** in the plugin folder (via `app.vault.adapter`, not a note), separate from `data.json`. `StateStore.save` writes only if the stably serialized version has changed. In addition to architecture §6.3: `localMtime` (mtime after the plugin's last own write, used instead of `lastSyncedAt` to detect local changes), `status` (`synced`/`conflict`/`collision`), `conflictPath`.
- **Branded IDs** (`CollectiveId`, `PageId`, `TagId`, `AttachmentId`) in `src/api/types.ts` so that IDs in the state cannot be mixed up.
- **Conflict copy instead of overwriting, already in M3**: If the target path is occupied or both sides were changed differently, the local file stays unchanged. The remote version is placed next to it as `Title (Conflict YYYY-MM-DD HHmm).md` (without `nc_*`, not synchronized). The state remembers the conflict so that the next run does not create another copy. A collision file (`status: collision`, `localPath` = actual path of the user's file) never gets `nc_*` fields. It is only linked if it carries no `nc_page_id` and its text equals the remote text. If, on the other hand, the target path is occupied by the file of another, known page or by a folder, the new page gets a free name with the suffix ` (2)`; foreign pages are never adopted.
- **Paths in their existing spelling**: Collisions are detected independent of case and Unicode form (`pathKey`); folders and files are addressed in the spelling that already exists (`canonicalPath`). `nc_title` is derived from the actual file name on every write, `metaHash` from the remote title. Frontmatter with CRLF or BOM is detected and preserved in its form.
- **Structural changes only logged in M3**: remote renamed/moved/deleted, locally deleted, collective renamed/removed → skip with a reason in the log, implementation in M5. Locally deleted pages are never recreated.
- **Account binding**: If a state containing pages belongs to a different server URL or a different Nextcloud user ID, the run aborts without any write access (`serverMismatch`).

## Alternatives considered

- **`processFrontMatter` for the `nc_*` fields** – official API, but it reformats the user's YAML and thereby produces phantom changes.
- **YAML library** – new dependency (AGENTS rule 8), and re-serializing would have the same problem.
- **State in `data.json`** (own key via `saveData`) – every state change would also write the settings. For crash safety (saving after every operation) a separate file is clearer.
- **Skip the collision, or suffix " (2)"** – skipping never fetches the page; a suffix leads to a duplicate upload of the local file in M5. Agreed with the user: conflict copy.

## Consequences

- positive: idle runs without write accesses (vault and state), the user's YAML stays untouched, no data loss on collisions.
- negative / cost: The text-based detection only knows `\n` as a line separator (CRLF files have no frontmatter as far as the plugin is concerned). If the user changes `nc_*` fields via the properties view, the next metadata pull writes them back in the plugin's form.
- Follow-up work: M4 (conflict dialog evaluates `status`/`conflictPath`; push must not upload pages with `status: conflict` or `collision`), M5 (structural cases, do not upload collision files (`status: collision`) as a new page, adapt the upload text in the first-sync dialog), M6 (push of metadata, `tagsProperty`).
