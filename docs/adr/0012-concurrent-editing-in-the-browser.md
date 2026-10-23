# 0012 – Concurrent editing in the browser: ETag protection, no session handling

- Status: accepted
- Date: 2026-10-16
- Related: architecture §2 (non-goal real-time collaboration), §14, ONC-1

## Context

Collectives pages are edited in the browser with the Text editor (collaborative session, autosave after a few seconds). The plugin writes to the same file via WebDAV. Manual check on 2026-10-16 (Nextcloud 33.0.10, Text 7.0.1), two runs:

1. The browser types `BROWSER-2`, autosave lands in the file.
2. The plugin reads the file (including `BROWSER-2`) and writes a changed version via `PUT` with `If-Match`.
3. A few seconds later (at the editor's next sync poll) the browser shows "Editing session has expired. Please reload the page." with a "Reload" button.
4. The editor still lets you type (`BROWSER-3`) and repeats the message, but saves nothing any more: the file's ETag remains the one from the plugin's PUT.
5. After "Reload" the browser shows the plugin's version including `BROWSER-2`; `BROWSER-3` is lost.

## Decision

- The plugin does not intervene in Text sessions (no use of the session/Yjs API, non-goal for v1).
- Protection on the plugin side exclusively via `If-Match`: if the browser has saved since the last read, the `PUT` fails with 412 → conflict file, no overwriting.
- Push only after debounce (architecture §7.1) and only on actual change, to keep the time window small.
- README and settings point out: anyone who has a page open in the browser at the same time must reload after the "Editing session has expired" message; anything typed afterwards is lost.

## Alternatives considered

- **Detect open sessions and hold back the push** – needs the internal session API of the Text app, undocumented, version risk.
- **Write content through the Text session** (Yjs steps) – high effort, explicitly a non-goal for v1.

## Consequences

- No silent data loss on the plugin side; the remaining loss (input in the browser after the warning) is visible to the user.
- Risk made more precise in architecture §14. A later ADR can add session detection if this proves a nuisance in practice.
