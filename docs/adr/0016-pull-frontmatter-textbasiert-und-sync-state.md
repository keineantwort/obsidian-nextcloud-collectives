# 0016 – Pull: Frontmatter textbasiert, Sync-State als eigene Datei, Konfliktkopie statt Überschreiben

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §6.2, §6.3, §7.3, §7.4, §11, Issue ONC-4 (M3)

## Kontext

M3 schreibt zum ersten Mal Remote-Inhalte in den Vault. Drei Fragen waren offen:

1. Die `nc_*`-Felder müssen ins Frontmatter, ohne das Nutzer-YAML zu verändern. Ändert sich das YAML beim Schreiben (andere Einrückung, Quoting, Reihenfolge), weicht das Remote-Format vom `baseHash` ab. Die nächste Prüfung meldet dann eine lokale Änderung, obwohl der Nutzer nichts getan hat (Ping-Pong, PLAN §6.3).
2. Wo liegt der Sync-State, und wie bleibt ein Leerlauf frei von Schreibzugriffen (Akzeptanzkriterium M3)?
3. Was passiert, wenn am Zielpfad einer Remote-Seite schon eine fremde Datei liegt (Erstsync in einen nicht leeren Vault) oder Inhalt beidseitig geändert wurde, bevor es in M4 den Push gibt?

## Entscheidung

- **Frontmatter textbasiert** (`src/mapping/frontmatter.ts`): Die `nc_*`-Zeilen werden als flache Top-Level-Zeilen (Werte per `JSON.stringify`) vor das Nutzer-YAML gesetzt bzw. samt Fortsetzungszeilen entfernt. Das Nutzer-YAML bleibt byte-genau erhalten. `processFrontMatter` wird für Plugin-Felder nicht verwendet, weil es das ganze YAML neu serialisiert. Geschrieben wird über `vault.create` bzw. `vault.process` (AGENTS Regel 2).
- **Kanonisches Remote-Format**: `baseHash` = SHA-256 von `canonicalRemote(remote)` = `toRemote(toLocal(remote))`, d. h. Normalform des Text-Editors (ADR 0005). Ein Server-Text, der nicht in Normalform ist, gilt damit nicht als lokal geändert.
- **Sync-State in `sync-state.json`** im Plugin-Ordner (über `app.vault.adapter`, keine Notiz), getrennt von `data.json`. `StateStore.save` schreibt nur, wenn sich die stabil serialisierte Fassung geändert hat. Zusätzlich zu PLAN §6.3: `localMtime` (mtime nach dem letzten eigenen Schreiben, statt `lastSyncedAt` für die Erkennung lokaler Änderungen), `status` (`synced`/`conflict`), `conflictPath`.
- **Branded IDs** (`CollectiveId`, `PageId`, `TagId`, `AttachmentId`) in `src/api/types.ts`, damit IDs im State nicht vertauscht werden können.
- **Konfliktkopie statt Überschreiben schon in M3**: Ist der Zielpfad belegt oder sind beide Seiten verschieden geändert, bleibt die lokale Datei unverändert. Die Remote-Fassung landet als `Titel (Konflikt YYYY-MM-DD HHmm).md` daneben (ohne `nc_*`, nicht synchronisiert). Der State merkt sich den Konflikt, damit der nächste Lauf keine weitere Kopie erzeugt. Eine Kollisionsdatei (`status: conflict`, `baseHash: ''`) bekommt nie `nc_*`-Felder. Sie wird nur verknüpft, wenn ihr Text dem Remote-Text gleicht.
- **Strukturänderungen in M3 nur protokolliert**: Remote umbenannt/verschoben/gelöscht, lokal gelöscht, Collective umbenannt/entfernt → Skip mit Grund im Log, Umsetzung in M5. Lokal gelöschte Seiten werden nie neu angelegt.
- **Konto-Bindung**: Gehört ein State mit Seiten zu einer anderen Server-URL oder einer anderen Nextcloud-User-ID, bricht der Lauf ohne Schreibzugriff ab (`serverMismatch`).

## Betrachtete Alternativen

- **`processFrontMatter` für die `nc_*`-Felder** – offizielle API, aber sie formatiert das Nutzer-YAML um und erzeugt damit Scheinänderungen.
- **YAML-Bibliothek** – neue Abhängigkeit (AGENTS Regel 8), und das Neu-Serialisieren hätte dasselbe Problem.
- **State in `data.json`** (eigener Key über `saveData`) – jede State-Änderung würde die Settings mitschreiben. Für die Absturzsicherheit (Speichern nach jeder Operation) ist eine eigene Datei klarer.
- **Kollision überspringen bzw. Suffix „ (2)“** – Überspringen holt die Seite nie; ein Suffix führt in M5 zu einem doppelten Upload der lokalen Datei. Mit dem Nutzer abgestimmt: Konfliktkopie.

## Konsequenzen

- positiv: Leerlauf ohne Schreibzugriffe (Vault und State), Nutzer-YAML bleibt unangetastet, kein Datenverlust bei Kollisionen.
- negativ / Kosten: Die textbasierte Erkennung kennt nur `\n` als Zeilentrenner (CRLF-Dateien haben für das Plugin kein Frontmatter). Setzt der Nutzer `nc_*`-Felder über die Properties-Ansicht um, schreibt der nächste Metadaten-Pull sie wieder in der Plugin-Form.
- Folgearbeiten: M4 (Konflikt-Dialog wertet `status`/`conflictPath` aus; Push darf Seiten mit `status: conflict` nicht hochladen), M5 (Strukturfälle, Kollisionsdateien ohne `nc_page_id` nicht als neue Seite hochladen, Text im Erstsync-Dialog zum Upload anpassen), M6 (Push der Metadaten, `tagsProperty`).
