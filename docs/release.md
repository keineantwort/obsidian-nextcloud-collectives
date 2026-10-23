# Release

Ein Release ist ein Git-Tag `x.y.z` (ohne `v`), das genau der `version` in `manifest.json` entspricht (ADR 0023).

## Ablauf

1. Version in `manifest.json` und `package.json` anheben, in `versions.json` `"<version>": "<minAppVersion>"` ergänzen. `npm run release:check` prüft, dass alles zusammenpasst.
2. Pull Request nach `main`; die CI (`.forgejo/workflows/ci.yml`) baut, lintet und testet.
3. Auf `main` das Tag setzen und pushen: `git tag 0.2.0 && git push origin 0.2.0`.
4. `.forgejo/workflows/release.yml` prüft das Tag, baut und legt ein Forgejo-Release mit `main.js`, `manifest.json` und `styles.css` an. Voraussetzung: Actions-Secret `RELEASE_TOKEN` (Forgejo-Token mit Schreibrecht auf Releases).
5. Vor einer Veröffentlichung für andere: Checkliste `docs/manual-test.md` auf iOS und Android.

## Integrationstests über mehrere Nextcloud-Versionen

Jeder Job startet einen frischen Testserver der jeweiligen Version (ADR 0024). Anforderungen an den Runner: [ci-runner.md](ci-runner.md).

| Workflow | Was | Versionen | Wann |
|---|---|---|---|
| `integration.yml` | `npm run test:int` | die neueste aus `TESTED_NEXTCLOUD_MAJORS` (derzeit 35) und `latest` | jeder Pull Request (wenn Quellcode, Tests oder Testserver-Skripte betroffen sind), jeder Push auf `main`, „Run workflow“ |
| `nightly.yml` | `npm run test:int` | die beiden davor (derzeit 33, 34) | nachts auf `main`, wenn es seit der Nacht davor einen Merge gab; die Nacht von Mittwoch auf Donnerstag immer; „Run workflow“ |
| `nightly.yml` | `npm run test:perf` (500 Seiten) | alle aus `TESTED_NEXTCLOUD_MAJORS` und `latest` | wie oben |

Ein Release-Tag startet keine Integrationstests: Der getaggte Stand auf `main` hat sie beim Pull Request und beim Merge bestanden. Vor einem Release lohnt der Blick auf den letzten Lauf von `nightly.yml`; im Zweifel dort „Run workflow“. Die Jobs `latest` dürfen rot sein, sie blockieren keinen Merge. Solange `nextcloud:apache` dasselbe Image wie die aktuelle Version ist, überspringen sie ihre Schritte (`scripts/dev-nextcloud/latest-is-current.sh`).

- Die Nextcloud- und App-Versionen (Collectives, Circles, Text) stehen im Schritt „Versions under test“ und in der Job-Zusammenfassung.
- Neue Hauptversion: Zeigt der Lauf `latest` eine neue Nextcloud-Version grün, die Nummer in `TESTED_NEXTCLOUD_MAJORS` (`src/api/versionCheck.ts`) **und** in den Matrizen ergänzen: in `integration.yml` die neue Version statt der bisherigen, die bisherige wandert in den Job `integration` von `nightly.yml` (die älteste fällt dort heraus, wenn sie nicht mehr getestet wird), und in den Job `performance` von `nightly.yml`. `tests/unit/testedVersions.test.ts` schlägt sonst fehl.
- Lokal gegen eine zweite Version: `NC_VERSION=35 NC_PORT=8135 docker compose -p nc-test-35 up -d --wait` im Ordner `scripts/dev-nextcloud`, dann `NC_PORT=8135 NC_VERSION=35 npm run test:int` (Performance: `npm run test:perf`); Versionen zeigt `sh scripts/dev-nextcloud/versions.sh nc-test-35`.

## Noch offen (außerhalb des Repos, vom Maintainer zu erledigen)

Diese Punkte aus ONC-11 lassen sich nicht per Code im Repo erledigen:

- [ ] **GitHub-Repository anlegen** (Beschreibung und Lizenz MIT siehe unten) und die Spiegelung einschalten: In Forgejo unter Repository › Einstellungen › Actions › Variablen `MIRROR_GITHUB_REPO` (`owner/name`) und unter Secrets `MIRROR_GITHUB_TOKEN` (GitHub-Token, fein granular, nur dieses Repo, Berechtigung „Contents: Read and write“) anlegen. Danach pusht `ci.yml` jeden erfolgreichen Build auf `main` nach GitHub (ohne `--force`), und `release.yml` legt bei einem Tag das GitHub-Release mit den drei Dateien an. Codeberg entfällt (kein Code, der überwiegend mit KI entstanden ist).
- [ ] **BRAT**: Funktioniert, sobald das GitHub-Release existiert: in BRAT „Add beta plugin“ mit `owner/name` des GitHub-Repositories.
- [ ] **Veröffentlichung im Obsidian-Store**: Pull Request gegen `obsidianmd/obsidian-releases` (`community-plugins.json`), das Repository muss dafür öffentlich auf GitHub liegen und eine `README.md`, `LICENSE` und ein Release mit den drei Dateien enthalten. Vorher PLAN §15 Nr. 3 entscheiden.
- [ ] **Screenshots** (Einstellungen, Konflikt-Dialog, Rückfrage beim Löschen, Dateiliste mit Emoji, Protokoll) für README, Obsidian-Detailseite und Community-Seite aufnehmen; ohne echte Servernamen oder Zugangsdaten.
- [ ] **Hilfe- und Detailseiten** in Obsidian sowie die **Community-Seite** `https://community.obsidian.md/plugins/nextcloud-collectives` veröffentlichen, sobald der Store-Eintrag angenommen ist.

## GitHub-Repository

- **Beschreibung** (Feld „About“, höchstens 350 Zeichen): *Obsidian plugin that syncs all Nextcloud Collectives of a server with your vault in both directions – pages, hierarchy, tags, emoji, links and attachments. Conflicts become copies instead of overwrites. Works on desktop and mobile.*
- **Themen**: `obsidian-plugin`, `obsidian-md`, `nextcloud`, `nextcloud-collectives`, `sync`, `markdown`, `webdav`
- **Lizenz**: MIT (die Datei `LICENSE` liegt im Repo; beim Anlegen kein Template und keine README/`.gitignore` hinzufügen, damit der erste Push ohne Konflikt klappt)
- **Sichtbarkeit**: öffentlich (für BRAT und den Store); Standard-Branch `main`
- Issues dort optional ausschalten, wenn Rückmeldungen weiter über Forgejo laufen sollen.
