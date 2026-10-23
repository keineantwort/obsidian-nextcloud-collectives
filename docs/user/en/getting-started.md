**English** | [Deutsch](../de/getting-started.md)

# Getting started

[Manual](README.md) › Getting started

## Before you start

- Install the plugin as described on the [main page](../../../README.md#installation).
- **Make a backup** of your vault folder, and of important collectives on the server. The plugin writes in both directions.
- **Use a new, empty vault** if you can. Then the first sync only downloads your collectives and nothing in the vault is mixed with them.

A vault is bound to one Nextcloud server and one account. To sync another server or another account, create another vault.

## Sign in

Open "Settings › Nextcloud Collectives Sync". The section **Connection** has everything you need.

1. Enter the **Server URL**, the address of your Nextcloud, for example `https://cloud.example.com`. If you leave out `https://`, the plugin adds it. If Nextcloud runs under a sub-path (`https://example.com/nextcloud`), enter that path too.
2. Sign in in one of two ways:
   - **Sign in with the browser** (recommended): choose **Sign in**. Your Nextcloud login page opens in the browser. Log in there and allow the access. Back in Obsidian, username and app password are filled in, and the settings show "Signed in as …". If the browser did not open, use the link "Open the login page again". The login page expires after 20 minutes. While the plugin waits, the button reads **Cancel**.
   - **App password by hand**: in Nextcloud, create an app password under "Personal settings › Security". In Obsidian, enter your **Username** and paste the app password into **App password**. The field saves when you leave it or press Enter, and then shows "Saved – type to replace".
3. Choose **Test connection**. The button is available once server URL, username and app password are all set. If everything is fine, you see "Connection successful: … collectives found." Otherwise you see what is wrong; see [Troubleshooting](troubleshooting.md#connection-test-and-sign-in).

The app password is kept in Obsidian's secret storage, not in the plugin settings, and it never appears in the log. Your main Nextcloud password is never stored.

With `http://` instead of `https://`, the settings warn you that the app password is sent unencrypted, and the browser sign-in refuses to start. Addresses on your own device (`localhost`, `127.0.0.1`) are exempt.

## The first sync

Run the command **Sync now** or click the ribbon icon **Sync with Nextcloud Collectives**. While it runs, you see "Syncing with Nextcloud …", and at the end a summary such as "Sync complete. New: 42".

### Empty vault

A vault counts as empty if it contains nothing besides Obsidian's configuration folder (`.obsidian`). The first sync then downloads all pages of all your collectives without asking. This also happens if the first sync is started automatically (for example by the interval).

### Vault with content

If the vault already contains files or folders, the plugin asks first. The dialog **This vault is not empty** explains what happens:

- Each collective becomes a folder at the top level of the vault. Existing folders with the same name are merged.
- If a page has the same name as an existing file, your file stays unchanged. The server version is saved next to it as "Title (Conflict YYYY-MM-DD HHmm).md". This is called a collision; see [Conflicts](conflicts.md#collisions).
- Nothing is deleted or overwritten. Notes without a page ID are uploaded to Nextcloud as new pages, and a new top-level folder becomes a new collective.

Choose **Merge** to go on, or **Cancel** (the default button; Esc does the same) to stop. After Cancel, you see "Sync cancelled. Nothing was changed."

Automatic runs never start this merge. Until you run **Sync now** once and confirm it, an automatic run shows "Automatic sync is waiting for the first sync of this vault. Run “Sync now” once to start it."

Before you merge, check the setting [New top-level folders](settings.md#new-top-level-folders): by default, every top-level folder with notes becomes a new collective on the server.

## What your vault looks like afterwards

Each collective is a folder at the top level of the vault. A page with sub-pages is a folder with a note of the same name inside. Example:

| In Collectives | In the vault |
|---|---|
| Collective "Handbook" | Folder `Handbook/` |
| Its start page | `Handbook/Handbook.md` |
| Page "Onboarding" (no sub-pages) | `Handbook/Onboarding.md` |
| Page "Processes" with sub-pages | `Handbook/Processes/Processes.md` |
| Sub-page "Holidays" of "Processes" | `Handbook/Processes/Holidays.md` |
| Images and files of a page | `Handbook/_attachments/Onboarding/…` (setting [Attachment folder](settings.md#attachment-folder)) |

By default, the note of a folder is shown first in its folder, and the page emoji is shown in front of the title in the file list and in the note header. Both only change the display, not the files.

### Properties of the plugin

Each synced note has a few properties (frontmatter) that the plugin manages:

| Property | Shown as | Meaning |
|---|---|---|
| `nc_page_id` | Page ID | The ID of the page on the server. It links the note to its page. |
| `nc_collective_id` | Collective ID | The ID of the collective. |
| `nc_emoji` | Emoji | The page emoji, if the page has one. |
| `nc_title` | Page title | Only if the page title cannot be used as a file name as it is, for example because it contains `#`, `^`, `[` or `]`. Those characters are replaced by `_` in the file name. |
| `tags` | (Obsidian's tags) | The tags of the page. |

The `nc_…` properties are hidden by default (setting [Hide the plugin’s properties](settings.md#hide-the-plugins-properties)). Do not edit or delete `nc_page_id`: without it, the plugin treats the note as a new page and uploads it again.

Other properties you add yourself are uploaded as part of the page text. Collectives shows them as text at the top of the page.

## Next steps

- [When the plugin syncs](sync.md): from now on the plugin syncs by itself.
- [Structure](structure.md): what happens when you create, rename, move or delete notes and folders.
- [Settings](settings.md): all options.
