# Release

Ein Release ist ein Git-Tag `x.y.z` (ohne `v`), das genau der `version` in `manifest.json` entspricht (ADR 0023).

## Ablauf

1. Version in `manifest.json` und `package.json` anheben, in `versions.json` `"<version>": "<minAppVersion>"` ergänzen. `npm run release:check` prüft, dass alles zusammenpasst.
2. Pull Request nach `main`; die CI (`.forgejo/workflows/ci.yml`) baut, lintet und testet.
3. Auf `main` das Tag setzen und pushen: `git tag 0.2.0 && git push origin 0.2.0`.
4. `.forgejo/workflows/release.yml` prüft das Tag, baut und legt ein Forgejo-Release mit `main.js`, `manifest.json` und `styles.css` an. Voraussetzung: Actions-Secret `RELEASE_TOKEN` (Forgejo-Token mit Schreibrecht auf Releases).
5. Vor einer Veröffentlichung für andere: Checkliste `docs/manual-test.md` auf iOS und Android.

## Noch offen (außerhalb des Repos, vom Maintainer zu erledigen)

Diese Punkte aus ONC-11 lassen sich nicht per Code im Repo erledigen:

- [ ] **Spiegelung nach Codeberg**: In Forgejo unter Repository › Einstellungen › Spiegel einen Push-Mirror auf das Codeberg-Repository einrichten (Codeberg-Zugangstoken mit Schreibrecht). Die Release-Dateien werden nicht mitgespiegelt; das Release auf Codeberg ggf. von Hand anlegen.
- [ ] **BRAT**: BRAT liest nur GitHub. Für BRAT braucht es ein GitHub-Repository mit dem Release (ein weiterer Spiegel), sonst bleibt die manuelle Installation.
- [ ] **Veröffentlichung im Obsidian-Store**: Pull Request gegen `obsidianmd/obsidian-releases` (`community-plugins.json`), das Repository muss dafür öffentlich auf GitHub liegen und eine `README.md`, `LICENSE` und ein Release mit den drei Dateien enthalten. Vorher PLAN §15 Nr. 3 entscheiden.
- [ ] **Screenshots** (Einstellungen, Konflikt-Dialog, Rückfrage beim Löschen, Dateiliste mit Emoji, Protokoll) für README, Obsidian-Detailseite und Community-Seite aufnehmen; ohne echte Servernamen oder Zugangsdaten.
- [ ] **Hilfe- und Detailseiten** in Obsidian sowie die **Community-Seite** `https://community.obsidian.md/plugins/nextcloud-collectives` veröffentlichen, sobald der Store-Eintrag angenommen ist.
