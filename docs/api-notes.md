# API notes (result of M0)

Status: 2026-10-16 · Issue: ONC-1 · Branch: `m0-verifikation`

All statements were verified against the local Docker test server (`scripts/dev-nextcloud/`), additionally backed by reading the Collectives source code at tag `v4.7.1`. Reproducible with:

```bash
scripts/dev-nextcloud/down.sh --reset && scripts/dev-nextcloud/up.sh
node scripts/m0-spike/record-fixtures.mjs     # writes tests/fixtures/m0/ and findings.json
```

## 1. Tested versions

| Component | Version |
|---|---|
| Nextcloud | 33.0.10 (image `nextcloud:33-apache`, SQLite) |
| Collectives | 4.7.1 |
| Circles (Teams) | 33.0.0 |
| Text | 7.0.1 |
| Obsidian API (`obsidian` npm) | 1.14.4 newest; Secret Storage from 1.11.4 |

Collectives does **not** appear in `/ocs/v2.php/cloud/capabilities`. The app version cannot be queried by normal users (`/ocs/v1.php/cloud/apps/collectives` → 403 "must be an admin"). Consequence for the version check ([architecture §12](architecture.md)): only check the Nextcloud version from the capabilities. We secure Collectives compatibility through structural validation of the responses (`ApiChanged`).

## 2. Basics

- OCS base, headers and the `{ ocs: { meta, data } }` envelope as planned. Errors arrive as an HTTP status (400/403/404) with `ocs.data` = `[]` or an empty body.
- `collectivePath` is configurable per user. The default is the **hidden** folder `.Collectives/<name>`. Always assemble the WebDAV path from `collectivePath` + `filePath` + `fileName`, never hard-code it.
- Page ID = file ID of the Markdown file (confirmed). The `OC-FileId` header has the form `00000102ociwh6q3y314`: the file ID padded with zeros, followed by the instance ID.

## 3. Endpoints ([architecture §4.2](architecture.md))

| Endpoint | Result |
|---|---|
| `GET /collectives` | `{ collectives: Collective[] }`. Relevant fields: `id`, `circleId`, `name`, `slug`, `emoji`, `level`, `canEdit`, `trashTimestamp` |
| `POST /collectives` | `name`, `emoji?` ✔ → `{ collective, info }`. Creates the landing page `Readme.md` with a welcome text |
| `PUT /collectives/{id}` | **`emoji` only**, no renaming |
| Rename collective | via Circles: `PUT /ocs/v2.php/apps/circles/circles/{circleId}/name` with `{ "value": "New name" }` ✔. The collective ID stays; `name`, `slug` and the WebDAV folder change with it |
| `DELETE /collectives/{id}` | moves to the Collectives trash. **Circle admin/owner only** (level ≥ 8); members get 403 ✔ |
| `GET /collectives/trash`, `PATCH /collectives/trash/{id}` | trash list or restore ✔. `DELETE /collectives/trash/{id}` deletes permanently and is never called by the plugin |
| `GET …/pages` | `{ pages: PageInfo[] }` ✔ |
| `GET …/pages/{id}` | `{ page }` ✔ |
| `POST …/pages/{parentId}` | `title` ✔ → `{ page }`. The server sanitizes the title (see §6) |
| `GET …/pages/{id}/touch` | works, but is **not needed** (see §5) |
| `PUT …/pages/{id}` | `title` and/or `parentId` ✔. The file ID stays |
| `PUT …/pages/{id}/to/{newCId}` | ✔, response `data: []`. ID and emoji stay, **tags are lost** (tags belong to the collective) |
| `PUT …/pages/{id}/emoji` | `emoji` as a string ✔. **To remove: send `""`.** `null` responds with `emoji: null` but stores nothing (the next `GET` returns the old emoji; verified in M6, corrected M0). After removal the page list reports `""`. The same applies to `PUT /collectives/{id}` |
| `PUT`/`DELETE …/pages/{id}/tags/{tagId}` | ✔, idempotent (adding/removing twice → 200) |
| `DELETE …/pages/{id}` | to the trash ✔. A parent page takes subpages and attachments with it |
| `GET …/pages/trash` | ✔. For leaf pages, `fileName` in the trash carries the suffix `.d<timestamp>` |
| `PATCH …/pages/trash/{id}` | restore ✔, including subpages and attachments |
| `GET …/tags` | `{ tags: [{ id, collectiveId, name, color }] }` |
| `POST …/tags` | `name` **and** `color` are required. `color` = 6 hex characters **without `#`** or `""`. Duplicate → 400. Names are case-sensitive on SQLite (`Project` ≠ `project`), possibly not on MySQL depending on the collation. So check case-insensitively against the tag cache before creating |
| `GET …/pages/{id}/attachments` | `{ attachments: [{ id, name, filesize, mimetype, timestamp, path, src, internalPath, hasPreview, type }] }`. **No ETag**: fetch ETags via PROPFIND |
| `POST …/pages/{id}/attachments` | Multipart, field `file` ✔. On a name collision the server renames: `name (1).ext` |
| `DELETE …/pages/{id}/attachments/{attId}` | ✔ (attachment ends up in the trash, restore via `PATCH …/attachments/trash/{attId}`) |

Also present and interesting for later: `PUT …/attachments/{attId}` (rename), `PATCH …/attachments/trash/{attId}`, `GET /collectives/{cId}/search?searchString=…`.

## 4. PageInfo ([architecture §4.3](architecture.md))

Full fields (fixture `pages-list-final.json`): `id`, `slug`, `lastUserId`, `lastUserDisplayName`, `emoji`, `subpageOrder`, `isFullWidth`, `tags` (**list of tag IDs** ✔), `trashTimestamp`, `title`, `timestamp` (mtime, Unix seconds), `size`, `fileName`, `filePath` (relative to the collective, `""` for the root level), `filePathString`, `collectivePath`, `collectiveNameWithEmoji`, `parentId`, `shareToken`, `linkedPageIds`.

Peculiarities:
- Landing page: `title` = "Landing page" (localized), `slug` = `""`, `parentId` = 0.
- Pages created via WebDAV have `slug = ""` until they are renamed through the API.
- `linkedPageIds` is computed by the server on every write from the links in the content.

## 5. File structure and WebDAV ([architecture §4.4, §4.5](architecture.md))

- **Leaf → parent page** (`Title.md` → `Title/Readme.md`): the **file ID is preserved** ✔. The attachment folder moves along (`.attachments.97/` → `Onboarding/.attachments.97/`) ✔.
- **Attachment ID (M8, integration test)**: the `oc:fileid` of an attachment in the PROPFIND is the `id` of the OCS attachment list. Attachments added via WebDAV (`MKCOL` + `PUT` with `If-None-Match: *`) appear in the OCS list; a deleted attachment disappears from the PROPFIND.
- **Attachment folder**: `.attachments.{pageId}/` in the parent folder of the page file, so for parent pages in their own folder next to `Readme.md`. In addition, Collectives lists all non-Markdown files in the folder of a parent page as attachments of type `folder`.
- Parent pages remain folders even when their last subpage disappears (`Title/Readme.md` without siblings is valid).
- A folder without a `Readme.md` automatically gets an (empty) `Readme.md` on the next listing.
- **Raw WebDAV is detected**: `.md` files created via `PUT` appear as pages, `MOVE` renames or moves (ID stays), `DELETE` ends up in the Collectives trash. This replaces the quick test with Nextcloud Sync planned in M0, because Nextcloud Sync performs exactly these WebDAV operations.
- `GET` returns an `ETag`. `PUT` with a matching `If-Match` → 204 plus a new `ETag` that matches the next `GET` ✔. Stale or wrong `If-Match` → **412** ✔. `If-None-Match: *` only creates (201) and returns 412 if the file exists. Useful against accidental overwriting.
- `PROPFIND` Depth 1 with `getetag`, `getlastmodified`, `getcontentlength`, `oc:fileid`, `resourcetype` ✔ (fixture `dav-propfind-depth1.body.xml`). `Depth: infinity` works on the test server. We do not rely on it, because admins can turn it off.
- **`touch` is unnecessary**: the `NodeWrittenListener` of Collectives sets `lastUserId` on every WebDAV write, sends the change notification and updates `linkedPageIds` (`lib/Listeners/NodeWrittenListener.php`). We drop the `touch` call after `PUT`.

## 6. Titles and file names ([architecture §6.4](architecture.md))

The server sanitizes titles itself (`NodeHelper::sanitiseFilename`): `/` → `-`, removes `* | \ : " < > ?`. Example: `A/B: Questions? #1 [x]` → `A-B Questions #1 [x]`. On a name collision it appends ` (2)`, ` (3)` … (`generateFilename`).

Consequences for the mapping:
- Of the characters problematic for Obsidian, remote titles can only contain `# ^ [ ]`. `nc_title` is needed only for those.
- Renamed locally with one of the characters the server removes: the server stores a different title. The plugin must adopt the title from the response, otherwise a rename ping-pong results.

## 7. Links ([architecture §9.1](architecture.md))

Code reading (`src/views/PagePicker.vue`, `src/stores/pages.js`, `lib/Fs/MarkdownHelper.php`) and server test (`linkedPageIds` in `page-get-with-links.json`):

- **The link picker in Collectives writes absolute URLs**: `{origin}/index.php/apps/collectives/{collectiveSlug}-{collectiveId}/{pageSlug}-{pageId}`. Without pretty URLs `/index.php` is in the path, with pretty URLs it is not.
- For pages without a slug the frontend generates `…/{collectivePath}/{path/title}?fileId={id}`.
- **On writing, the server recognizes three forms** as a page link (all three confirmed):
  1. relative: `[Vacation](Processes/Vacation.md?fileId=100)`
  2. absolute to a trusted domain: `https://host/index.php/apps/collectives/Handbook-1/Onboarding-97`
  3. root-relative: `/index.php/apps/collectives/Handbook-1/Processes-98#section`

  The collective part may be `{slug}-{id}` or the URL-encoded name. Anchor and query after the ID are ignored.
- The Text app writes images as `![name](.attachments.{pageId}/name)`. The `src` field of the attachment API confirms this.
- Proposal for the local → remote direction: **relative link with `?fileId=`**. It is server-independent, is recognized for backlinks and matches the plan. Absolute links from the link picker are also resolved on pull.

## 8. Obsidian

- `app.secretStorage` (`setSecret`, `getSecret`, `listSecrets`) **from 1.11.4** ✔. `SecretComponent` for the settings UI from 1.11.1. Secret IDs: lowercase letters, digits, hyphens.
- The declarative settings API (`getSettingDefinitions`, `SettingDefinition*`) exists from 1.13.0.
- Recommendation for `minAppVersion`: **1.11.4**, settings tab classic via `PluginSettingTab`.

## 9. Manual check in the browser (2026-10-16)

Performed in the Collectives UI of the test server (pretty URLs active), collective "Admins Wiki", pages "Linktest" and "Ziel".

**Frontmatter:** The text editor shows YAML frontmatter as a code block. When saving in the browser the block is preserved byte for byte, as are all links. But the editor normalizes: it inserts a **blank line after the closing `---`** and **removes the trailing line break**. The plugin's remote format should produce exactly this normal form (ADR 0005).

**Links** (click in the editor):

| Form | Result |
|---|---|
| `Ziel.md?fileId=138` | ✔ opens target |
| `http://host/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ new tab, "Collective not found" |
| `/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ new tab, "Collective not found" |
| `/apps/collectives/Admins-Wiki-3/Ziel-138` | ✔ |
| `Ziel.md` | ✔ (but not recognized as a page link by the server) |
| `Ziel.md?fileId=138#abschnitt-zwei` | ✔ (anchor not verifiable, page too short) |

→ Push writes relative links with `?fileId=` (ADR 0008). The cause of the `/index.php/` failures is open (presumably pretty URLs). It is irrelevant for pull, because we resolve all forms.

**Concurrent editing** (two runs, ADR 0012): A WebDAV `PUT` during an open editor session leads, after a few seconds, to the message "Editing session has expired. Please reload the page." (button "Reload"). The editor still lets you type but no longer saves anything. **The WebDAV version wins**; browser input after the message is lost. Browser changes already saved by autosave are safe: either the plugin reads them before the `PUT`, or its `PUT` fails with 412.

## 10. Further server findings

- **No `oc:checksums`** on Collectives files (PROPFIND → 404 for the property). The remote identity of a version is the ETag.
- **ETags propagate upward**: a content change in `Handbook/Onboarding/First day.md` changes the ETags of `Onboarding/`, `Handbook/` and `.Collectives/`. A `PROPFIND` with `Depth: 0` on `.Collectives/` is therefore a cheap idle check for content. **Caution:** emoji, tags and page order live only in the database and do not change any ETag. The page list must still be loaded regularly (e.g. on every interval run; the root ETag check only saves the content GETs).
- The OCS page list returns **no `ETag` header**; conditional GETs (304) are not possible there.

- **App store lock after a failed download** (Nextcloud 33–35, `lib/private/App/AppStore/Fetcher/Fetcher.php`): if fetching the app list fails with a connection or HTTP error, Nextcloud stores the time in the app setting `settings/appstore-fetcher-lastFailure` and for `RETRY_AFTER_FAILURE_SECONDS` (300 s) returns an empty list without asking the store. `occ app:install` then reports "it was not found on the appstore". A DNS error does not set the lock. The reason of the failure is only in `data/nextcloud.log` (app `appstoreFetcher` or message "Failed to connect to the app store"). The test server's hook deletes the setting before each retry ([ADR 0026](adr/0026-required-checks-and-retried-app-install.md)).

## 10a. Findings from M2 (API clients, ONC-3)

- **ETags have one-second resolution – `If-Match` does not protect within the same second.** Nextcloud derives the ETag from the mtime in whole seconds. Two writes in the same second yield the same ETag. Reproduced on the test server (2026-10-16, raw WebDAV without plugin code): `PUT` new (201, ETag A) → `PUT` with `If-Match: A` (204, ETag **A**) → `PUT` with the now stale `If-Match: A` (204 instead of 412). The second content was thereby overwritten silently. Consequence for M4: a `PUT` response whose ETag equals the sent `If-Match` does not prove that nobody has written since. The countermeasure is decided in M4 (e.g. treat such responses as unsafe and re-read and compare after > 1 s). The integration test therefore waits across the second boundary before the first write.
- **Page trash without `collectivePath`**: `GET …/pages/trash` returns `collectivePath: null` (fixture `pages-trash-list.json`), all other PageInfo fields as usual. The client returns the type `TrashedPage` there (`collectivePath: string | null`); `PageInfo` stays strict. After the restore (`PATCH …/pages/trash/{id}`) `collectivePath` is set again.
- **Redirects and the `Authorization` header: not verified.** The Obsidian types do not document the redirect behavior of `requestUrl`, and the integration test runs with Node `fetch` instead of `requestUrl`. Whether a redirect to a foreign host carries the Basic Auth header along (desktop: Electron/Chromium, mobile: native HTTP stacks) can only be checked in Obsidian itself. Open for the manual check (M9 at the latest, `docs/manual-test.md`). Until then: the server URL is normalized, and the client sends only to `baseUrl + path`; it rejects paths containing `://`.
- Unexpected status codes: `MKCOL` on an existing folder → 405 (`ServerError`), member deletes collective → 403 (`ForbiddenError`, ADR 0015).
- Error bodies (ONC-37, ADR 0028): OCS errors carry the reason in `ocs.meta.message` (fixtures `tag-create-duplicate.json`, `collective-trash-as-member.json`); WebDAV errors are a Sabre XML `<d:error>` with `s:exception` and `s:message` (fixture `dav-put-if-match-stale.body.xml`). `extractErrorDetail` reads only these two fields into the `detail` of the error. Binary GETs (attachments) get the error XML as bytes; it is decoded as UTF-8 for the detail.

## 10b. Findings from M3 (pull, ONC-4)

- **User ID for WebDAV**: `GET /ocs/v2.php/cloud/user` returns the Nextcloud user ID under `ocs.data.id`. It is fetched before every run, stored in the state as `user` and passed to `WebdavClient` (login name and user ID can differ with email or LDAP login). A state with pages but a different user ID or server URL leads to an abort without any write.
- **Idle without writes**: remote counts as changed if `timestamp` or `size` from the page list differ from the state. Only then does a WebDAV `GET` follow. Metadata (emoji, tags, `nc_title`) goes through `metaHash`. The state is written only if its serialized form changes.
- **Parent pages** are recognized by the pull via `fileName === 'Readme.md'` (with `parentId ≠ 0`), not via existing children. For parent pages `filePath` contains the page's own folder, for leaf pages the parent folder (fixture `pages-list-final.json`).
- **Open for manual checking in Obsidian**: whether `file.stat.mtime` carries the new value right after `vault.create`/`vault.process` (basis for `localMtime`), whether Obsidian modals set `role="dialog"` themselves, whether the initial focus stays on "Cancel" without `requestAnimationFrame`, and whether notices are announced by VoiceOver.

## 10c. Findings from M4 (push, ONC-5)

- **ETag confirmed or not**: besides the `ETag`, `GET` returns `Last-Modified` (seconds) and `Date`. If the second of `Last-Modified` is before that of `Date`, every later write necessarily has a different ETag. Then `If-Match` protects. If both are in the same second, the ETag counts as unconfirmed: the state stores `remoteMtime = -1`, a planned push waits 1.1 s and reads again (ADR 0017).
- **After its own `PUT`** the state is always unconfirmed. The next run does exactly one `GET` on the page and compares hashes without writing. Only the run after that is idle for the page. The integration test `tests/integration/push.test.ts` verifies this.
- **Foreign write right after the listing**: the `PUT` with the ETag from the state fails with `412`. The executor reads again, decides again and, if the content differs, creates a conflict copy. The remote version stays untouched.
- **Open for manual checking in Obsidian**: order and number of `modify` events after `vault.process` (suppression applies for 5 s), display of the status bar and the conflict dialog on desktop and mobile, `fileManager.trashFile` for the conflict copy.

## 10d. Findings from M5 (structure, ONC-6)

All points are backed in `tests/integration/structure.test.ts` against the Docker test server, unless noted otherwise.

- **Attaching a page below a leaf page** (`POST …/pages/{leaf}` or `PUT … {parentId: leaf}`): the listing immediately shows the leaf page as `fileName: Readme.md`, `filePath: <title>` (parent page). Its `id` stays. The plugin notices this in the next pass as "moved remotely" and puts the local note into the folder (ADR 0018).
- **`PUT …/pages/{id}/to/{newCId}`**: ID stays, the subpages move along and keep their parent ID. Before every move the executor checks where the page currently is (`GET …/pages/{id}` in the old and new collective) and does nothing more for subpages.
- **`DELETE …/pages/{id}`** on a parent page takes the subpages to the trash with it; `PATCH …/pages/trash/{id}` restores the page and returns the `PageInfo` (with `collectivePath`). A `404` on restore is treated by the executor as "perhaps already restored together with the parent page" and it queries the page via `GET` (not specifically proven against the server).
- **Renaming a collective** via the Circles API: `GET /collectives` returns the new name immediately; the page IDs stay, the pages' `collectivePath` changes with the name.
- **New collective** (`POST /collectives`): creates the landing page (`Readme.md`, `parentId = 0`). When uploading a new folder, its text is replaced by the local note with the folder name.
- **Trash listing** (`GET …/pages/trash`) contains the pages the plugin removed via `DELETE`; this is how the run recognizes a reappeared file (`nc_page_id`) as "restored locally".
- **HTTP cache in Obsidian (Electron):** WebDAV `GET` responses carry no `Cache-Control`. `requestUrl` therefore served repeated `GET`s of the same file from the cache without asking the server (they were missing in the access log): stale text and ETag, every `PUT` failed with `412`. Since M5 all `GET`/`PROPFIND` send `Cache-Control: no-cache` and `Pragma: no-cache`. Node `fetch` (integration tests) does not cache; the bug is visible only in Obsidian.
- **Not tested:** members without admin rights (level < 8): the test server has only one user; the "not allowed to rename/delete" cases are covered only as a unit test (`tests/unit/plannerStructure.test.ts`).
- **Open for manual checking in Obsidian:** `fileManager.renameFile` for folders (collective folders, folder pages) and the link update in other notes, `fileManager.trashFile` for folders, the `rename`/`delete` events after the plugin's own operations, the confirmation dialog on desktop and mobile.

## 11. Reference projects ([architecture §15](architecture.md))

Reviewed read-only, without building or running.

### Nextcloud Sync – siosig/obsidian-nextcloudsync

MIT, "Copyright (c) 2026 Daisuke ITO", commit `cff8b216f0e2d818d221bb3c24c08eed4b62226e` (2026-10-10). `minAppVersion` 1.13.0, `isDesktopOnly: false`. When adopting code, name the copyright and commit in the code and in the README.

Adopt (patterns, with file references in the reference repo):

| Topic | Pattern | Location |
|---|---|---|
| Login Flow v2 | `POST /index.php/login/v2` via `requestUrl`, 404/405 → "not supported" (fallback: app password). Polling every 2 s, deadline 20 min (= token lifetime on the server). **Between polls wait for a timer _or_ app resume**: Android freezes `setTimeout` while the browser is in front (issue #34 there) | `src/auth/LoginFlowV2.ts:17-92` |
| Login URL | `window.open(loginUrl, '_blank')` on all platforms. In addition, for us a fallback: show the link / make it copyable when `window.open` returns `null`; cancel button | `src/settings/SettingTab.ts:210` |
| Secret storage | `app.secretStorage.setSecret/getSecret`, only the secret ID in `data.json`; UI via `SecretComponent` | `src/settings/SettingTab.ts:117-127, 243-254` |
| If-Match/412 | send the ETag normalized in quotes, 412 → own error class → conflict handling instead of overwriting | `NextcloudClient.ts:392-403`, `SyncEngine.ts:905-918` |
| Root ETag short circuit | Depth-0 PROPFIND on the root; unchanged → no full scan, but every 20th run is full anyway | `NextcloudClient.ts:230-249`, `util/limits.ts:19` |
| Maintenance mode | before the sync `GET /status.php` (without auth), `maintenance: true` → skip the run; map Sabre exceptions in the error XML to understandable messages via `DOMParser` | `NextcloudClient.ts:122-180`, `NextcloudErrorParser.ts:3-25` |
| Mobile triggers | start sync with a short delay after `onLayoutReady`; resume via `visibilitychange` **and** `window.focus` with a 5-minute cooldown; interval timer on desktop only; debounce after `modify` plus an "is currently being edited" lock for incoming writes | `main.ts:143-248, 544-549`, `util/appResume.ts` |
| Own events | path-based ignore list with TTL (5 s), do not consume entries on the first event (one write triggers several events) | `src/data/LocalAdapter.ts:58, 90-103` |
| Mass-delete protection | threshold `max(20, 20 % of known files)`; only locally unchanged candidates; re-check each candidate individually before deleting; an empty/broken listing is an error, not "everything deleted" | `util/limits.ts:21-41`, `SyncEngine.ts:1127-1163`, `network/dav/propfind.ts:23-53` |
| PROPFIND parser | `DOMParser` + `getElementsByTagNameNS` (prefix-independent), strip BOM, detect `<parsererror>` (Blink does not throw), root must be `DAV:multistatus` | `src/network/dav/propfind.ts:25-152` |
| Timeout | `requestUrl` has no timeout → `Promise.race` against `window.setTimeout` (30 s); retry only for read requests | `src/network/requestWithTimeout.ts` |
| Tests | Docker Nextcloud with post-install hook and healthcheck on `status.php` (`scripts/dev-nextcloud` already uses this pattern). In the integration test map `requestUrl` to Node `fetch` via a mock (tests only!). CI there only for pure unit tests | `tests/docker/`, `tests/b1-nextcloud-headless/__mocks__/obsidian.ts` |

Do not adopt: writing via `DataAdapter` instead of the vault API (violates AGENTS rule 2); polling that treats every non-2xx status as "pending" (for us only 404 counts as pending); OCS v1 (we use v2); diff3/frontmatter merge and chunked upload (out of scope for v1).

### NextDeck – onlymykazari/obsidian-nextcloud-deck

MIT, "Copyright (c) 2026 Ismail Ivanov" (upstream author of the Kanban part), commit `045710f8b5c06c0d1b4ab3a467d5c5db93f287bf` (2026-07-19). Plain JavaScript, `minAppVersion` 1.5.0.

Adopt:
- **Sync log ring buffer** with structured entries `{ at, event, …}`, modal with "Newest first", "Clear", "Copy diagnostics" (`src/plugin.js:414-438`, `src/sync-log-modal.js`). For us typed, 500 entries ([architecture §12](architecture.md)) and an **allowlist** instead of a blacklist on export.
- **Pure mapper without an Obsidian import** plus a baseline snapshot per object (`src/sync-mapper.js`, `conflict.js`). This confirms our `planner`/`mapping` split.

Do not adopt: credential "encryption" with the key in `localStorage` (effectively plain text); a global `reconciling` flag for event suppression (swallows real user edits, late events slip through); remote IDs only in `data.json` (for us in the frontmatter); regenerating whole notes via `vault.modify`/adapter (rules 2 and 4); interval timer without platform distinction.

## M9 – Login Flow v2 and triggers

- `POST /index.php/login/v2` responds with `{ poll: { token, endpoint }, login }`; the plugin accepts responses only if `login` and `endpoint` have the same origin as the server URL (protection against sending the poll token to foreign hosts). Behind a reverse proxy with a different `overwritehost`, the Login Flow therefore fails with "unexpected response"; entering the app password by hand remains possible.
- Poll: `POST <endpoint>` with `token=<url-encoded>` as a form body, without an Authorization header. 404 = not yet confirmed, 200 = `{ server, loginName, appPassword }`. Token lifetime 20 min.
- **Not yet verified against the real server and on the devices** (only unit tests with fake responses): behavior of `requestUrl` on redirects (Authorization to foreign hosts), device names in the app password list (`User-Agent` is not sent on every platform), `window.open` on iOS.
- Obsidian has no "save" event; `vault.on('modify')` fires on autosave while typing. Hence debounce instead of a save trigger.
