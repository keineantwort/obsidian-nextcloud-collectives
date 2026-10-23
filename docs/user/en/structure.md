**English** | [Deutsch](../de/structure.md)

# Structure: new, renamed, moved and deleted pages

[Manual](README.md) › Structure

The plugin syncs the structure too, not only the text. Each collective is a folder at the top level of the vault. A page with sub-pages is a folder with a note of the same name inside (`Handbook/Processes/Processes.md`). The note's property `nc_page_id` tells the plugin which page a note belongs to, so a note keeps its page wherever you move it.

## Changes in the vault

| You do this in the vault … | … and this happens on the server |
|---|---|
| Create a new note in a collective folder | It is uploaded as a new page, and its `nc_page_id` is written into the note. The page goes under the page that owns its folder. If the folder has no note of its own, the plugin creates a page for the folder (with an empty note). |
| Create a folder next to a note with the same name and put a new note into it (`Onboarding.md` and `Onboarding/New.md`) | The new note becomes a sub-page of "Onboarding". The plugin then moves `Onboarding.md` into the folder (`Onboarding/Onboarding.md`). |
| Rename a note, or move it to another folder | The page is renamed or moved, also into another collective. ID and emoji stay; the note's tags are assigned again in the new collective. |
| Rename the folder of a page with sub-pages, or only the note inside | The page takes the name of the folder or the note; folder and note end up with the same name. |
| Create a new folder at the top level and put notes in it | A new collective is created (setting [New top-level folders](settings.md#new-top-level-folders)). The note with the same name as the folder becomes its start page. |
| Rename the folder of a collective | The collective is renamed. Only admins and owners of the collective may do that; otherwise the folder is renamed back and you see "You may not rename a collective. The folder name was reset." |
| Delete a note or a folder | The plugin **asks** before a page goes to the Collectives trash on the server (setting [Deleting notes in this vault](settings.md#deleting-notes-in-this-vault)). A page with sub-pages is deleted together with its sub-pages. |
| Delete the folder of a collective | The plugin always asks before the collective goes to the trash on the server. Only admins and owners may delete a collective; otherwise the folder is restored and you see "You may not delete a collective. The folder was restored." |
| Put a deleted note back into the vault (with its `nc_page_id`) | The page is restored from the Collectives trash. |

Use the menu entry **Rename page…** (or the command **Rename page**) to rename a page with sub-pages: it renames the note and its folder together. See [Commands and menus](commands.md).

## Changes on the server

- A page that was renamed or moved on the server is renamed or moved in the vault. Obsidian updates the links to it.
- If you and someone on the server moved the same page to different places, the server's place wins. You see "1 page was moved on both sides. The server’s location was used."
- A page deleted on the server is moved to the trash in the vault, as set in Obsidian (setting [Pages deleted on the server](settings.md#pages-deleted-on-the-server); "Keep the file" uploads it again as a new page).
- If you changed the note since the last sync, it is **never** removed. Instead, the page is restored from the Collectives trash and your change is uploaded.
- If a page was changed on the server while you deleted it in the vault, it comes back without asking: the change wins.
- A new collective on the server becomes a new top-level folder.
- A collective that was deleted on the server, or that you left, is only removed from the vault after you confirm. If you leave it unticked and choose **Apply**, the folder stays and the plugin forgets that it belonged to the old collective. From then on it is treated like a new top-level folder, so with the default setting it is uploaded as a new collective.

## The confirmation dialog

Questions are collected in one dialog, **Confirm changes**, grouped under "Deleted in the vault", "Deleted on the server" and "New in the vault". Each row says what happens if you tick it, for example "Delete page “Holidays” on the server", with its path and the number of sub-pages.

- **Nothing is ticked at first.** What you tick happens; what you leave unticked does not. A page you deleted in the vault and leave unticked comes back into the vault.
- **Check all** and **Uncheck all** change all boxes at once.
- **Apply** carries out your choice.
- **Ask later**, Esc or closing the dialog changes nothing. The plugin asks again in the next sync.

Automatic syncs do not open this dialog. They put the questions off until you run **Sync now**; see [When the plugin syncs](sync.md#automatic-runs-are-quiet).

## Mass-deletion guard

If you delete at least 3 pages and more than 20 % of the pages of a collective at once, the plugin always asks, even with the setting "Move to the Collectives trash without asking". The row shows a warning such as "12 of 40 pages of “Handbook”".

## Trash on both sides

Nothing is deleted for good:

- On the server, pages and collectives go to the Collectives trash, where you can restore them.
- In the vault, notes and folders go to the trash as set in Obsidian ("Settings › Files and links › Deleted files").

## Names

Some characters are not allowed in Obsidian file names (`* " \ / < > : | ? # ^ [ ]`). If a page title contains one, the file name gets `_` instead and the real title is kept in the property `nc_title`. If two pages would end up with the same file name, the second one gets a number, such as `Holidays (2).md`.
