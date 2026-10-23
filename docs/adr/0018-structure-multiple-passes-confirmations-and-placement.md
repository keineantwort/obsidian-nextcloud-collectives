# 0018 – Structure: multiple passes, confirmations as proposals, placement of new files

- Status: accepted
- Date: 2026-10-16
- Related: architecture §4.4, §6.1, §7.2, §7.4, §10.2, §14, milestone M5, issue ONC-6 (M5)

## Context

M5 implements all structure and lifecycle cases from §7.4. Five questions were open:

1. Many steps depend on each other: the collective of a new folder only exists after the `POST`, and the note of a leaf page only moves into the folder once the server has made it a parent page. A single plan from one scan cannot anticipate that.
2. Deletions and new collectives need a confirmation, but the planner is pure (no UI).
3. Where does a local file belong in the page tree when there are only folders and file names (folder-note convention, ADR 0004)?
4. What does "deleted locally" mean when a parent page with subpages is affected, and what is a mass deletion?
5. What happens to a file whose page was deleted remotely if it has been changed locally?

## Decision

- **Multiple passes per run (at most 3).** A pass is: scan remote and local, plan, execute. `SyncPlan.followUp` is true if the plan contains structural changes whose consequences only a new scan shows: a new collective (its pages), a collective folder being renamed, a new subpage under a leaf page (the leaf page becomes a parent page, its note must move into the folder), `keepUnlinked` (the file becomes a new page). An error ends the loop. Collectives with a pending folder change are `blocked`: their pages are only planned in the next pass, once vault and state fit together again.
- **Confirmations as proposals.** Besides the operations, `planSync` returns a list `proposals` (`deletePage`, `deleteCollective`, `removeCollectiveLocal`, `newCollective`), each with a stable `id` (`deletePage:<pageId>` etc.). The runner asks (`confirm`) and plans again with the answers (`decisions`). `accept` produces the operation, `reject` restores (the page is pulled as a new remote page, a collective folder is created anew) or keeps the file, `defer` (dialog closed) changes nothing and asks again in the next run. The dialog shows each question as a checkbox, **nothing is pre-checked**; what is not checked is not executed. The planner stays pure, the state is never changed by the planner (it plans on a copy without the forgotten entries).
- **Placement (`src/sync/placement.ts`).** Parent of a file: the page that owns its folder. Search order: (1) known folder page (state: `remoteFileName = Readme.md`) or new remote folder page from the target paths, (2) the note `Folder/Folder.md`, (3) the leaf of the same name next to the folder (`Name.md` next to `Name/`; it becomes a parent page through the new subpage), (4) otherwise the plan creates a **virtual folder page** for the folder (empty, title = folder name, the note `Folder/Folder.md` is created locally). A file that is itself the note of its folder hangs under the page of the folder above it; a page never becomes its own parent. Files directly in the collective folder hang under the start page.
- **Renamed/moved locally.** Title = file name (only if the file name changed relative to the state), parent from the new folder, collective from the top-level folder. If the **folder of a folder page** is renamed (note keeps its name, folder name changes), the page takes the folder name as its title and the note is renamed to `Folder/Folder.md`. If only the note is renamed within its folder, the title changes; in the next pass the folder follows the note (`renameFolderLocal`, provided the name is free), and whatever is in the folder waits until then (added after the manual test). The start page is never moved locally. If the new location is equivalent on the server, only `localPath` in the state is updated. If the server moves a parent page into another collective, its subpages follow; operations for the subpages check the server state and then do nothing.
- **Moved on both sides:** The server wins, `Skip remoteMoveWins` in the log and in the notice.
- **`localPath` in the state** points to the file's current path after every run (M4: it stayed unchanged after a local rename). No schema change.
- **Deleted locally.** If the file of a page the server still lists is missing, the run asks (setting `localDeleteBehaviour = ask`). Questions are asked per **root**: if parent and subpages are deleted, there is one question for the parent page with the number of subpages. On acceptance the page moves to the Collectives trash; subpages whose file still exists stay in the state and are treated as deleted remotely in the next pass. A collision file (never linked) never triggers a `DELETE`, its page is pulled anew. The start page is never deleted but pulled anew. If the page has changed remotely since the last sync (the runner reads the text and compares with `baseHash`; an unreadable text counts as changed), the change wins: no question, the file comes back.
- **Mass-deletion protection (architecture §14):** If a run deletes **at least 3 pages and more than 20 %** of a collective's pages, it asks even with `trashRemote`, and the question carries the numbers. The lower bound of 3 pages supplements the plan: in a collective with four pages every single deletion would otherwise be a "mass deletion".
- **Deleted remotely.** Unchanged file: to the Obsidian trash (`obsidianTrash`) or remove `nc_*` (`keepUnlinked`; the file is uploaded as a new page in the next pass like any new file, decided with the user). **Changed file:** never removed. The executor restores the page from the Collectives trash and merges the content normally. If the page cannot be restored, the file loses its `nc_*` fields and becomes a new page. If the file is gone too, only the state is cleaned up.
- **Restored locally.** A file with `nc_page_id` that is neither in the state nor on the server is checked against the Collectives trash (only if such files exist); found → `PATCH …/trash/{id}`, then `adopt`. Not found → `Skip unknownId`, the file stays untouched.
- **Collectives.** New top-level folder with at least one note → `POST /collectives` (setting `newFolderBehaviour`); the note named like the folder becomes the start page with its text. Folder renamed: detected by the new folder containing the collective's files (by `nc_page_id`); admin/owner (level ≥ 8) → Circles API, otherwise rename the folder back. Folder deleted: admin/owner → confirmation and trash, otherwise restore the folder. Renamed remotely: the folder follows (the server name wins even if renamed on both sides); the start-page note follows the folder name. Deleted/revoked remotely: always ask; acceptance → folder to the trash, rejection → forget the state, the folder is treated like a new folder.
- **Paths that a rename frees up** may be taken by new pages in the same plan (known pages are planned before new ones).

## Alternatives considered

- **One plan with dependencies instead of multiple passes.** The plan would have to anticipate IDs that the server only assigns (new collectives, new pages as parents). A new scan is simpler and more robust but costs requests (at most 3 scans); `followUp` limits this to cases that need it.
- **Confirmations in the executor.** Would bind the executor to the UI and block deletions in the middle of a run; the planner's tests would no longer be sufficient.
- **Rejected deletion by recreating in the executor.** The pull path (`create`) already exists and is tested; a "forgotten state entry" uses it without a second implementation.
- **Cleaning up empty folders after moves.** Deliberately not in M5: folders may contain non-Markdown files and attachments (M8).

## Consequences

- positive: Every case from §7.4 is a planner test (pure function) and an integration test; deletions always need explicit consent (exception `trashRemote` below the mass-deletion threshold, set that way by the user).
- negative / cost: A run can need up to three scans. Permission cases (member instead of admin) are only covered as a unit test because the test server has only one user.
- **No HTTP cache for read accesses:** `GET` and `PROPFIND` send `Cache-Control: no-cache` and `Pragma: no-cache`. Electron (`requestUrl`) otherwise answered WebDAV `GET`s from its cache because Nextcloud sends no `Cache-Control` headers for them: stale ETag, repeated `412` (found in the manual test in Obsidian, not visible in the integration tests with Node `fetch`).
- Follow-up work: M6 resets tags in the target collective after a collective change (they are lost server-side, M0). M8 also cleans up attachment folders on moves.
