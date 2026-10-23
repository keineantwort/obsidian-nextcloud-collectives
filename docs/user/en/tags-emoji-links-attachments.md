**English** | [Deutsch](../de/tags-emoji-links-attachments.md)

# Emoji, tags, links and attachments

[Manual](README.md) › Emoji, tags, links and attachments

## Emoji and tags

The emoji (`nc_emoji`) and the tags (Obsidian's property `tags`) of a page are in the note's properties and are synced in both directions.

- If you change them in the note, they go to the server with the next sync. Tags that the collective does not have yet are created there. Existing tags are matched without regard to upper and lower case.
- If they were changed both on the server and in the note, the setting [Conflicts](settings.md#conflicts) decides, as for a text change: a conflict copy (the note stays as it is, the server's values are in the copy), or the version of this vault or of the server wins.

### Setting the emoji

The easiest way is the command **Set page emoji**, or **Set page emoji…** in the context menu of a note or a folder (and in the editor menu). The dialog **Page emoji** offers emoji in groups and a field "Emoji (exactly one)". Choose **Apply**, or **Remove emoji** to take it away. The emoji is saved in the note and sent with the next sync.

If you add an empty property `Emoji` to the note you are editing, the same dialog opens.

Only exactly one emoji is allowed. Anything else (text, several emoji) is not sent, and the sync tells you: "One note has an emoji property that is not a single emoji: it was not sent."

In the file list, a folder shows the emoji of its page, and the emoji is shown in front of the note's title (setting [Show page emoji in titles](settings.md#show-page-emoji-in-titles)). That only changes the display, not the file name.

### Tags

- The tags are Obsidian's property `tags`. `#tags` in the text count too and are added to the property. If you remove a `#tag` from the text, the tag stays until you delete it from the property.
- A space in a tag name on the server shows up as `-` in Obsidian, because Obsidian tags cannot contain spaces. A `-` stays a `-`, even if you type it anew in Obsidian.
- The tags appear in Collectives as tags, not as text in the page.
- If you move a note into another collective, its tags are assigned again in that collective.

The plugin's own properties (`nc_…`) are hidden by default; see [Hide the plugin’s properties](settings.md#hide-the-plugins-properties). The `tags` property stays visible.

## Links

Links between pages are converted in both directions:

| In the vault | On the server |
|---|---|
| `[[Page]]`, `[[Page\|Text]]`, `[[Page#Heading]]` to a synced page | A Collectives link to the page, which the Collectives editor can follow |
| Markdown link to a note, such as `[Text](Page.md)` | The same; it comes back as a wikilink |

Links written on the server (with the link picker of Collectives or by hand) become wikilinks in the vault, such as `[[Handbook/Processes/Holidays|Text]]`. The text after `|` only appears if it differs from the page title.

Things to know:

- Links to pages in another collective work too, as long as they point to the same server.
- Anchors (`#heading`) are kept as they are. A link to a heading with spaces or special characters may not jump to the exact heading in Obsidian or in Collectives; the link to the page still works.
- Links that cannot be resolved (external links, pages you have no access to, files outside the collectives) are left as they are. A wikilink to a note outside the synced folders stays `[[…]]` in the page text.
- Code blocks, inline code and the properties are never changed.
- A wikilink to a page that only gets created in the same sync is converted in the next sync.
- If a linked page is renamed, the link text in the pages that link to it changes too. This can cause one extra upload of those pages.

## Attachments

Images and other files that a note embeds (`![[photo.png]]` or `![](photo.png)`) are synced with the page.

### From the server into the vault

Attachments of a page are downloaded into a folder next to the note, by default `_attachments/<note name>/` (setting [Attachment folder](settings.md#attachment-folder)). For `Handbook/Onboarding.md` that is `Handbook/_attachments/Onboarding/`. The embed in the note points there.

### From the vault to the server

Files you embed in a note are uploaded as attachments of the page. They stay where they are in the vault; the plugin does not move them. Only these files are uploaded:

- files inside the folder of the same collective, and
- files directly in the vault folder (where Obsidian puts pasted images by default).

If you use another attachment folder in Obsidian ("Settings › Files and links › Default location for new attachments"), choose one inside the collective, for example "Same folder as current file" or a subfolder.

A new note with an image first goes to the server with the embed as it is; the file is uploaded and the link converted in the next sync.

### Size limit

Files larger than [Largest attachment (MB)](settings.md#largest-attachment-mb) (default 20 MB) are neither uploaded nor downloaded. The embed of a file that is too large stays `![[…]]` in the page text.

### Changes and deletions

- If an attachment changes on the server and you did not change it in the vault, the vault file is replaced. If you changed it, your file stays and the server's file is saved next to it as a conflict copy.
- If you change an existing attachment in the vault, the change is **not** uploaded.
- If an attachment is deleted on the server, the vault file goes to the trash, but only if you did not change it, and not if [Pages deleted on the server](settings.md#pages-deleted-on-the-server) is set to keep files.
- If you delete an attachment in the vault and no note embeds it any more, it is also moved to the Collectives trash on the server (setting [Delete attachments on the server](settings.md#delete-attachments-on-the-server), default on). If the note still embeds it, it is downloaded again.
- Attachments are not moved along when you rename or move a note. The embed keeps working.

### Limits

- If the same file is embedded in several pages, it is uploaded once for each page.
- If two embedded files of one page have the same name (in different folders), only one is uploaded.
- Plain links to attachments that are not embeds (such as `[Report](.attachments.123/report.pdf)` on the server) are neither converted nor downloaded.
- Files whose name contains `[ ] | # ^` are downloaded but not embedded as wikilinks.
