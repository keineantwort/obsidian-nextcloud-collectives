**English** | [Deutsch](../de/commands.md)

# Commands and menus

[Manual](README.md) › Commands and menus

## Commands

Open the command palette (Ctrl/Cmd+P) and type "Nextcloud Collectives Sync". You can give each command a hotkey under "Settings › Hotkeys".

| Command | What it does |
|---|---|
| **Sync now** | Syncs all collectives right away. Shows progress and a summary, and asks open questions (deletions, new collectives, the first sync of a vault with content). See [When the plugin syncs](sync.md#manual-runs). |
| **Show conflicts** | Opens the conflict dialog. If there is no conflict: "There are no open conflicts." See [Conflicts](conflicts.md#the-conflict-dialog). |
| **Set page emoji** | Opens the emoji dialog for the open note. Without an open note: "Open a note first." See [Emoji and tags](tags-emoji-links-attachments.md#setting-the-emoji). |
| **Rename page** | Renames the page of the open note. For a page with sub-pages, the note and its folder are renamed together. |
| **Show log** | Shows the log of this session. See [Troubleshooting](troubleshooting.md#the-log). |

### Rename page

The dialog **Rename page** asks for the "New name". If the name is empty or a note or folder with that name already exists, it tells you and does not rename. After **Rename** you see "Page renamed. The change is sent with the next sync."

Notes that are not synced pages, and the start page of a collective, cannot be renamed this way. If you try, you see "This is not a note of a synced page, or it is the start page of a collective (rename its folder instead)." To rename a collective, rename its top-level folder; see [Structure](structure.md).

You can also rename notes and folders the usual way in Obsidian. The plugin notices it in the next sync. The command saves you from renaming the note and its folder separately.

## Ribbon icon

The icon **Sync with Nextcloud Collectives** (two circular arrows) in the ribbon does the same as **Sync now**. On phones, you find it in the ribbon menu.

## Context menus

Right-click (or long-press on a phone) a synced note or the folder of a page in the file list:

- **Set page emoji…**: the same as the command **Set page emoji**, for this page.
- **Rename page…**: the same as the command **Rename page**, for this page. Not shown for the start page of a collective.

The same entries are in the editor menu of a synced note (the "…" menu, or right-click in the text).

## Status bar

On desktop, the status bar shows `NC` with the state of the sync, for example `NC ✓ 14:05`. A click syncs now, or opens the conflict dialog if there are open conflicts. The meaning of each state is in [When the plugin syncs](sync.md#status-bar). Phones have no status bar.
