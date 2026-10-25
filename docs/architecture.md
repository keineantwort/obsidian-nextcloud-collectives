# Architecture – Nextcloud Collectives Sync

Plugin ID: `nextcloud-collectives` · Licence: MIT

This document is the authoritative description of how the plugin behaves and how the code is structured. Decisions and their rationale are recorded in [`docs/adr/`](adr/); details of the server interfaces (observed behaviour, fixtures, quirks) are in [`api-notes.md`](api-notes.md). A pull request that changes the behaviour described here updates this document in the same pull request ([ADR 0025](adr/0025-english-documentation-user-manual-and-architecture.md)).

Section numbers 1–13 match the former `PLAN.md`, so references such as "architecture §7.4" in code, tests and ADRs keep their meaning. The server behaviour described in §4 was verified against Nextcloud 33.0.10 with Collectives 4.7.1; fixtures are in `tests/fixtures/m0/`.

---

## 1. Goal

Obsidian becomes the primary front end for Nextcloud Collectives. The plugin synchronises all collectives of one server with the vault, in both directions and automatically. Every action in Obsidian (create, edit, rename, move, delete) is carried over to Collectives; deletions only after confirmation. Pages are edited locally as ordinary Markdown files; hierarchy, renaming, moving, tags, emojis, links and attachments are transferred in both directions.

## 2. Scope

| Area | Content |
|---|---|
| Platform | Desktop (macOS, Windows, Linux) and mobile (iOS, Android), `isDesktopOnly: false` |
| Sync | Bidirectional, automatic (interval, after changes, on startup and when the app returns to the foreground) plus manual |
| Pages | List, read, edit, create, rename, move, move to trash |
| Collectives | One server per vault ([ADR 0003](adr/0003-one-server-per-vault.md)); all collectives of the server make up the whole vault, one top-level folder per collective; new collectives in both directions |
| Metadata | Emoji and tags as frontmatter |
| Links | Wikilinks ↔ Collectives links, stable across round trips |
| Attachments | Images and other files in both directions |
| Conflicts | Detection via ETag, conflict copy plus resolution dialog |

The plugin is an independent implementation; existing plugins serve only as references ([ADR 0002](adr/0002-own-plugin-instead-of-fork.md), §15).

### Non-goals

- Real-time collaboration (Nextcloud Text sessions/Yjs)
- Public shares (share API), templates, member management, permission levels
- Syncing the page order (`subpageOrder`) from Obsidian
- Several Nextcloud servers in one vault (deliberately excluded: one vault = one server and one account)
- Selecting a subset of collectives (the vault always mirrors every collective the user has access to)
- Line-level merging (3-way merge) – conflicts are only detected

## 3. Constraints and tech stack

| Topic | Rule |
|---|---|
| Language | TypeScript, `strict: true` |
| Build | esbuild, based on the official `obsidian-sample-plugin`; options in `esbuild.options.mjs`, minified with `keepNames` so error class names survive for the log (ADR 0028) |
| HTTP | only `requestUrl` from `obsidian` (avoids CORS, works on mobile). No `fetch`, no Node modules |
| Hashing | Web Crypto `crypto.subtle.digest('SHA-256', …)` |
| File access | only the Obsidian vault API (`app.vault`, `app.fileManager`), no `fs` |
| XML | `DOMParser` |
| Tests | Vitest for pure logic; integration tests against Nextcloud in Docker ([ADR 0006](adr/0006-local-docker-test-server.md)) |
| Lint | ESLint with `eslint-plugin-obsidianmd` (rules for community plugins); purity of planner and mapping enforced via `no-restricted-imports` (`eslint.config.mts`) |
| Localisation | User-facing texts in English and German via `src/i18n/`, chosen by `getLanguage()` ([ADR 0013](adr/0013-localisation-de-en.md)) |
| Minimum version | Obsidian ≥ 1.11.4 because of the secret storage (`app.secretStorage`, `@since 1.11.4`; `minAppVersion` in `manifest.json`, [ADR 0011](adr/0011-minimum-version-and-secret-storage.md)). The settings are also provided as declarative definitions for the settings search of Obsidian ≥ 1.13; below that, `display()` renders the same definitions ([ADR 0031](adr/0031-declarative-settings-definitions.md)) |
| Server | Nextcloud with the Collectives app (and Circles/Teams), OCS API `v1.0`. The tested Nextcloud major versions are `TESTED_NEXTCLOUD_MAJORS` in `src/api/versionCheck.ts`; the CI matrices in `.forgejo/workflows/integration.yml` and `nightly.yml` run the integration tests against them ([ADR 0024](adr/0024-integration-tests-split-pr-and-nightly.md)) |
| Licence | MIT |

## 4. Server interfaces

### 4.1 Basics

- OCS base: `{server}/ocs/v2.php/apps/collectives/api/v1.0`
- Required headers: `OCS-APIRequest: true`, `Accept: application/json`
- Responses are wrapped in `{ ocs: { meta, data } }`; the client unwraps `data`.
- Auth: HTTP Basic with login name and app password.
- WebDAV paths need the Nextcloud **user ID**, not the login name (they differ for e-mail or LDAP logins). The user ID is read from `GET /ocs/v2.php/cloud/user` (`data.id`) and stored in the sync state.
- The Collectives folder is configurable per user (default: hidden `.Collectives/`). WebDAV paths are always built from the `collectivePath` returned by the API, never hard-coded.
- Page content is **not** part of the OCS API but a file. It is read and written via WebDAV ([ADR 0007](adr/0007-content-via-webdav-metadata-via-ocs.md)):
  `{server}/remote.php/dav/files/{userId}/{collectivePath}/{filePath}/{fileName}`
- Page ID = Nextcloud file ID of the Markdown file.

### 4.2 OCS endpoints used

| Purpose | Method + path | Parameters |
|---|---|---|
| List collectives | `GET /collectives` | – |
| Create collective | `POST /collectives` | `name`, `emoji?` |
| Collective emoji | `PUT /collectives/{id}` | only `emoji` – **cannot rename** |
| Rename collective | `PUT /ocs/v2.php/apps/circles/circles/{circleId}/name` | `value` (Circles API, [ADR 0010](adr/0010-rename-collective-via-circles.md)) |
| Move collective to trash | `DELETE /collectives/{id}` | – only circle admin/owner, otherwise 403 |
| Restore collective | `PATCH /collectives/trash/{id}` | – (`GET /collectives/trash` lists) |
| Pages of a collective | `GET /collectives/{cId}/pages` | → `{ pages: PageInfo[] }` |
| One page | `GET /collectives/{cId}/pages/{id}` | → `{ page }` |
| Create page | `POST /collectives/{cId}/pages/{parentId}` | `title`, `templateId?` |
| "Touch" page (last editor) | `GET /collectives/{cId}/pages/{id}/touch` | – **not used**; the WebDAV `PUT` sets the last editor itself |
| Move/rename | `PUT /collectives/{cId}/pages/{id}` | `parentId?`, `title?`, `index?`, `copy=false` |
| Move to another collective | `PUT /collectives/{cId}/pages/{id}/to/{newCId}` | `parentId?`, `index?`, `copy=false` – ID and emoji stay, tags are lost and must be set again in the target |
| Set/remove emoji | `PUT /collectives/{cId}/pages/{id}/emoji` | `emoji` (`""` removes it, see `api-notes.md` §4) |
| Assign / remove tag | `PUT` / `DELETE /collectives/{cId}/pages/{id}/tags/{tagId}` | – (idempotent) |
| Move page to trash | `DELETE /collectives/{cId}/pages/{id}` | – |
| Tags of the collective | `GET /collectives/{cId}/tags` | – |
| Create tag | `POST /collectives/{cId}/tags` | `name`, `color` – both required; `color` = 6 hex digits without `#` or `""`; duplicate → 400 |
| List attachments | `GET /collectives/{cId}/pages/{id}/attachments` | – |
| Upload attachment | `POST /collectives/{cId}/pages/{id}/attachments` | multipart, field `file` – **not used**, WebDAV `PUT` instead (see 9.4) |
| Delete attachment | `DELETE /collectives/{cId}/pages/{id}/attachments/{attId}` | – |
| Page trash | `GET /collectives/{cId}/pages/trash` | – (only for deletion detection/restore) |
| Restore page | `PATCH /collectives/{cId}/pages/trash/{id}` | – including sub-pages and attachments |

Further endpoints outside the Collectives API: `GET /ocs/v2.php/cloud/user` (user ID, 4.1), `GET /ocs/v2.php/cloud/capabilities` (version check, §12) and the Login Flow v2 endpoints (§10.1).

### 4.3 PageInfo fields (relevant)

`id`, `slug`, `title`, `emoji`, `tags` (list of tag IDs), `timestamp` (mtime, Unix seconds), `size`, `fileName`, `filePath` (`""` at root level), `collectivePath`, `parentId`, `subpageOrder`, `lastUserId`, `linkedPageIds`, `trashTimestamp`.

Landing page: `title` = "Landing page" (localised), `slug` = `""`. Pages created via WebDAV also have `slug = ""` (or `null`, which the client reads as `""`). The Collectives version is not part of the capabilities.

Responses are checked strictly in `src/api/parse.ts`, but only for the fields the sync actually uses; an unexpected structure raises `ApiChanged` (§12).

### 4.4 File structure on the server

- Landing page of a collective: `Readme.md` in the collective root, `parentId = 0`.
- Page without sub-pages: `Title.md`.
- Page with sub-pages: folder `Title/` with `Title/Readme.md`; the sub-pages live in the folder.
- Attachments: folder `.attachments.{pageId}/` next to the page file; for parent pages therefore inside `Title/`. In addition, non-Markdown files in the folder of a parent page count as attachments (type `folder`).
- When a leaf page becomes a parent page, Collectives turns `Title.md` into `Title/Readme.md`. The file ID is kept and the attachment folder moves along.
- Parent pages stay folders even without sub-pages. A folder without `Readme.md` gets one automatically when it is listed.
- Raw WebDAV operations are recognised: `PUT` creates a page, `MOVE` renames/moves (the ID stays), `DELETE` ends up in the Collectives trash.

### 4.5 WebDAV

| Purpose | Call |
|---|---|
| Read content | `GET` → body + `ETag` header |
| Write content | `PUT` with `If-Match: <etag>` → `412` means conflict; the response contains the new `ETag`. New files with `If-None-Match: *`. **ETags have one-second resolution**: within the same second `If-Match` does not protect (`api-notes.md` §10a); see 6.3 (`remoteMtime = -1`) and [ADR 0017](adr/0017-push-etag-confirmation-and-conflict-resolution.md). If a successful `PUT` response lacks an ETag, it is fetched with a depth-0 `PROPFIND` |
| ETags of several files | `PROPFIND` depth 1 with `getetag`, `getlastmodified`, `oc:fileid` |
| Load attachment | `GET` on `.attachments.{id}/{name}` |
| Create folder | `MKCOL` (attachment folder, 9.4) |

No `touch` after `PUT`: on every WebDAV write Collectives itself sets the last editor, sends notifications and updates `linkedPageIds`.

## 5. Code structure

```
src/
  main.ts                 plugin lifecycle, commands, menus, event registration, display helpers wiring
  syncController.ts       run lock (mutex with re-run flag), dirty queue, run status, automation pause,
                          version warning, conflict dialog wiring
  settings/
    types.ts              settings interface, defaults, validators
    settingsTab.ts        UI
    connectionMessages.ts result/error of the connection test → localised message
    behaviourMessages.ts  localised option labels and warnings of the behaviour settings
    secretId.ts           create/check the plugin's secret IDs (ADR 0014)
    credentialsStore.ts   store/read the app password in the secret storage
  i18n/
    index.ts              locale selection (getLanguage), translator, placeholders (ADR 0013)
    en.ts, de.ts          texts; en.ts defines the keys, de.ts must be complete
  api/
    http.ts               transport contract (RequestFn, HttpRequest/-Response, text and ArrayBuffer bodies),
                          HttpClient: Basic auth, retry, central status → error mapping (ADR 0015)
    obsidianRequest.ts    RequestFn based on requestUrl, with timeout
    connection.ts         normalise the server URL, connection test
    ocsClient.ts          OCS calls, unwrapping of ocs.data
    webdavClient.ts       GET/PUT/PROPFIND/MKCOL/DELETE, XML parsing via DOMParser
    collectivesApi.ts     typed domain methods (listPages, createPage, …)
    clients.ts            wires HttpClient, OcsClient, WebdavClient, CollectivesApi (created per run)
    parse.ts              strict structure check of responses → ApiChanged
    errorDetail.ts        PURE: server's reason from a failed response (OCS meta.message, Sabre exception), masked (ADR 0028)
    loginFlow.ts          Nextcloud Login Flow v2
    versionCheck.ts       Nextcloud version from the capabilities, TESTED_NEXTCLOUD_MAJORS
    types.ts              Collective, PageInfo, TrashedPage, Tag, Attachment; branded IDs
  sync/
    types.ts              shared result types: SyncResult, Skip (discriminated union), proposals, decisions
    state.ts              persistent sync state (see 6.3), pure
    stateStore.ts         read/write the state file sync-state.json, only on change
    throttledPersist.ts   throttled state writes during a run (ADR 0022)
    syncRun.ts            one sync run: checks, passes of scan, plan, execute
    obsidianVault.ts      VaultReader/VaultWriter via app.vault + metadataCache
    localScanner.ts       collects local files, folders and attachment files
    remoteScanner.ts      collects collectives, pages, tags and trash
    planner.ts            PURE function: (state, local, remote) → operations (`planSync`)
    decide.ts             PURE decision table 7.3 incl. conflict strategy (ADR 0017)
    plannerTypes.ts, plannerContext.ts   types (SyncOp, SyncPlan, PlannerInput) and shared planning state
    planFolders.ts        PURE: collective cases from 7.4 (new, renamed, deleted, removed) (ADR 0018)
    planLocal.ts          PURE: local deletions, remote deletions, local renames, new files
    placement.ts          PURE: which page belongs to which folder (folder page, leaf, virtual folder page)
    locate.ts, treeIndex.ts   PURE: find the file of a page (`locatePage`), page tree queries
    linkIndex.ts          PURE: builds the link and attachment index of a pass (ADR 0020, 0021)
    executor.ts           runs operations and updates the state (loop and dispatch)
    executorContent.ts    content operations (pull, push, conflict copies)
    executorStructure.ts  structure operations (create, rename, move, delete, restore, collectives)
    executorMeta.ts       emoji and tags from the vault to the server (ADR 0019)
    executorAttachments.ts attachment step per page (ADR 0021)
    executorDeps.ts, executorScratch.ts   executor dependencies and facts learned during a run
    pageState.ts          state constructors (`unconfirmedRemote`, …)
    conflicts.ts          conflict list, resolution as a state transition
    scheduler.ts          interval, debounce after changes, startup and foreground triggers
    dirtyQueue.ts         collects local vault events, suppresses the plugin's own writes
  mapping/
    paths.ts              remote structure ↔ vault paths, file name sanitising, conflict file names
    frontmatter.ts        read/write/remove frontmatter and nc_* fields
    links.ts              link conversion in both directions
    attachments.ts        attachment paths and embeds, `AttachmentIndex`
    tags.ts               tag names between Collectives and the `tags` property
    emoji.ts              "exactly one emoji" rule, offered emojis
    renamePage.ts         rename a page note together with its folder
  ui/
    initialSyncModal.ts   first-sync dialog
    confirmView.ts        pure texts and answers of the confirmation dialog; confirmModal.ts shows it
    syncNotices.ts        notice texts from run result/error, pure; showSyncNotice.ts shows them
    statusBar.ts          status bar (desktop), pure text function
    conflictView.ts       pure texts/diff lines for the conflict dialog; conflictModal.ts shows it
    logView.ts            text form of the log, pure; logModal.ts shows it with a copy button
    emojiModal.ts         emoji picker ("Set page emoji")
    renameModal.ts        name prompt ("Rename page")
    emojiTitles.ts        page emoji in front of note titles (display only)
    propertyLabels.ts     readable labels / hiding of the nc_* properties (display only)
  util/
    hash.ts, logger.ts (ring buffer), errors.ts, timeout.ts, isRecord.ts, diff.ts (line diff)
tests/
  unit/                   planner, decide, paths, links, frontmatter, http errors, executor, UI helpers, …
  fakes/                  in-memory vault, fake API/WebDAV, planner fixtures
  stubs/obsidian.ts       runtime stub for `obsidian` in unit tests (the npm package only contains types)
  setup/domParser.ts      DOMParser from jsdom for unit and integration tests (Node has none)
  fixtures/m0/            recorded, anonymised API responses
  integration/            against the Docker Nextcloud, incl. performance.test.ts (500 pages)
scripts/
  dev-nextcloud/          docker compose test server with Collectives (several Nextcloud versions)
  ci/affects-tests.sh     whether a change affects the integration tests (integration.yml, nightly.yml)
  check-release.mjs       release consistency check (versions, CHANGELOG.md section)
  release-notes.mjs       release description from CHANGELOG.md for release.yml
docs/
  architecture.md         this document
  adr/                    architecture decision records
  api-notes.md            server behaviour, observed quirks
  user/en, user/de        user manual
  manual-test.md, release.md, ci-runner.md
```

Rule: the planner modules (`src/sync/plan*.ts`, `decide.ts`, `placement.ts`, `locate.ts`, `treeIndex.ts`) and everything in `src/mapping/` are free of Obsidian and network imports (enforced by ESLint) and fully unit-tested. The sync core (`executor*.ts`, `syncRun.ts`, scanners, state, conflicts) and the pure UI helpers do not import `obsidian` either; side effects are bundled in the executor, `syncController.ts` and `main.ts`.

## 6. Local mapping

### 6.1 Folder structure in the vault

The vault root is the sync root. Each collective is a folder at the top level of the vault ([ADR 0004](adr/0004-folder-note-convention.md)).

| Remote | Local |
|---|---|
| Collective "Handbook" | folder `Handbook/` |
| Landing page `Readme.md` | `Handbook/Handbook.md` |
| Leaf page `Onboarding.md` | `Handbook/Onboarding.md` |
| Parent page `Processes/Readme.md` | `Handbook/Processes/Processes.md` (folder note) |
| Sub-page `Processes/Leave.md` | `Handbook/Processes/Leave.md` |
| `.attachments.123/image.png` | see 9 |

Excluded from the sync: `app.vault.configDir` (`.obsidian/`), conflict copies (8), Markdown files directly in the vault root (noted in the log), hidden folders, non-Markdown files that are not attachments.

The target server and account are fixed when the vault is first synced; the state records server URL and user. A sync against a different server or account stops without changes ("This vault is already synced with another server …"). The settings say so: "A vault is bound to one server – to use a different server, create a new vault."

Rationale: many `Readme.md` files are useless in Obsidian (quick switcher, wikilinks); the folder-note convention is widespread.

Display helpers (no effect on files): the note of a folder is shown first in its folder in the file list ("Show the page of a folder first"), and the page emoji is shown in front of the note title ("Show page emoji in titles").

### 6.2 Frontmatter

Flat keys, so that Obsidian's properties view works ([ADR 0005](adr/0005-identity-and-frontmatter.md), [ADR 0016](adr/0016-pull-text-based-frontmatter-and-sync-state.md)):

```yaml
---
nc_page_id: 1234
nc_collective_id: 12
nc_emoji: "📘"
tags: [Project, Important]          # Obsidian's tag property (space → "-")
nc_title: "Original/title with special characters"   # only if it differs from the file name
---
```

- On upload only the `nc_*` fields, `tags` and a hand-made `emoji` property are removed. All other frontmatter of the user is uploaded too (Collectives shows it as text). On download a YAML block at the top of the page is recognised as frontmatter again and merged with the `nc_*` fields. If no field is left after removing the `nc_*` fields, the block is omitted entirely. Remote format = normal form of the Text editor: an empty line after the closing `---`, no trailing newline.
- Tags: only Obsidian's `tags` property is used ([ADR 0019](adr/0019-tags-emoji-push-and-tags-property.md)). Names from Collectives: spaces become `-`, a `-` stays `-`; a new `-` in Obsidian is created as `-` and never turned into a space. Mapping back: first the tag with exactly this name, otherwise the tag whose name looks like this with `-` for spaces (case-insensitive). Inline `#tags` in the text are added (additive only). Like `nc_*`, the property is not uploaded. A legacy `nc_tags` counts as long as `tags` is missing and is removed the next time the fields are written.
- Emoji: exactly one emoji or none (`src/mapping/emoji.ts`). It is set with the command "Set page emoji" or the context menu; adding an `emoji` property opens the picker. A value that is not a single emoji is not sent and reported in the run result.
- The keys stay technical; the properties view shows localised labels for them or hides them ("Hide the plugin's properties", default on).
- `nc_page_id` is the identity of a file. Without it the file is new.

### 6.3 Sync state

Stored in the file `sync-state.json` in the plugin folder via `app.vault.adapter`, separate from the settings, and written only when its content changed ([ADR 0016](adr/0016-pull-text-based-frontmatter-and-sync-state.md)). During a run, writes are throttled (`throttledPersist.ts`, at most one lazy write per second); writes that protect against duplicates (new IDs on the server, conflict copies), the end of a run and every abort are written at once ([ADR 0022](adr/0022-automation-mutex-login-flow-and-throttled-saving.md)).

Per page:

| Field | Meaning |
|---|---|
| `pageId`, `collectiveId` | identity |
| `localPath` | vault path of the file at the last sync. All structure operations (local and remote rename, move, collective folders) update it; the current file is still found via `nc_page_id` (`locatePage`). If the file's path differs from `localPath`, the user renamed or moved it (7.4) |
| `remoteFilePath`, `remoteFileName`, `parentId` | remote location at the last sync |
| `remoteEtag`, `remoteMtime`, `remoteSize` | remote version. `remoteMtime = -1`: version unconfirmed (ETag from the same second, or the plugin's own `PUT`); the next run reads via `GET` and compares hashes ([ADR 0017](adr/0017-push-etag-confirmation-and-conflict-resolution.md)). After every own write (including OCS rename/move) the remote version is only stored via `unconfirmedRemote(etag)` |
| `baseHash` | SHA-256 of the **remote format** of the content at the last sync (after link conversion, without `nc_*` frontmatter). For `conflict`/`collision`: hash of the remote version of the latest conflict copy |
| `metaHash` | hash of emoji and tags |
| `attachments` | list `{ id, name, etag, localPath, hash }`; `etag: ''` = not transferred yet ([ADR 0021](adr/0021-attachments-embeds-index-and-reconciliation.md)) |
| `lastSyncedAt` | timestamp |
| `localMtime` | mtime of the local file after the plugin's last write, or before reading the uploaded text; a difference marks a candidate for a local change. `-1`: local file unchecked (e.g. after "Keep local") |
| `status`, `conflictPath` | `synced` / `conflict` / `collision` and path of the latest conflict copy. `conflict`: the file carries its `nc_page_id`, both sides differ (`baseHash = ''` if the base is unknown). `collision`: the target path was taken by a user file without `nc_page_id`; `localPath` is that file's path |

In addition: `schemaVersion`, `serverUrl`, `user` (user ID, 4.1), per collective `{ collectiveId, name, localFolder }`, and a tag cache per collective.

Important: `baseHash` is computed on the converted remote format. Otherwise link conversion would produce a phantom change on every run (ping-pong).

### 6.4 File names

- Not allowed in Obsidian file names/links: `* " \ / < > : | ? # ^ [ ]`. These are replaced by `_`; the original title is then kept in `nc_title`.
- The server cleans titles itself (`/` → `-`, removes `* | \ : " < > ?`). Remote titles therefore contain at most `# ^ [ ]`. After creating or renaming, the plugin always takes the title from the server response.
- Local rename → new title = file name (or `nc_title`, if set and differing only by sanitising). Renaming the note of a page with sub-pages renames its folder too ("Rename page", `src/mapping/renamePage.ts`).
- Name collisions after sanitising: suffix ` (2)`; original title in `nc_title`.

## 7. Sync flow

### 7.1 Triggers

| Trigger | Behaviour |
|---|---|
| Plugin start | 2 s after `workspace.onLayoutReady`, default on |
| Interval | default 5 min, 0 = off |
| After changes | debounce of 10 s after the last `modify`/`create`/`rename`/`delete` of a synced note (Obsidian has no save event, [ADR 0022](adr/0022-automation-mutex-login-flow-and-throttled-saving.md)). A full run follows, not only this page |
| Mobile foreground | sync when the app becomes visible again (`visibilitychange`), at most every 30 s; setting `syncOnForeground` |
| Manual | command "Sync now", ribbon icon, click on the status bar |

A mutex prevents parallel runs; a trigger during a run sets a re-run flag, and one more run follows (a manual request takes precedence over an automatic one). Automatic runs are silent: no dialog, a notice only for warnings and errors, questions are deferred until the next manual run ("Some changes need your decision. Run “Sync now” to answer."). Automatic runs do not start the first sync of a vault. `AuthError` and `ApiChanged` pause automatic runs until a manual run succeeds or the settings change. Dirty keys of an unfinished or failed run are queued again.

### 7.2 Phases of a run

Before the first pass: read the user ID (4.1), check that server and account match the state (6.1), and on the first run of a session check the server version (§12).

A run consists of up to 3 **passes**. Follow-up steps such as "move the leaf page into its new folder" or "pages of a new collective" are done by the next pass ([ADR 0018](adr/0018-structure-multiple-passes-confirmations-and-placement.md)). Each pass:

1. **Scan remote**: `GET /collectives` (all), per collective `GET …/pages` and trash, cache tags.
2. **Scan local**: all files below the sync root; `nc_page_id` from the frontmatter (via `metadataCache`). Content is hashed (remote format) only for files whose mtime differs from `localMtime` or that are in the dirty queue.
3. **Plan** (`planner.ts`, pure): decision table 7.3 and cases 7.4 → list of operations, ordered: folders/parents before children, deletions last. Questions (deletions, new collectives) are returned as `proposals`; the run asks them (up to 3 rounds) and plans again with the answers. Unanswered questions count as "defer".
4. **Execute**: operations sequentially; each operation updates the state immediately (crash safety, throttled writes, 6.3). An error on one page does not abort the run.
5. **Finish**: write the state, update the status bar, report results and conflicts.

### 7.3 Content decision table

`L` = changed locally (`hash(local) ≠ baseHash`), `R` = changed remotely (`mtime/size ≠ state` and after `GET` `hash(remote) ≠ baseHash`).

| L | R | Action |
|---|---|---|
| no | no | nothing |
| yes | no | PUSH: `PUT` with `If-Match` (only with a confirmed ETag); on `412` → read again and decide again |
| no | yes | PULL: overwrite locally (via `vault.process`) |
| yes | yes | content identical → only update the state; otherwise according to `conflictStrategy`: CONFLICT (`conflictFile`), PUSH (`preferLocal`), PULL (`preferRemote`) |

Implemented as the pure function `decideContent` (`src/sync/decide.ts`, [ADR 0017](adr/0017-push-etag-confirmation-and-conflict-resolution.md)). Pages with status `conflict`/`collision` are never pushed and are always treated as a conflict when both sides changed.

A push whose remote version cannot be confirmed (e.g. a proxy without `Last-Modified`/`Date`, or a server clock in the future) is not sent; it is counted as `deferred`, reported with a warning notice and retried on the next run ([ADR 0023](adr/0023-release-version-check-log-and-ci.md)).

### 7.4 Structure and lifecycle cases

| Case | Detection | Action |
|---|---|---|
| New remote page | ID not in state | create the file locally |
| New local file | no `nc_page_id` | determine the parent page from the folder → `POST pages/{parentId}` → content via `PUT` → `nc_page_id` into the frontmatter. Tags and emoji already in the note become the page's |
| Remote renamed/moved | same ID, different `filePath`/`fileName`/`parentId` | rename/move locally (`fileManager.renameFile`, updates links) |
| Local renamed/moved | same ID, different `localPath` | `PUT pages/{id}` with `title`/`parentId`; folder change into another collective → `…/to/{newCId}`, then assign the tags again |
| Moved on both sides, differently | both | remote wins, note in the log and the run result |
| Remote deleted | ID missing from the list | setting: move the local file to Obsidian's trash (default) / keep it and unlink it. A file changed locally in the meantime is never removed; the page is restored instead |
| Local deleted | ID in state, file missing | after confirmation → `DELETE pages/{id}` (Collectives trash). Declined → restore the page locally. Several deletions of one run are collected in **one** dialog (list with checkboxes, "Check all"/"Uncheck all"). A deleted parent page = deletion including sub-pages, visible in the dialog |
| Restored locally | file with `nc_page_id` reappears, page is in the remote trash | `PATCH pages/trash/{id}` (restore), then normal reconciliation |
| Deleted + changed on the other side | combination | the change wins; the page is restored or created again |
| Markdown file directly in the vault root | no collective folder | ignore, note in the log |
| Note with unknown ID | `nc_page_id` neither in state nor on the server | left alone, reported |
| Page missing from state, file carries its ID | state lost or reset | adopt the file |
| New remote collective | ID not in state | create a top-level folder, download its pages |
| New local top-level folder | no known collective | according to `newFolderBehaviour`: create a collective (`POST /collectives`, name = folder name), ask first, or ignore. The file in the folder named like the folder becomes the landing page, the other files become pages |
| Collective deleted/removed remotely | ID missing from the list | like "Remote deleted", for the whole folder; always with confirmation |
| Local collective folder deleted | folder missing | after confirmation (own entry with collective name and page count) → `DELETE /collectives/{id}` (Collectives trash, restorable). Declined → restore the folder locally. Without the rights (only circle admin/owner may delete; members get 403; detected beforehand via `level`) → restore the folder, notice |
| Collective folder renamed | same collective ID | rename the collective via the Circles API (`PUT …/apps/circles/circles/{circleId}/name`); without the rights → rename back locally, notice |

A new local sub-page below a leaf page turns the remote parent into a folder. Locally the folder-note structure is then established (the file is moved into the new folder) by the next pass.

Further rules ([ADR 0018](adr/0018-structure-multiple-passes-confirmations-and-placement.md)):

- Renaming the folder of a page with sub-pages locally renames the page to the folder name.
- Folders without a note get an empty folder page when uploaded.
- Mass deletion guard: if a run deletes at least 3 pages and more than 20 % of the pages of a collective, it asks separately – also with `localDeleteBehaviour = trashRemote` (`MASS_DELETE_MIN`, `MASS_DELETE_SHARE` in `src/sync/plannerTypes.ts`).
- A collision file (`status: collision`, never linked) that the user renames or deletes never leads to `DELETE pages/{id}`; it is unlinked instead, because the remote content exists locally only in the conflict copy. Collision files are not uploaded as new pages.
- The state of a new page is saved before its content is uploaded, so a failing upload cannot create the page twice.

### 7.5 Metadata

- Emoji: compare `nc_emoji` with remote; a local change → `PUT …/emoji` (removal with `""`).
- Tags: compare names; tags missing in the collective are created via `POST /tags` (default colour `0082c9`, 6 hex digits without `#`), then `PUT`/`DELETE …/tags/{tagId}`. Before creating, the tag cache is checked case-insensitively (the server's duplicate check depends on the database collation). After a move across collectives, the tags are assigned again in the target collective.
- Conflict rule for metadata: separate from the content via `metaHash` (hash of emoji and tags, without title), but with **the same decision as the content** (§7.3, `conflictStrategy`): only one side changed → that side wins; both equal → no conflict; both different → `conflictFile` (the note keeps its values, the server's are in a conflict copy, the page is `conflict`), `preferLocal`, `preferRemote` ([ADR 0019](adr/0019-tags-emoji-push-and-tags-property.md)).
- The executor compares emoji/tags of the note with the state's `metaHash` on `push`/`update` (`src/sync/executorMeta.ts`); new notes and collective changes transfer the note's tags.

### 7.6 Ignoring the plugin's own writes

Vault events triggered by the plugin itself must not trigger a new sync: paths are suppressed for 5 s before writing; the mark is not consumed by the first event, because one write can cause several events (`src/sync/dirtyQueue.ts`).

## 8. Conflicts

- Default strategy `conflictFile`: the local file stays; the remote version is placed next to it as `Title (Conflict YYYY-MM-DD HHmm).md` (without `nc_page_id`, not synced); the page is marked `conflict` in the state and not pushed until resolved. The label in the file name comes from the UI language ("Conflict"/"Konflikt"); the labels of all locales are frozen by a test, because they are part of the file format.
- Conflict dialog ("Show conflicts"): list of all conflicts; per page a diff (line-based, own LCS implementation `src/util/diff.ts`) and the buttons "Keep local" (→ push with the ETag from the time of the conflict), "Take remote", "Later". The choice only changes the state; a normal sync follows, and the conflict copy goes to Obsidian's trash ([ADR 0017](adr/0017-push-etag-confirmation-and-conflict-resolution.md)). "Keep local" on a collision links the user file to the page (minimal `nc_*` fields).
- Further strategies as a setting: `preferLocal`, `preferRemote` (they overwrite the other side without asking; pages already in conflict still need a decision).
- The status bar shows the number of open conflicts.
- If the server version changes again while a page is in `conflict`/`collision`, the existing conflict copy is updated with it (same file name); a copy the user edited or deleted is kept, and a new copy is created then. The conflict dialog refuses a choice made against an older server version (`expectedBaseHash`) ([ADR 0027](adr/0027-update-existing-conflict-copy.md)).

## 9. Links and attachments

### 9.1 Link format in Collectives

The server recognises three forms as page links (fixture `tests/fixtures/m0/content-links.md`):

1. relative with file ID: `[Title](Subfolder/Page.md?fileId=1234)`
2. absolute: `https://host/index.php/apps/collectives/{collectiveSlug}-{cId}/{pageSlug}-{id}` – **this is what the link picker of the Collectives UI writes**
3. root-relative: `/index.php/apps/collectives/{collectiveSlug}-{cId}/{pageSlug}-{id}`

`/index.php` is missing with pretty URLs. Instead of `{collectiveSlug}-{cId}` the URL-encoded collective name is also accepted. Anchor/query after the ID are ignored. Images: `![name](.attachments.{pageId}/name)`.

Pull resolves all three forms (with and without `/index.php`). Push writes form 1: clickable in the Text editor and recognised by the server as a page link ([ADR 0008](adr/0008-link-format-on-push.md)). Links into another collective are written as `/apps/collectives/{slug}-{cId}/{pageSlug}-{id}` ([ADR 0020](adr/0020-links-index-anchors-and-hash.md)). The absolute and root-relative forms with `/index.php/` were not clickable in the editor with pretty URLs enabled.

### 9.2 Remote → local

| Remote | Local |
|---|---|
| link with a resolvable `fileId` or page ID in the URL | `[[Vault/Path/Page\|Link text]]` (alias only if text ≠ title) |
| anchor `#heading` | kept unchanged (URL-decoded): `[[Page#heading]]`; no slug → heading mapping |
| not resolvable / external | unchanged |
| image `![](.attachments.123/image.png)` | `![[image.png]]` with the local path according to 9.4 |

Relative links and `fileId` resolve only within the same collective; links into other collectives only as a URL with a matching `{slug}-{id}` and the server's host ([ADR 0020](adr/0020-links-index-anchors-and-hash.md)).

### 9.3 Local → remote

| Local | Remote |
|---|---|
| `[[Page]]`, `[[Page\|Alias]]`, `[[Page#H]]` to a synced page | form 1 (9.1), relative to the source file, with `fileId`; anchor URL-encoded |
| wikilink to a file outside the sync area | the text stays as `[[…]]`, warning in the log |
| `![[image.png]]` / `![](image.png)` to a local file | upload as attachment, link to `.attachments.{id}/…` |
| Markdown links `[x](Page.md)` | treated like wikilinks (they come back as wikilinks) |

Round-trip tests are mandatory: `toLocal(toRemote(x)) == x` and `toRemote(toLocal(y)) == y` for all fixtures.

Code blocks, inline code and frontmatter are excluded from the conversion.

The conversion is pure (`src/mapping/links.ts`) and uses a `LinkIndex` built per pass from the remote list, the local scan and the path plan (`src/sync/linkIndex.ts`). All hashes (local and remote) go through the remote format with this context, so all three server spellings and a renamed target page hash the same. Wikilinks to pages created in the same run are converted in the following run.

### 9.4 Local attachments

- Location: `{page folder}/_attachments/{page title}/{file}` (setting `attachmentFolderPattern`). Files the user embedded from elsewhere in the vault stay where they are; downloaded ones go into the folder from the pattern.
- Pull: list via OCS, download via WebDAV, only if ETag/size are new.
- Push: new embedded files are uploaded with WebDAV `PUT` into `.attachments.{pageId}/` (`MKCOL` first if the folder is missing). Collectives recognises this. The OCS multipart upload also works, but renames on collision on its own (`name (1).ext`) and is therefore not used ([ADR 0009](adr/0009-attachments-via-webdav.md)).
- ETags of attachments via `PROPFIND` (the OCS list contains none).
- An attachment deleted locally and no longer referenced → deleted remotely (setting, default on). Maximum file size as a setting (default 20 MB); larger files are neither uploaded nor downloaded.
- One step per page after the content (`executorAttachments.ts`) reconciles the folder `.attachments.{id}` via `PROPFIND` (ETag). Embeds (`![[…]]`, `![](…)`) ⇄ `![name](.attachments.{id}/name)` go through the index in `links.ts`/`attachments.ts`. Local changes to existing attachments are not uploaded ([ADR 0021](adr/0021-attachments-embeds-index-and-reconciliation.md)).

## 10. Authentication and settings

### 10.1 Auth

- Variant A: server URL, username, app password; button "Test connection" (`GET /collectives`).
- Variant B: Nextcloud Login Flow v2 ("Sign in with the browser") – `POST /index.php/login/v2`, open the login URL in the browser, poll the endpoint (every 2 s, at most 20 min), take over login name and app password. The poll endpoint's origin is checked against the server URL. Requires `https://`.
- Storage: the app password lives in Obsidian's secret storage, never in plain text in `data.json` (model: Nextcloud Sync, see §15). Input via a normal password field; the plugin creates the secret ID itself and stores only that ID in `data.json` ([ADR 0011](adr/0011-minimum-version-and-secret-storage.md), [ADR 0014](adr/0014-app-password-input-without-secretcomponent.md)).
- `http://` server URLs trigger a warning in the settings.
- API clients are created per sync run, because `HttpClient` takes the password when it is created.
- No credentials in logs.

### 10.2 Settings

| Key | Default | Purpose |
|---|---|---|
| `serverUrl`, `username`, `appPasswordSecretId` | – | connection (the password itself is in the secret storage) |
| `newFolderBehaviour` | `createCollective` | `createCollective`/`ask`/`ignore` |
| `syncIntervalMinutes` | 5 | 0 = off, at most 1440 |
| `syncOnStartup` | true | |
| `syncOnForeground` | true | sync when Obsidian becomes visible again |
| `syncOnSave`, `syncOnSaveDebounceSec` | true, 10 | debounce 2–600 s |
| `conflictStrategy` | `conflictFile` | `conflictFile`/`preferLocal`/`preferRemote` |
| `localDeleteBehaviour` | `ask` | `ask` (confirmation, then remote trash) / `trashRemote` (no question). Collectives and mass deletions are always confirmed |
| `remoteDeleteBehaviour` | `obsidianTrash` | `obsidianTrash`/`keepUnlinked` |
| `attachmentFolderPattern` | `_attachments/{title}` | relative to the note's folder; plain folder names only |
| `maxAttachmentSizeMb` | 20 | 1–1000 |
| `deleteRemoteAttachments` | true | delete an attachment deleted locally and no longer embedded on the server too |
| `showEmojiInTitles` | true | page emoji in front of note titles (display only) |
| `hidePluginProperties` | true | hide the `nc_*` properties in the properties view (display only) |
| `folderNoteFirst` | true | show the note of a folder first in the file list (display only) |
| `debugLogging` | false | also log request details (method, path, status, duration; no credentials) |

Link conversion (§9) is always on; there is no setting for it. Values from `data.json` are only taken over if they pass the validators in `src/settings/types.ts`.

## 11. UI and commands

| Element | Content |
|---|---|
| Status bar (desktop) | `NC –` (not synced yet) · `NC ⟳` · `NC ✓ 12:50` · `NC ⚠︎ 2` · `NC ✕` (failed). Click opens the conflicts if there are any, otherwise syncs now |
| Ribbon icon | "Sync with Nextcloud Collectives" (all platforms) |
| Notices | a manual run always shows a result notice; automatic runs only for warnings and errors (`src/ui/syncNotices.ts`); the same automatic notice is not repeated |
| Commands | Sync now · Show conflicts · Show log · Set page emoji · Rename page |
| File and editor menu | "Set page emoji…", "Rename page…" for synced notes |
| Settings tab | `getSettingDefinitions()` (rows with `render`, searchable in Obsidian ≥ 1.13) and `display()` for older versions, both from the same definitions: Connection (server URL, username, app password, sign in with the browser, test connection), Automatic sync, Behaviour (conflicts, deletions, new folders, attachments, display options), Diagnostics (log, detailed log) |

### Initial sync

- Empty vault (apart from `.obsidian/`): download everything.
- If a remote page collides with an existing file, the file stays unchanged and the remote version is placed next to it as a conflict copy ([ADR 0016](adr/0016-pull-text-based-frontmatter-and-sync-state.md)). Local files without an ID are uploaded as new pages and new top-level folders become collectives; the dialog says so.
- Non-empty vault: dialog "This vault is not empty" with the choice "Merge" (existing folders with the same name are merged, local files without an ID are uploaded) or "Cancel". The dialog recommends using a new, empty vault. Never overwrite silently.
- Automatic runs never start the initial sync; they wait for a manual "Sync now".

## 12. Error handling and logging

- Error classes (mapping centrally in `src/api/http.ts`, classes in `src/util/errors.ts`, [ADR 0015](adr/0015-http-error-mapping-and-retry.md)): `AuthError` (401 → pause automatic sync, notice), `ForbiddenError` (403 → no rights on this resource; only the operation fails, notice), `NotFound` (404), `Conflict` (412), `Network` (retry with backoff 1/2/4 s, at most 3 retries), `ServerError` (5xx and other non-2xx; retry only for 5xx), `ApiChanged` (unexpected response structure → stop the sync with a clear message). Every error built from an HTTP response carries the server's reason as `detail` (OCS `meta.message` or the Sabre exception, also from binary bodies; credentials masked, at most 200 characters; [ADR 0028](adr/0028-server-error-detail-in-the-log.md)). Retries only for reading requests (`GET`, `PROPFIND`); writes are repeated by the next run. Requests time out after 30 s by default (per request configurable, e.g. for large attachments).
- Version check: on the first run of a session the Nextcloud version is read from `/ocs/v2.php/cloud/capabilities` and compared with `TESTED_NEXTCLOUD_MAJORS` (`src/api/versionCheck.ts`); an untested major version causes one warning notice per session. The check never stops the sync. The Collectives version cannot be queried by normal users (not in the capabilities, the app API is admin-only); compatibility is therefore ensured by the structure check of the responses (`ApiChanged`) ([ADR 0023](adr/0023-release-version-check-log-and-ci.md)).
- Logger with a ring buffer (last 500 entries, in memory, current session), shown in a modal via the command "Show log" or the settings, copyable; `debugLogging` adds request details (without auth header). Failed operations log the error class and its `detail` (`errorLogFields`), never the error message.

## 13. Tests and quality

| Level | Content | Required |
|---|---|---|
| Unit | `planner` (every row of 7.3/7.4, e.g. `tests/unit/plannerStructure.test.ts`), `decide`, `paths` (mapping, sanitising, collisions), `links` (round trip, code blocks, anchors), `frontmatter`, `http` error mapping, executor, UI helpers | yes; target coverage ≥ 90 % for these modules |
| Fixtures | real API responses and page contents, anonymised (`tests/fixtures/m0/`) | yes |
| Integration | `scripts/dev-nextcloud/docker-compose.yml` (Nextcloud + Collectives + Teams/Circles), tests for the API client and end-to-end sync with an in-memory vault fake (`tests/integration/`) | yes; in CI the current Nextcloud major version and `latest` on every pull request and merge (`integration.yml`), the two versions before and the performance test nightly (`nightly.yml`) ([ADR 0023](adr/0023-release-version-check-log-and-ci.md), [ADR 0024](adr/0024-integration-tests-split-pr-and-nightly.md)) |
| Performance | `tests/integration/performance.test.ts`: 500 pages, idle sync < 5 s on a LAN (`npm run test:perf`) | nightly |
| Manual | checklist `docs/manual-test.md`: desktop macOS, iOS, Android; offline editing; concurrent editing in the browser | before every release |

Integration tests never run against production servers. The permission cases (a member, not an admin, may neither rename nor delete a collective) are covered by unit tests only, because the test server has a single user.

## 14. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Collectives API changes | sync breaks | version check, `ApiChanged` error, fixtures, CI against several Nextcloud versions |
| Concurrent editing in the browser (Text session) | a plugin `PUT` ends the browser session ("editing session expired"); text typed afterwards is lost ([ADR 0012](adr/0012-concurrent-editing-in-the-browser.md)) | `If-Match` protects browser saves (412 → conflict copy), debounce before push, note in the README |
| Link conversion not lossless | content changes, ping-pong | round-trip tests, hash on the remote format, unknown links left unchanged |
| Wrongly detected deletions | data loss | delete only after confirmation, always into the Collectives trash (restorable); a local restore also restores remotely. Mass deletion guard: if a run deletes ≥ 3 pages and > 20 % of the pages of a collective, it asks separately (also with `localDeleteBehaviour = trashRemote`, [ADR 0018](adr/0018-structure-multiple-passes-confirmations-and-placement.md)) |
| ETag one-second resolution | a write of another client within the same second is overwritten despite `If-Match` | ETags from the write second count as unconfirmed and are verified by `GET` and hash in the next run ([ADR 0017](adr/0017-push-etag-confirmation-and-conflict-resolution.md)); the debounce lowers the probability |
| Credential leak | access to Nextcloud | app password only in the secret storage, never logged |
| No background execution on mobile | delayed sync | sync on start and on return to the foreground, status display |

## 15. References and prior art

Research 2026-10-15: there was no Obsidian plugin for Nextcloud Collectives. The following projects serve as references; code may be taken over in compliance with the respective licence, with attribution in the code and in `README.md`. Reviewed commits and reusable patterns: `api-notes.md` §11.

| Project | Licence | Take over / look at |
|---|---|---|
| [siosig/obsidian-nextcloudsync](https://github.com/siosig/obsidian-nextcloudsync) ("Nextcloud Sync") | MIT | Login Flow v2, secret storage, `If-Match`/412 conflict handling, capabilities and maintenance mode detection (`/status.php`), mobile triggers (start, return to the app), mass deletion guard, test strategy with a real Nextcloud |
| [onlymykazari/obsidian-nextcloud-deck](https://github.com/onlymykazari/obsidian-nextcloud-deck) ("NextDeck") | MIT | pattern "app API ↔ Markdown notes", ring buffer sync log, protection against self-triggered vault events |

Deliberately rejected ([ADR 0002](adr/0002-own-plugin-instead-of-fork.md)):

- Pointing Nextcloud Sync directly at the `Collectives/` folder: no emojis, tags, link conversion or collective creation; the `Readme.md` structure stays visible.
- Forking Nextcloud Sync: a large foreign code base, upstream rarely accepts pull requests according to its README, permanent fork maintenance.
