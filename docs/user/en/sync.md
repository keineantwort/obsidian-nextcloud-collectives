**English** | [Deutsch](../de/sync.md)

# When the plugin syncs

[Manual](README.md) › When the plugin syncs

Every sync is a full run: the plugin compares all collectives on the server with the vault, in both directions. Only one run happens at a time. If a sync is requested while one is running, one more run follows when it is done.

## Triggers

| Trigger | When | Setting |
|---|---|---|
| Startup | About 2 seconds after Obsidian has loaded the vault. | [Sync on startup](settings.md#sync-on-startup) (default: on) |
| Interval | Every few minutes while Obsidian is open. | [Sync interval (minutes)](settings.md#sync-interval-minutes) (default: 5, 0 = off) |
| After changes | A few seconds after you last changed, created, renamed or deleted a synced note. Every further change restarts the wait. | [Sync after changes](settings.md#sync-after-changes) (default: on) and [Wait after the last change (seconds)](settings.md#wait-after-the-last-change-seconds) (default: 10) |
| Back in the foreground | When Obsidian becomes visible again, for example when you switch back to the app on your phone. At most once within 30 seconds of the last automatic sync request. | none, always on |
| Manual | Command **Sync now**, the ribbon icon **Sync with Nextcloud Collectives**, or a click on the status bar. | – |

Obsidian saves while you type, so there is no separate save action. "After changes" therefore waits until you have stopped typing for the set number of seconds.

On a phone, the operating system suspends Obsidian in the background, so timers do not run there. The sync when you come back is what keeps the phone up to date.

## Manual runs

A manual run shows "Syncing with Nextcloud …" while it runs and a summary at the end, for example:

> Sync complete. New: 2 · Updated: 1 · Uploaded: 1 · Unchanged: 40

The parts of the summary:

| Text | Meaning |
|---|---|
| New | Pages downloaded for the first time. |
| Updated | Notes updated with the server's text. |
| Uploaded | Your changes sent to the server. |
| Metadata only | Only emoji or tags changed on the server. |
| Emoji/tags sent | Your emoji or tag changes sent to the server. |
| Uploaded as new | New notes uploaded as new pages. |
| Moved or renamed | Pages moved or renamed, in either direction. |
| Moved to the Collectives trash | Pages or collectives deleted on the server (they can be restored there). |
| Removed here | Notes or folders moved to the trash in the vault. |
| Restored | Pages restored from the Collectives trash. |
| Attachments | Attachment files transferred or deleted. |
| Unchanged | Pages with nothing to do. |

Further lines tell you about conflicts, pages that failed, and other things you should know. Summaries without problems disappear by themselves; warnings and errors stay until you close them.

Questions such as "delete this page on the server?" open a dialog during a manual run; see [Structure](structure.md#the-confirmation-dialog).

If you start a manual sync while one is running, you see "A sync is already running. It will run once more afterwards."

## Automatic runs are quiet

Runs started by startup, interval, changes or the foreground do not interrupt you:

- No progress message and no summary if everything went fine. A message only appears for warnings and errors, and the same message is not repeated run after run.
- No dialogs. Questions are put off, and the run does everything else. You see "Some changes need your decision. Run “Sync now” to answer." Run **Sync now** to answer the questions.
- The first sync of a vault with content is never started automatically; see [Getting started](getting-started.md#vault-with-content).
- No network (normal on a phone) and missing sign-in details produce no message. The next run tries again.

### Paused runs

If the server rejects the username or app password, or answers in a way the plugin does not understand, automatic runs pause. You see the error once. They resume when you change something in the plugin settings (for example sign in again or enter a new app password), or after a manual sync that completes without failed pages. Manual syncs always run, even while automatic runs are paused.

## Status bar

On desktop, the status bar shows the state of the sync. On phones, Obsidian has no status bar; use the commands instead.

| Text | Meaning | Click |
|---|---|---|
| `NC –` | Not synced since Obsidian started. | Syncs now. |
| `NC ⟳` | A sync is running. | – |
| `NC ✓ 14:05` | Last sync at that time. | Syncs now. |
| `NC ⚠︎ 2` | Number of open conflicts. | Opens the conflict dialog. |
| `NC ✕` | The last sync failed. | Opens the conflict dialog if there are open conflicts, else syncs now. |

If you hover over the status bar, it shows the full sentence, for example "Nextcloud Collectives: last sync at 14:05. 2 open conflicts. Click to show conflicts."

## What is not synced

- Notes directly in the vault folder, outside a collective folder. The log notes how many there are.
- Folders and files whose name starts with a dot, and Obsidian's configuration folder.
- Conflict copies (files with "(Conflict …)" or "(Konflikt …)" in the name).
- Files that are not Markdown notes (`.md`), unless a synced note embeds them as an attachment. Canvases (`.canvas`) and bases (`.base`) are not synced.
- Attachments larger than the setting [Largest attachment (MB)](settings.md#largest-attachment-mb).
- Top-level folders, if the setting [New top-level folders](settings.md#new-top-level-folders) is "Ignore the folder".
