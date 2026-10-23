# 0017 – Push: confirmed ETags, decision as a pure function, conflict resolution via the state

- Status: accepted
- Date: 2026-10-16
- Related: architecture §6.3, §7.3, §7.6, §8, §10.2, milestone M4, `docs/api-notes.md` §10a, issue ONC-5 (M4)

## Context

M4 uploads local changes. Four questions were open:

1. **ETag one-second resolution** (proven in M2): Nextcloud derives the ETag from the mtime in whole seconds. If another client writes in the same second in which the plugin reads, the ETag stays the same. A later `PUT` with `If-Match` would overwrite that change. Conversely, a write in the same second *after* the plugin's `PUT` can remain invisible.
2. Where is the decision from table 7.3 (locally/remotely changed) made when pull, push and the strategies `preferLocal`/`preferRemote` come together?
3. How do "Keep local" and "Take remote" work in the conflict dialog without building a second sync logic next to the run?
4. How are the plugin's own writes distinguished from user changes (architecture §7.6)?

## Decision

- **Confirmed ETags.** An ETag read via `GET` counts as confirmed if the second of `Last-Modified` lies before the second of `Date` of the same response. Then any later write changes the second and thereby the ETag, so `If-Match` protects. If one of the headers is missing, the ETag counts as unconfirmed.
  - Unconfirmed state: `remoteMtime` is stored in the state as `-1` (`UNCONFIRMED_REMOTE_MTIME`). The next run then reads the page again and compares hashes. No schema change is needed.
  - If a push is to be made on the basis of an unconfirmed ETag, the run waits 1.1 s and reads again. If the state stays unconfirmed, the push is deferred to the next run.
  - After the plugin's own `PUT` the state is **always** unconfirmed. The next run checks it with a `GET` and hash comparison but writes nothing. Only the run after that is an idle run without content requests. This way even a browser write in the second after the plugin's `PUT` does not go unnoticed.
  - If the ETag is missing from a successful `PUT` response, it is fetched afterwards with a depth-0 `PROPFIND`.
- **Decision as a pure function** `decideContent` in `src/sync/decide.ts` (under the ESLint purity rule): inputs are `baseHash`, `localHash`, `remoteHash`, page status and strategy. The output is `none`/`push`/`pull`/`adoptBase`/`conflict`. The executor only carries out. For pages with status `conflict`/`collision`, `conflictFile` always applies, and `push` becomes `none`. Such pages are only uploaded after resolution.
- **Strategies** `conflictFile` (default), `preferLocal`, `preferRemote` as a setting. The two `prefer` strategies overwrite the other side without asking. The consent lies in the selection in the setting; the description there says so explicitly.
- **Planner**: `planPull` is now called `planSync`. A known page gets the operation `push` if it is unchanged remotely (listing `timestamp`/`size` = state) and a local candidate exists. A candidate is a file whose mtime differs from `localMtime` or that is in the dirty queue. Whether anything is really uploaded is decided only by the hash. A differing mtime with identical content only leads to a new `localMtime`. This makes the open M3 question whether `file.stat.mtime` is current directly after `vault.process` uncritical.
- **Conflict resolution as a state transition** (`src/sync/conflicts.ts`). The dialog only changes the state; a normal sync follows:
  - **Base of a conflict**: When the executor creates a conflict copy, `baseHash` becomes the hash of exactly this remote version. As long as nothing changes remotely, the page therefore counts as changed locally only. A conflict from an unconfirmed `GET` therefore does not produce a second copy in the next run (review finding).
  - "Keep local": `status: synced`, `localMtime: -1`, the base stays the remote version at the time of the conflict. The next run uploads the local file regardless of the strategy, as long as the remote version has not changed again. If it has changed again (also via `412` on upload), the configured strategy decides as for any change on both sides: `conflictFile` creates a new conflict, `preferRemote` takes the server version (decided that way by the user). States from before M4 with `baseHash: ''` use the hash of the conflict copy as a substitute.
  - "Take remote": `status: synced`, `baseHash` = hash of the current local file, `remoteMtime: -1`. The next run reads remotely, sees "changed remotely only" and overwrites the local file via `vault.process`, only if it did not change between reading and writing.
  - For collisions (user file without `nc_page_id`), the resolution first writes minimal `nc_*` fields into the file. `metaHash: ''` ensures that the next run sets the full fields.
  - After resolution the conflict copy is moved to the trash via `fileManager.trashFile`, as configured in Obsidian. The choice in the dialog counts as asking first in the sense of AGENTS rule 4.
- **Own writes** (`src/sync/dirtyQueue.ts`): The run's vault port marks every path as suppressed for 5 s before `create`/`process`. The mark is not consumed by the first event (pattern from Nextcloud Sync, `docs/api-notes.md` §11). `modify` events on other paths land in the dirty queue, which the next run empties. Automatic triggers (debounce after saving) remain M9.

## Alternatives considered

- **Defer push as long as the remote mtime is younger than 2 s** – no waiting in the run, but a manual sync then apparently does nothing. Rejected by the user.
- **Own field `remoteConfirmed` in the state** – easier to read, but requires a new `schemaVersion` with migration. The sentinel `-1` forces the same check via the existing mtime comparison.
- **"Keep local" with `baseHash: ''`** (first version) – with an unconfirmed conflict state, both sides then counted as changed. With `conflictFile` the choice was lost, with `preferRemote` the local file was overwritten. Found in review and rejected.
- **After a dialog decision always a new conflict instead of the strategy** – would need an additional state field (schema change). Rejected by the user: the strategy applies.
- **Conflict resolution directly in the dialog** (immediate `PUT` or overwriting the file) – that would be a second write logic next to the executor, with its own ETag and race handling. With the state transition the same protections apply as in the run.
- **Leave the conflict copy in place** – safer, but the vault fills up with resolved copies. Rejected by the user.

## Consequences

- positive: no silent overwriting for writes in the same second; pull, push and strategies follow a single, fully unit-tested decision table; no ping-pong after the push.
- negative / cost: After every push, the following run costs one `GET` per uploaded page. In rare cases a run waits 1.1 s per page. With `preferRemote`, local changes can be lost without a copy. This is intended and explained in the setting.
- `localPath` in the state means "the path at which the plugin last created or linked the file". Content sync does not update it after a local rename; it stays the basis of rename detection in M5. The current file is found via `nc_page_id`, also in the conflict dialog.
- A resolution only applies to the conflict copy that the dialog showed. If a run has meanwhile created a newer copy, the choice is discarded and the list is reloaded.
- Follow-up work: M5 (new local files, structural cases; do not upload collision files as a new page), M6 (metadata push), M9 (debounce after saving uses the dirty queue as a trigger).
