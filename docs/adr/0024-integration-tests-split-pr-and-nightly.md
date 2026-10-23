# 0024 – Integrationstests aufgeteilt: aktuelle Version und latest pro PR, ältere und Performance nachts

- Status: akzeptiert
- Datum: 2026-10-23
- Bezug: PLAN.md §15 Nr. 6 und 8, ADR 0023

## Kontext

`integration.yml` (ADR 0023) lief bei jedem PR, jedem Push auf `main`, jedem Release-Tag und wöchentlich gegen alle getesteten Nextcloud-Versionen und `latest`, jeweils mit dem Performance-Test (500 Seiten). Ein Lauf blockierte die Docker-LXCs lange. Beim Release-Tag lief dieselbe Suite ein drittes Mal für einen Stand, der sie beim PR und beim Merge schon bestanden hatte.

## Entscheidung

- **`npm run test:int`** schließt den Performance-Test aus; er läuft über **`npm run test:perf`** (`vitest.performance.config.ts`).
- **`integration.yml`**: `test:int` gegen die aktuelle, also neueste Version aus `TESTED_NEXTCLOUD_MAJORS` (derzeit 35), und gegen `latest` (neuestes Image auf Docker Hub, darf als Frühwarnung fehlschlagen); bei jedem PR (Pfadfilter wie bisher, plus `vitest.*.config.ts`), jedem Push auf `main` und manuell. Kein Tag-Auslöser, kein Zeitplan.
- **`nightly.yml`**: auf `main`, täglich 01:00 UTC.
  - Job `integration`: `test:int` gegen die beiden Versionen vor der aktuellen (derzeit 33, 34).
  - Job `performance`: `test:perf` gegen alle getesteten Versionen und `latest` (`latest` darf fehlschlagen).
  - Ein vorgeschalteter Job `changes` lässt die Nacht nur laufen, wenn der Kopf von `main` jünger als 25 Stunden ist (Committer-Datum; Forgejo setzt es beim Merge auf den Merge-Zeitpunkt). In der Nacht von Mittwoch auf Donnerstag (Donnerstag 01:00 UTC) läuft sie immer, damit jede Version mindestens einmal pro Woche getestet ist. Manuell gestartet läuft sie immer.
- **`latest` nur, wenn es von der aktuellen Version abweicht**: Der erste Schritt der `latest`-Jobs (Integration und Performance) vergleicht per Docker-Hub-API den Digest von `nextcloud:apache` mit dem von `nextcloud:<aktuell>-apache` (`scripts/dev-nextcloud/latest-is-current.sh`, aktuell = höchste Zahl in `TESTED_NEXTCLOUD_MAJORS`). Sind sie gleich, überspringt der Job alle weiteren Schritte und ist grün. Weil `<major>-apache` immer auf das neueste Release dieser Hauptversion zeigt, ist ein gleicher Digest dasselbe wie eine gleiche volle Version; ein Vergleich nur der Hauptversion käme auf dasselbe Ergebnis, braucht aber einen laufenden Server. Ist Docker Hub nicht erreichbar, läuft der Job.
- `tests/unit/testedVersions.test.ts` prüft: Die Integrations-Matrizen beider Workflows decken zusammen genau `TESTED_NEXTCLOUD_MAJORS` ab, der PR-Workflow die neueste, der Performance-Job alle.
- Performance-Jobs nutzen eigene Compose-Projekte (`nc-perf-<Version>`) und Ports (82xx), damit sie neben den Integrations-Jobs auf einem Host laufen können.

## Betrachtete Alternativen

- **Letzten erfolgreichen Nightly-Lauf über die Forgejo-API abfragen** und dessen Commit mit `main` vergleichen – genauer, braucht aber ein Token und eine Actions-API, deren Umfang je Forgejo-Version schwankt. Das Committer-Datum reicht, solange per Merge-Commit, Squash oder Rebase gemergt wird.
- **Ein Workflow mit dynamischer Matrix je Auslöser** – weniger doppelte Schritte, aber eine aus Job-Ausgaben berechnete Matrix ist im Forgejo-Runner schwerer zu lesen und zu prüfen als zwei feste Workflows.
- **`latest` per Job-Bedingung ganz weglassen** – eine Bedingung auf Job-Ebene kann einzelne Matrix-Einträge nicht ansprechen; ein eigener Job nur für `latest` hätte alle Schritte ein weiteres Mal wiederholt.
- **Performance-Test weiter in `test:int`, nur nachts per Umgebungsvariable** – lokale Läufe von `test:int` blieben dann langsam.

## Konsequenzen

- positiv: PRs und Merges warten nur auf eine Version (plus `latest`, das nicht blockiert) ohne Performance-Test; eine neue Hauptversion fällt schon im PR auf; die LXCs sind schneller frei. Release-Tags bauen nur noch.
- negativ / Kosten: Ein Fehler, der nur auf einer älteren Version oder nur im Performance-Test auftritt, fällt erst nach dem Merge auf (spätestens in der folgenden Nacht). Fällt eine Nacht aus (Runner aus), wird ein Merge erst mit dem nächsten Merge oder in der Nacht von Mittwoch auf Donnerstag nachgeholt. Ein Fast-Forward-Push mit alten Commits auf `main` löst keine Nacht aus.
- Folgearbeiten: Bei einer neuen Hauptversion die Matrizen in beiden Workflows verschieben (`docs/release.md`).
