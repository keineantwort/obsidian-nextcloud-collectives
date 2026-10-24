# Screenshots

The images in `docs/images/en/` and `docs/images/de/` (README, user manual, store page) are taken with these two scripts against the local Docker test server, never against a real server. Retake them after visible UI changes.

```bash
npm run nc:up && npm run build
node scripts/screenshots/seed.mjs en "$TMPDIR"/creds-en.json   # user shots-en with sample collectives
node scripts/screenshots/seed.mjs de "$TMPDIR"/creds-de.json   # user shots-de
# Close your own vaults, quit Obsidian, then start it with the DevTools port:
open -a Obsidian --args --remote-debugging-port=9222
node scripts/screenshots/capture.mjs en "$TMPDIR"/creds-en.json "$TMPDIR"/vault-en
node scripts/screenshots/capture.mjs de "$TMPDIR"/creds-de.json "$TMPDIR"/vault-de
```

- `seed.mjs` starts the user from scratch on every run and writes its app password to the given file. Keep that file out of the repo.
- `capture.mjs` opens a new vault in the running Obsidian, switches the UI language for the run (restored afterwards), syncs and captures five images: `file-list`, `settings`, `conflict`, `delete-confirm`, `log`. The vault folder must not exist yet.
- While the DevTools port is open, every local process can run code in every open Obsidian window, including your own vaults and their secrets. Keep only the screenshot vaults open and the port open no longer than needed.
- Afterwards: close the two vault windows, remove the vaults from the vault switcher, and restart Obsidian without `--remote-debugging-port`, so the DevTools port is closed again.
- macOS paths above; the scripts need Node 22 or later (built-in `WebSocket`).
