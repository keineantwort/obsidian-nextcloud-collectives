# Changelog

The changes that matter to users, newest first. The section of a version becomes the description of its release on Forgejo and GitHub (`scripts/release-notes.mjs`); `npm run release:check` fails without it ([docs/release.md](docs/release.md)).

## 0.3.3 – 2026-10-25

### Added

- In Obsidian 1.13 or newer, the search in the settings finds the settings of this plugin, for example by searching for "password" or "conflict".

## 0.3.2 – 2026-10-25

### Changed

- The file list shows the page of a folder first without the CSS selector `:has`, which can slow down large vaults. Nothing changes in what you see.
- Hints that only screen readers announce no longer use `clip-path`, which older versions of the app support only in part.
- The README explains which connections the plugin makes (only to your Nextcloud server) and when it uses the clipboard (only when you copy the log).

## 0.3.0 – 2026-10-25

### Added

- If the page on the server changes again while a conflict is still open, the plugin updates the existing conflict copy instead of creating one more copy per sync.
- Errors from the server carry the reason Nextcloud gives (for example "Tag already exists"), in the message and in the log.
- A user manual in English and German, and screenshots in the README.

## 0.2.1 – 2026-10-23

### Changed

- Settings: the sign-in options come in a sensible order, and the server URL field works the same everywhere.

## 0.2.0 – 2026-10-21

### Added

- First release on GitHub: install the plugin with BRAT or by hand.
