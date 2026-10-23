# 0022 – Automation: mutex with re-run flag, silent automatic runs, Login Flow v2, throttled saving

- Status: accepted
- Date: 2026-10-17
- Related: architecture §7.1, §10.1, §12, milestone M9, issue ONC-10

## Context

Until M8 a sync only runs on command. M9 adds triggers (startup, interval, saving, foreground) that must also work on the phone, where there is no background execution and questions in the middle of writing are disruptive. In addition, a first sync of large collectives wrote the entire state after every page (O(N²)).

## Decision

- **Scheduler** (`src/sync/scheduler.ts`, pure, timers injected): startup (2 s after `onLayoutReady`), interval, debounce after changes, foreground (`visibilitychange`, at most every 30 s). It only requests runs.
- **Mutex with re-run flag** in the `SyncController`: runs and conflict resolutions go through a queue. A trigger during a run sets the flag; exactly one further run follows. A manual trigger wins against automatic ones and shows "will run once more afterwards".
- **Automatic runs are silent**: no progress notice, no dialog. The first sync of a non-empty vault is not started, questions (deleting, new folders) are deferred and reported with a hint ("Sync now" asks). Notices only on warning/error and not twice in a row with the same text. No network and missing configuration stay silent.
- **Pause on `AuthError`/`ApiChanged`** (architecture §12): automatic runs stop until the user syncs manually (success) or saves settings.
- **Dirty keys of a run that did not end cleanly** (error, abort, `failed > 0`) go back into the queue.
- **Saving after a change = `modify` event with debounce.** Obsidian has no save event, it saves itself while typing. Own writes (TTL suppression of the `DirtyQueue`) trigger nothing. The run is a full run, not "only this page" (see consequences).
- **Throttled saving** (`src/sync/throttledPersist.ts`): Only the operation `create` saves "lazily" (at most once per second, completion/abort of the run writes afterwards). Everything else (push, structure, conflict copies, new server IDs) stays immediate. A new page can be reassigned from its file (`nc_page_id`) after a crash; a lost `push` or `update` entry would show up as a conflict.
- **Login Flow v2** (`src/api/loginFlow.ts`): `POST /index.php/login/v2`, polling every 2 s up to 20 min. Login URL and poll endpoint must have the same origin (scheme, host, port) as the server URL; otherwise `ApiChangedError`. Only 404 counts as "not finished yet". Between polls it waits for a timer **or** return to the foreground (Android freezes timers while the browser is in front). The app password goes directly into the secret storage, never into logs or `data.json`. Fallback link next to the cancel button in case `window.open` is blocked.

## Alternatives considered

- **Keep immediate saving** – with 500 pages about 500 serializations of the state; measured values are recorded with milestone M9 (git history).
- **Automatic runs with dialogs** – dialogs appear at random times (also in a background window) and block writing.
- **Run "only this page" after saving** – would extend planner and remote scan by a filter; the full run is cheap for unchanged pages (one request per collective), and the filter can be added in M10 if needed.
- **Interval on desktop only** – on the phone the timer fires only in the foreground, so it does no harm; the user keeps the choice through the setting.

## Consequences

- positive: Runs never overlap; the user is not interrupted on the phone; large first syncs write the state rarely.
- negative / cost: Deletions are only confirmed after a manual run. A crash within the lazy second costs the assignment of the most recently created pages (restored from the file on the next run).
- Follow-up work: "Sync current page" as a command (M10); update the conflict copy when the server changes again (note from M4, not part of M9).
