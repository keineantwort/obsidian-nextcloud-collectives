# 0023 – Release: Versions-Check, Protokoll-Ansicht, Release-CI

- Status: akzeptiert
- Datum: 2026-10-18
- Bezug: PLAN.md §12, §14 M10, §15 Nr. 3, Issue ONC-11

## Kontext

M10 macht aus dem Entwicklungsstand ein installierbares Plugin: Der Nutzer muss erkennen, wenn der Server außerhalb des getesteten Bereichs liegt, und bei Problemen etwas zum Melden in der Hand haben. Die Release-Artefakte müssen reproduzierbar entstehen.

## Entscheidung

- **Versions-Check** (`src/api/versionCheck.ts`): Bei jedem Lauf liest `runSync` die Nextcloud-Version aus `/ocs/v2.php/cloud/capabilities` und meldet sie dem `SyncController`. Getestet sind die Hauptversionen in `TESTED_NEXTCLOUD_MAJORS` (derzeit 33, 34, 35); ein Unit-Test hält die Liste gleich mit der Matrix von `integration.yml`. Eine andere Hauptversion (älter oder neuer) ergibt **eine** Warnung pro Sitzung und Version; der Sync läuft weiter. Ein fehlschlagender oder unlesbarer Check stoppt nie den Sync, er wird nur protokolliert. Die Collectives-Version ist für Nutzer nicht abfragbar (M0); dafür bleibt `ApiChanged`.
- **Protokoll-Ansicht** (`src/ui/logModal.ts`, `logView.ts`): Befehl „Show log“ und Schaltfläche in den Einstellungen zeigen den Ringpuffer (500 Einträge) als Text mit „Kopieren“. `debugLogging` (Einstellung „Detailed log“) protokolliert zusätzlich jede Anfrage als Methode, Pfad, Status, Dauer über `HttpClient.onAttempt`; nie Header, Bodys oder Passwörter.
- **`deferred`-Zähler**: Ein Push, dessen Remote-Stand auch nach dem zweiten GET unbestätigt bleibt, zählt nicht mehr als `unchanged`, sondern als `deferred` und löst eine Warnung aus (Hinweis aus dem M4-Review).
- **Release-CI** (`.forgejo/workflows/`): `ci.yml` baut, lintet und testet jeden PR und Push auf `main`. `release.yml` läuft bei einem Tag `x.y.z` (ohne `v`, wie Obsidian und BRAT verlangen), prüft per `scripts/check-release.mjs`, dass Tag, `manifest.json`, `package.json` und `versions.json` übereinstimmen, baut, testet und hängt `main.js`, `manifest.json` und `styles.css` einzeln an ein Forgejo-Release. - **Spiegelung nach GitHub**: `ci.yml` pusht nach bestandenem Build jeden Stand von `main` ohne `--force` nach GitHub, `release.yml` legt dort bei einem Tag das Release mit den drei Dateien an (BRAT und Store lesen GitHub). Beides ist aus, solange die Variable `MIRROR_GITHUB_REPO` fehlt; das Token liegt als Secret `MIRROR_GITHUB_TOKEN`.
- **Integrationstests über mehrere Versionen** (`integration.yml`, Auslöser und Aufteilung abgelöst durch [0024](0024-integration-tests-split-pr-and-nightly.md)): Eine Matrix startet je getesteter Nextcloud-Hauptversion einen frischen Docker-Testserver (mit der jeweils neuesten passenden Collectives-Version) und führt `npm run test:int` aus; bei jedem Pull Request mit Änderungen an Code, Tests oder Testserver, bei Push auf `main`, bei Release-Tags, wöchentlich und manuell. Ein neuer Push auf denselben Branch bricht den laufenden Lauf ab. Ein Lauf `latest` ist ein Frühwarnsystem für die nächste Hauptversion und darf fehlschlagen. `scripts/dev-nextcloud/versions.sh` schreibt Nextcloud- und App-Versionen (auch Collectives, das über die API nicht lesbar ist) in jedes Protokoll. PLAN §15 Nr. 8 ist damit umgesetzt, sofern der Runner Docker bietet.

## Betrachtete Alternativen

- **Version hart blockieren** – würde funktionierende neuere Server aussperren; die Strukturprüfung der Antworten schützt zuverlässiger.
- **Protokoll in eine Datei im Vault schreiben** – würde synchronisiert werden bzw. Nutzerdaten berühren; der Ringpuffer im Speicher genügt zum Melden.
- **Versions-Skript über `npm version`** – ändert `package-lock.json` und legt Tags an; hier ist die Version im Pull Request sichtbar und das Tag ein bewusster Schritt.

## Konsequenzen

- positiv: Abweichende Serverversionen fallen auf; Fehlerberichte enthalten ein Protokoll; ein Release ist ein Tag.
- negativ / Kosten: Eine neue Nextcloud-Hauptversion wird erst nach dem Eintrag in `TESTED_NEXTCLOUD_MAJORS` und in der Matrix „getestet“; der `latest`-Lauf zeigt, wann es so weit ist. Die Collectives-Version wird nicht erzwungen, sondern nur protokolliert (der App-Store liefert die neueste passende). Das Protokoll geht beim Neustart verloren.
- Offen (nicht im Repo lösbar): Spiegelung nach GitHub (Codeberg entfällt, da dort kein überwiegend KI-geschriebener Code erlaubt ist), Veröffentlichung im Community-Store, Screenshots und Community-Seite – siehe `docs/release.md`.
