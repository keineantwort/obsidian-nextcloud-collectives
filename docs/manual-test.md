# Manual test checklist (iOS and Android)

Applies to M9 (see [architecture](architecture.md)). Check every item on **iOS** and **Android**; record failures with the device, Obsidian version and Nextcloud version. Use a **new, empty vault** and a test server or test account – no production data.

Device/OS: ______  Obsidian: ______  Nextcloud/Collectives: ______  Date: ______

## 0. Installation on the phone

The plugin is not in the community store (open decision on store publication). Two ways:

- **BRAT** (recommended): Install the "BRAT" plugin in Obsidian Mobile, use "Add beta plugin" with `keineantwort/obsidian-nextcloud-collectives`, then enable it under "Community plugins". Steps: [README › Installation](../README.md#installation).
- **Manual**: Put `main.js`, `manifest.json` and `styles.css` from the [latest GitHub release](https://github.com/keineantwort/obsidian-nextcloud-collectives/releases/latest) into `<Vault>/.obsidian/plugins/nextcloud-collectives/` (e.g. via the Files app/iCloud on iOS, via USB or the Nextcloud app on Android), restart Obsidian, enable the plugin. The `.obsidian` folder is hidden on the phone: if necessary, prepare the vault with the plugin from a desktop.

- [ ] iOS: the plugin appears under "Community plugins" and can be enabled
- [ ] Android: same

## 1. Sign-in

- [ ] Enter the server URL, tap "Sign in" (Login Flow): the browser opens the Nextcloud login page
- [ ] After confirming in the browser and returning to Obsidian, the username and the app password placeholder ("Saved – type to replace") are set – without copying anything manually
- [ ] If the browser does not open, the "Open the login page again" link works
- [ ] "Cancel" ends the waiting; "Test connection" then reports the number of collectives
- [ ] Wrong server URL: understandable error message instead of a crash
- [ ] Alternatively: enter the app password by hand, connection test succeeds

## 2. First sync and automation

- [ ] "Sync now" (ribbon icon) downloads all collectives; a result notice appears
- [ ] Plugin start with a working connection: after a few seconds a sync runs without a notice (setting "Sync on startup")
- [ ] Edit a note, stop typing: about 10 s later the change is in Nextcloud (setting "Sync after changes")
- [ ] Change something in Nextcloud, move Obsidian to the background and back to the foreground: the change appears without triggering anything manually
- [ ] Set the interval to 1 minute: a change in Nextcloud arrives within about 1 minute while Obsidian is in the foreground
- [ ] Interval 0, "Sync on startup", "Sync when returning to Obsidian" and "Sync after changes" off: nothing happens on its own, also not when switching back to the app; "Sync now" still works
- [ ] Several quick changes in a row trigger only one sync; changes made during a sync run once more afterwards (no parallel run, no error message)

## 3. Quiet runs and errors

- [ ] Airplane mode, edit a note, wait 10 s: no error message. Airplane mode off, switch to the foreground: the change is uploaded
- [ ] Invalid app password (revoked in Nextcloud): the next automatic run shows an error message **once**, after that no automatic runs happen; after signing in again (or saving the settings) they resume
- [ ] Delete a note locally, wait 10 s: no dialog appears in the middle of writing, but the notice "Some changes need your decision. Run “Sync now” to answer."; "Sync now" then shows the question

## 4. Miscellaneous

- [ ] Rename, move, insert an attachment (image from the camera): arrives in Nextcloud
- [ ] Conflict (same page changed locally and in Nextcloud): conflict copy, notice, conflict dialog is usable (touch sizes, scrolling)
- [ ] German and English UI: texts complete (switch the Obsidian language, restart)
- [ ] Battery drain/heat after 30 minutes in the foreground is unremarkable

## 5. Performance (desktop, test server on the LAN)

- [ ] Collective with ≥ 500 pages: an idle sync (nothing changed) takes < 5 s. The performance test `tests/integration/performance.test.ts` (`npm run test:perf`, nightly in `nightly.yml`) checks this automatically against the Docker test server.

## 6. Diagnostics (M10)

- [ ] "Show log" (command and settings) opens the log; "Copy log" puts it on the clipboard; no password in it
- [ ] With "Detailed log", the requests (method, path, status) appear in the log
- [ ] Server with an untested Nextcloud version: one warning, then the sync runs
