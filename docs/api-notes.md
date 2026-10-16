# API-Notizen (Ergebnis M0)

Stand: 2026-10-16 · Issue: ONC-1 · Branch: `m0-verifikation`

Alle Aussagen wurden gegen den lokalen Docker-Testserver geprüft (`scripts/dev-nextcloud/`), zusätzlich gestützt durch die Lektüre des Collectives-Quellcodes im Tag `v4.7.1`. Reproduzierbar mit:

```bash
scripts/dev-nextcloud/down.sh --reset && scripts/dev-nextcloud/up.sh
node scripts/m0-spike/record-fixtures.mjs     # schreibt tests/fixtures/m0/ und findings.json
```

## 1. Getestete Versionen

| Komponente | Version |
|---|---|
| Nextcloud | 33.0.10 (Image `nextcloud:33-apache`, SQLite) |
| Collectives | 4.7.1 |
| Circles (Teams) | 33.0.0 |
| Text | 7.0.1 |
| Obsidian-API (`obsidian` npm) | 1.14.4 neueste; Secret Storage ab 1.11.4 |

Collectives taucht **nicht** in `/ocs/v2.php/cloud/capabilities` auf. Die App-Version ist für normale Nutzer nicht abfragbar (`/ocs/v1.php/cloud/apps/collectives` → 403 „must be an admin“). Konsequenz für den Versions-Check (PLAN §12): nur die Nextcloud-Version aus den Capabilities prüfen. Die Collectives-Kompatibilität sichern wir über die Strukturprüfung der Antworten (`ApiChanged`).

## 2. Grundlagen

- OCS-Basis, Header und `{ ocs: { meta, data } }`-Hülle wie geplant. Fehler kommen als HTTP-Status (400/403/404) mit `ocs.data` = `[]` oder leerem Body.
- `collectivePath` ist pro Nutzer konfigurierbar. Standard ist der **versteckte** Ordner `.Collectives/<Name>`. Den WebDAV-Pfad immer aus `collectivePath` + `filePath` + `fileName` zusammensetzen, nie fest kodieren.
- Seiten-ID = File-ID der Markdown-Datei (bestätigt). Der Header `OC-FileId` hat die Form `00000102ociwh6q3y314`: File-ID mit Nullen aufgefüllt, dahinter die Instanz-ID.

## 3. Endpunkte (PLAN §4.2)

| Endpunkt | Ergebnis |
|---|---|
| `GET /collectives` | `{ collectives: Collective[] }`. Relevante Felder: `id`, `circleId`, `name`, `slug`, `emoji`, `level`, `canEdit`, `trashTimestamp` |
| `POST /collectives` | `name`, `emoji?` ✔ → `{ collective, info }`. Legt die Startseite `Readme.md` mit Willkommenstext an |
| `PUT /collectives/{id}` | **nur `emoji`**, kein Umbenennen |
| Collective umbenennen | über Circles: `PUT /ocs/v2.php/apps/circles/circles/{circleId}/name` mit `{ "value": "Neuer Name" }` ✔. Collective-ID bleibt, `name`, `slug` und WebDAV-Ordner ändern sich mit |
| `DELETE /collectives/{id}` | verschiebt in den Collectives-Papierkorb. **Nur Circle-Admin/Owner** (Level ≥ 8), Mitglieder erhalten 403 ✔ |
| `GET /collectives/trash`, `PATCH /collectives/trash/{id}` | Papierkorb-Liste bzw. Wiederherstellen ✔. `DELETE /collectives/trash/{id}` löscht endgültig und wird vom Plugin nie aufgerufen |
| `GET …/pages` | `{ pages: PageInfo[] }` ✔ |
| `GET …/pages/{id}` | `{ page }` ✔ |
| `POST …/pages/{parentId}` | `title` ✔ → `{ page }`. Der Server bereinigt den Titel (siehe §6) |
| `GET …/pages/{id}/touch` | funktioniert, wird aber **nicht benötigt** (siehe §5) |
| `PUT …/pages/{id}` | `title` und/oder `parentId` ✔. Die File-ID bleibt |
| `PUT …/pages/{id}/to/{newCId}` | ✔, Antwort `data: []`. ID und Emoji bleiben, **Tags gehen verloren** (Tags gehören zum Collective) |
| `PUT …/pages/{id}/emoji` | `emoji` als String bzw. `null` zum Entfernen ✔ |
| `PUT`/`DELETE …/pages/{id}/tags/{tagId}` | ✔, idempotent (doppelt hinzufügen/entfernen → 200) |
| `DELETE …/pages/{id}` | in den Papierkorb ✔. Eine Elternseite nimmt Unterseiten und Anhänge mit |
| `GET …/pages/trash` | ✔. Bei Blattseiten trägt `fileName` im Papierkorb das Suffix `.d<timestamp>` |
| `PATCH …/pages/trash/{id}` | Wiederherstellen ✔, inkl. Unterseiten und Anhängen |
| `GET …/tags` | `{ tags: [{ id, collectiveId, name, color }] }` |
| `POST …/tags` | `name` **und** `color` sind Pflicht. `color` = 6 Hex-Zeichen **ohne `#`** oder `""`. Duplikat → 400. Namen sind auf SQLite case-sensitiv (`Projekt` ≠ `projekt`), auf MySQL je nach Collation evtl. nicht. Daher vor dem Anlegen case-insensitiv gegen den Tag-Cache prüfen |
| `GET …/pages/{id}/attachments` | `{ attachments: [{ id, name, filesize, mimetype, timestamp, path, src, internalPath, hasPreview, type }] }`. **Kein ETag**: ETags per PROPFIND holen |
| `POST …/pages/{id}/attachments` | Multipart, Feld `file` ✔. Bei Namenskollision benennt der Server um: `name (1).ext` |
| `DELETE …/pages/{id}/attachments/{attId}` | ✔ (Anhang landet im Papierkorb, Restore per `PATCH …/attachments/trash/{attId}`) |

Zusätzlich vorhanden und für später interessant: `PUT …/attachments/{attId}` (umbenennen), `PATCH …/attachments/trash/{attId}`, `GET /collectives/{cId}/search?searchString=…`.

## 4. PageInfo (PLAN §4.3)

Vollständige Felder (Fixture `pages-list-final.json`): `id`, `slug`, `lastUserId`, `lastUserDisplayName`, `emoji`, `subpageOrder`, `isFullWidth`, `tags` (**Liste von Tag-IDs** ✔), `trashTimestamp`, `title`, `timestamp` (mtime, Unix-Sekunden), `size`, `fileName`, `filePath` (relativ zum Collective, `""` für die Root-Ebene), `filePathString`, `collectivePath`, `collectiveNameWithEmoji`, `parentId`, `shareToken`, `linkedPageIds`.

Besonderheiten:
- Startseite: `title` = „Landing page“ (lokalisiert), `slug` = `""`, `parentId` = 0.
- Per WebDAV angelegte Seiten haben `slug = ""`, bis sie über die API umbenannt werden.
- `linkedPageIds` berechnet der Server bei jedem Schreiben aus den Links im Inhalt.

## 5. Dateistruktur und WebDAV (PLAN §4.4, §4.5)

- **Blatt → Elternseite** (`Titel.md` → `Titel/Readme.md`): Die **File-ID bleibt erhalten** ✔. Der Anhang-Ordner wandert mit (`.attachments.97/` → `Onboarding/.attachments.97/`) ✔.
- **Anhang-Ordner**: `.attachments.{pageId}/` im Elternordner der Seitendatei ✔, bei Elternseiten also im eigenen Ordner neben `Readme.md`. Zusätzlich listet Collectives als Anhänge vom Typ `folder` alle Nicht-Markdown-Dateien im Ordner einer Elternseite.
- Elternseiten bleiben Ordner, auch wenn ihre letzte Unterseite verschwindet (`Titel/Readme.md` ohne Geschwister ist zulässig).
- Ein Ordner ohne `Readme.md` bekommt beim nächsten Auflisten automatisch eine (leere) `Readme.md`.
- **Roh-WebDAV wird erkannt**: Per `PUT` angelegte `.md`-Dateien erscheinen als Seiten, `MOVE` benennt um bzw. verschiebt (ID bleibt), `DELETE` landet im Collectives-Papierkorb. Das ersetzt den in M0 geplanten Schnelltest mit Nextcloud Sync, denn genau diese WebDAV-Operationen führt Nextcloud Sync aus.
- `GET` liefert `ETag`. `PUT` mit passendem `If-Match` → 204 plus neuer `ETag`, der dem nächsten `GET` entspricht ✔. Veralteter oder falscher `If-Match` → **412** ✔. `If-None-Match: *` legt nur neu an (201) und liefert 412, wenn die Datei existiert. Nützlich gegen versehentliches Überschreiben.
- `PROPFIND` Depth 1 mit `getetag`, `getlastmodified`, `getcontentlength`, `oc:fileid`, `resourcetype` ✔ (Fixture `dav-propfind-depth1.body.xml`). `Depth: infinity` funktioniert auf dem Testserver. Darauf verlassen wir uns nicht, weil Admins es abschalten können.
- **`touch` ist überflüssig**: Der `NodeWrittenListener` von Collectives setzt bei jedem WebDAV-Schreibzugriff `lastUserId`, verschickt die Änderungsbenachrichtigung und aktualisiert `linkedPageIds` (`lib/Listeners/NodeWrittenListener.php`). Den `touch`-Aufruf nach `PUT` streichen wir.

## 6. Titel und Dateinamen (PLAN §6.4)

Der Server bereinigt Titel selbst (`NodeHelper::sanitiseFilename`): `/` → `-`, entfernt `* | \ : " < > ?`. Beispiel: `A/B: Fragen? #1 [x]` → `A-B Fragen #1 [x]`. Bei Namenskollision hängt er ` (2)`, ` (3)` … an (`generateFilename`).

Folgen für das Mapping:
- Remote-Titel können von den für Obsidian problematischen Zeichen nur noch `# ^ [ ]` enthalten. Nur dafür ist `nc_title` nötig.
- Lokal umbenannt mit einem der vom Server entfernten Zeichen: Der Server speichert einen anderen Titel. Das Plugin muss den Titel aus der Antwort übernehmen, sonst entsteht ein Rename-Ping-Pong.

## 7. Links (PLAN §9.1)

Code-Lektüre (`src/views/PagePicker.vue`, `src/stores/pages.js`, `lib/Fs/MarkdownHelper.php`) und Server-Test (`linkedPageIds` in `page-get-with-links.json`):

- **Der Link-Picker in Collectives schreibt absolute URLs**: `{origin}/index.php/apps/collectives/{collectiveSlug}-{collectiveId}/{pageSlug}-{pageId}`. Ohne Pretty-URLs steht `/index.php` im Pfad, mit Pretty-URLs nicht.
- Für Seiten ohne Slug erzeugt das Frontend `…/{collectivePfad}/{Pfad/Titel}?fileId={id}`.
- **Der Server erkennt beim Schreiben drei Formen** als Seitenlink (alle drei bestätigt):
  1. relativ: `[Urlaub](Prozesse/Urlaub.md?fileId=100)`
  2. absolut auf eine Trusted Domain: `https://host/index.php/apps/collectives/Handbuch-1/Onboarding-97`
  3. root-relativ: `/index.php/apps/collectives/Handbuch-1/Prozesse-98#abschnitt`

  Der Collective-Teil darf `{slug}-{id}` oder der URL-kodierte Name sein. Anker und Query hinter der ID werden ignoriert.
- Bilder schreibt die Text-App als `![name](.attachments.{pageId}/name)`. Das bestätigt das `src`-Feld der Anhang-API.
- Vorschlag für die Richtung lokal → remote: **relativer Link mit `?fileId=`**. Er ist serverunabhängig, wird für Backlinks erkannt und entspricht dem Plan. Absolute Links aus dem Link-Picker werden beim Pull ebenfalls aufgelöst.

## 8. Obsidian

- `app.secretStorage` (`setSecret`, `getSecret`, `listSecrets`) **ab 1.11.4** ✔. `SecretComponent` für die Settings-UI ab 1.11.1. Secret-IDs: Kleinbuchstaben, Ziffern, Bindestriche.
- Die deklarative Settings-API (`getSettingDefinitions`, `SettingDefinition*`) gibt es ab 1.13.0.
- Empfehlung `minAppVersion`: **1.11.4**, Settings-Tab klassisch per `PluginSettingTab`.

## 9. Manuelle Prüfung im Browser (2026-10-16)

Durchgeführt in der Collectives-Oberfläche des Testservers (Pretty-URLs aktiv), Collective „Admins Wiki“, Seiten „Linktest“ und „Ziel“.

**Frontmatter:** Der Text-Editor zeigt YAML-Frontmatter als Codeblock an. Beim Speichern im Browser bleibt der Block byte-genau erhalten, ebenso alle Links. Der Editor normalisiert aber: **Leerzeile nach dem schließenden `---`** einfügen, **abschließenden Zeilenumbruch entfernen**. Das Remote-Format des Plugins sollte genau diese Normalform erzeugen (ADR 0005).

**Links** (Klick im Editor):

| Form | Ergebnis |
|---|---|
| `Ziel.md?fileId=138` | ✔ öffnet Ziel |
| `http://host/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ neuer Tab, „Collective nicht gefunden“ |
| `/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ neuer Tab, „Collective nicht gefunden“ |
| `/apps/collectives/Admins-Wiki-3/Ziel-138` | ✔ |
| `Ziel.md` | ✔ (vom Server aber nicht als Seitenlink erkannt) |
| `Ziel.md?fileId=138#abschnitt-zwei` | ✔ (Anker nicht prüfbar, Seite zu kurz) |

→ Push schreibt relative Links mit `?fileId=` (ADR 0008). Ursache für die `/index.php/`-Fehlschläge ist offen (vermutlich Pretty-URLs). Für den Pull ist sie irrelevant, weil wir alle Formen auflösen.

**Gleichzeitige Bearbeitung** (zwei Durchläufe, ADR 0012): Ein WebDAV-`PUT` während einer offenen Editor-Sitzung führt nach einigen Sekunden zur Meldung „Die Bearbeitungssitzung ist abgelaufen. Bitte die Seite neu laden.“ (Button „Aktualisieren“). Der Editor lässt weiter tippen, speichert aber nichts mehr. **Die WebDAV-Fassung gewinnt**, Browser-Eingaben nach der Meldung gehen verloren. Bereits per Autosave gespeicherte Browser-Änderungen sind sicher: Entweder liest das Plugin sie vor dem `PUT`, oder sein `PUT` scheitert mit 412.

## 10. Weitere Server-Befunde

- **Kein `oc:checksums`** auf Collectives-Dateien (PROPFIND → 404 für die Property). Die Remote-Identität einer Version ist der ETag.
- **ETags pflanzen sich nach oben fort**: Eine Inhaltsänderung in `Handbuch/Onboarding/Erster Tag.md` ändert die ETags von `Onboarding/`, `Handbuch/` und `.Collectives/`. Ein `PROPFIND` mit `Depth: 0` auf `.Collectives/` taugt daher als günstiger Leerlauf-Check für Inhalte. **Achtung:** Emoji, Tags und Seitenreihenfolge liegen nur in der Datenbank und ändern keinen ETag. Die Seitenliste muss trotzdem regelmäßig geladen werden (z. B. bei jedem Intervall-Lauf, der Root-ETag-Check spart nur die Inhalts-GETs).
- Die OCS-Seitenliste liefert **keinen `ETag`-Header**, bedingte GETs (304) sind dort nicht möglich.

## 10a. Befunde aus M2 (API-Clients, ONC-3)

- **ETags haben Sekundenauflösung – `If-Match` schützt nicht innerhalb derselben Sekunde.** Nextcloud bildet den ETag aus der mtime in ganzen Sekunden. Zwei Schreibzugriffe in derselben Sekunde liefern denselben ETag. Nachgestellt am Testserver (2026-10-16, Roh-WebDAV ohne Plugin-Code): `PUT` neu (201, ETag A) → `PUT` mit `If-Match: A` (204, ETag **A**) → `PUT` mit dem jetzt veralteten `If-Match: A` (204 statt 412). Der zweite Inhalt war damit kommentarlos überschrieben. Folge für M4: Eine `PUT`-Antwort, deren ETag dem gesendeten `If-Match` entspricht, beweist nicht, dass seitdem niemand geschrieben hat. Gegenmaßnahme wird in M4 entschieden (z. B. solche Antworten als unsicher werten und nach > 1 s neu lesen und vergleichen). Der Integrationstest wartet deshalb vor dem ersten Schreibzugriff über die Sekundengrenze.
- **Seiten-Papierkorb ohne `collectivePath`**: `GET …/pages/trash` liefert `collectivePath: null` (Fixture `pages-trash-list.json`), alle übrigen PageInfo-Felder wie gewohnt. Der Client gibt dort den Typ `TrashedPage` zurück (`collectivePath: string | null`), `PageInfo` bleibt strikt. Nach dem Restore (`PATCH …/pages/trash/{id}`) ist `collectivePath` wieder gesetzt.
- **Weiterleitungen und `Authorization`-Header: nicht verifiziert.** Die Obsidian-Typen dokumentieren das Redirect-Verhalten von `requestUrl` nicht, und der Integrationstest läuft mit Node-`fetch` statt `requestUrl`. Ob ein Redirect auf einen fremden Host den Basic-Auth-Header mitnimmt (Desktop: Electron/Chromium, Mobile: native HTTP-Stacks), ist nur in Obsidian selbst prüfbar. Offen für die manuelle Prüfung (spätestens M9, `docs/manual-test.md`). Bis dahin gilt: Die Server-URL wird normalisiert, und der Client sendet nur an `baseUrl + Pfad`, Pfade mit `://` lehnt er ab.
- Unerwartete Statuscodes: `MKCOL` auf einen existierenden Ordner → 405 (`ServerError`), Mitglied löscht Collective → 403 (`ForbiddenError`, ADR 0015).

## 11. Referenzprojekte (PLAN §18)

Gesichtet nur lesend, ohne Build oder Ausführung.

### Nextcloud Sync – siosig/obsidian-nextcloudsync

MIT, „Copyright (c) 2026 Daisuke ITO“, Commit `cff8b216f0e2d818d221bb3c24c08eed4b62226e` (2026-10-10). `minAppVersion` 1.13.0, `isDesktopOnly: false`. Bei Code-Übernahme Copyright und Commit im Code und in der README nennen.

Übernehmen (Muster, mit Dateiangaben im Referenz-Repo):

| Thema | Muster | Fundstelle |
|---|---|---|
| Login Flow v2 | `POST /index.php/login/v2` per `requestUrl`, 404/405 → „nicht unterstützt“ (Fallback App-Passwort). Polling alle 2 s, Deadline 20 min (= Token-Lebensdauer am Server). **Zwischen den Polls auf Timer _oder_ App-Resume warten**: Android friert `setTimeout` ein, solange der Browser vorne ist (dort Issue #34) | `src/auth/LoginFlowV2.ts:17-92` |
| Login-URL | `window.open(loginUrl, '_blank')` auf allen Plattformen. Bei uns zusätzlich Fallback: Link anzeigen/kopierbar, wenn `window.open` `null` liefert; Abbrechen-Button | `src/settings/SettingTab.ts:210` |
| Secret Storage | `app.secretStorage.setSecret/getSecret`, in `data.json` nur die Secret-ID; UI über `SecretComponent` | `src/settings/SettingTab.ts:117-127, 243-254` |
| If-Match/412 | ETag normalisiert in Anführungszeichen senden, 412 → eigene Fehlerklasse → Konfliktbehandlung statt Überschreiben | `NextcloudClient.ts:392-403`, `SyncEngine.ts:905-918` |
| Root-ETag-Short-Circuit | Depth-0-PROPFIND auf die Wurzel; unverändert → kein Voll-Scan, jeder 20. Lauf trotzdem voll | `NextcloudClient.ts:230-249`, `util/limits.ts:19` |
| Wartungsmodus | vor dem Sync `GET /status.php` (ohne Auth), `maintenance: true` → Lauf auslassen; Sabre-Exceptions im Fehler-XML per `DOMParser` auf verständliche Meldungen abbilden | `NextcloudClient.ts:122-180`, `NextcloudErrorParser.ts:3-25` |
| Mobile-Trigger | Start-Sync mit kurzer Verzögerung nach `onLayoutReady`; Resume über `visibilitychange` **und** `window.focus` mit 5-min-Cooldown; Intervall-Timer nur auf Desktop; Debounce nach `modify` plus „wird gerade bearbeitet“-Sperre für eingehende Schreibvorgänge | `main.ts:143-248, 544-549`, `util/appResume.ts` |
| Eigene Events | pfadbasierte Ignore-Liste mit TTL (5 s), Einträge nicht beim ersten Event verbrauchen (ein Write löst mehrere Events aus) | `src/data/LocalAdapter.ts:58, 90-103` |
| Massenlösch-Schutz | Schwelle `max(20, 20 % der bekannten Dateien)`; nur lokal unveränderte Kandidaten; jeden Kandidaten vor dem Löschen einzeln gegenprüfen; leeres/kaputtes Listing ist ein Fehler, nicht „alles gelöscht“ | `util/limits.ts:21-41`, `SyncEngine.ts:1127-1163`, `network/dav/propfind.ts:23-53` |
| PROPFIND-Parser | `DOMParser` + `getElementsByTagNameNS` (präfixunabhängig), BOM entfernen, `<parsererror>` erkennen (Blink wirft nicht), Root muss `DAV:multistatus` sein | `src/network/dav/propfind.ts:25-152` |
| Timeout | `requestUrl` hat kein Timeout → `Promise.race` gegen `window.setTimeout` (30 s); Retry nur für lesende Requests | `src/network/requestWithTimeout.ts` |
| Tests | Docker-Nextcloud mit Post-Install-Hook und Healthcheck auf `status.php` (dieses Muster nutzt bereits `scripts/dev-nextcloud`). Im Integrationstest `requestUrl` per Mock auf Node-`fetch` abbilden (nur in Tests!). CI dort nur für reine Unit-Tests | `tests/docker/`, `tests/b1-nextcloud-headless/__mocks__/obsidian.ts` |

Nicht übernehmen: Schreiben über `DataAdapter` statt Vault-API (verstößt gegen AGENTS Regel 2); Polling, das jeden Nicht-2xx-Status als „pending“ wertet (bei uns nur 404 als pending); OCS v1 (wir nutzen v2); Diff3-/Frontmatter-Merge und Chunked Upload (außerhalb Scope v1).

### NextDeck – onlymykazari/obsidian-nextcloud-deck

MIT, „Copyright (c) 2026 Ismail Ivanov“ (Upstream-Autor des Kanban-Teils), Commit `045710f8b5c06c0d1b4ab3a467d5c5db93f287bf` (2026-07-19). Plain JavaScript, `minAppVersion` 1.5.0.

Übernehmen:
- **Sync-Log-Ringpuffer** mit strukturierten Einträgen `{ at, event, …}`, Modal mit „Neueste oben“, „Leeren“, „Diagnose kopieren“ (`src/plugin.js:414-438`, `src/sync-log-modal.js`). Für uns typisiert, 500 Einträge (PLAN §12) und beim Export eine **Allowlist** statt Blacklist.
- **Reiner Mapper ohne Obsidian-Import** plus Baseline-Snapshot pro Objekt (`src/sync-mapper.js`, `conflict.js`). Das bestätigt unseren Schnitt `planner`/`mapping`.

Nicht übernehmen: Credential-„Verschlüsselung“ mit Schlüssel im `localStorage` (faktisch Klartext); globales `reconciling`-Flag zur Event-Unterdrückung (verschluckt echte Nutzer-Edits, späte Events rutschen durch); Remote-IDs nur in `data.json` (bei uns im Frontmatter); Neu-Generieren ganzer Notizen über `vault.modify`/Adapter (Regel 2 und 4); Intervall-Timer ohne Plattformunterscheidung.
