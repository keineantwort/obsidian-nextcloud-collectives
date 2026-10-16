# PLAN – Obsidian-Plugin „Nextcloud Collectives Sync“

Status: Entwurf v1 · Stand: 2026-10-15
Plugin-ID: `nextcloud-collectives` · Lizenz: MIT

Dieses Dokument ist die verbindliche Spezifikation für die Umsetzung durch Coding-Agents (Claude Code, Codex). Abschnitte mit **[VERIFIZIEREN]** beruhen auf Code-Lektüre des Collectives-Repos und müssen in Meilenstein M0 gegen den echten Server bestätigt werden, bevor darauf aufgebaut wird.

---

## 1. Ziel

Obsidian wird das primäre Frontend für Nextcloud Collectives. Ein Obsidian-Community-Plugin synchronisiert alle Collectives eines Servers bidirektional und automatisch mit dem Vault. Jede Aktion in Obsidian (Anlegen, Bearbeiten, Umbenennen, Verschieben, Löschen) wird in Collectives nachvollzogen; Löschungen nur nach Bestätigung. Seiten werden lokal als normale Markdown-Dateien bearbeitet; Hierarchie, Umbenennen, Verschieben, Tags, Emojis, Links und Anhänge werden in beide Richtungen übertragen.

## 2. Scope v1

| Bereich | Inhalt |
|---|---|
| Plattform | Desktop (macOS, Windows, Linux) und Mobile (iOS, Android), `isDesktopOnly: false` |
| Sync | Bidirektional, automatisch (Intervall, nach Speichern, beim Start/Foreground) plus manuell |
| Seiten | Auflisten, Lesen, Bearbeiten, Anlegen, Umbenennen, Verschieben, Papierkorb |
| Collectives | Ein Server pro Vault; alle Collectives des Servers bilden den gesamten Vault (je Collective ein Ordner auf oberster Ebene); neue Collectives in beide Richtungen (M5) |
| Metadaten | Emoji und Tags als Frontmatter |
| Links | Wikilinks ↔ Collectives-Links, Rundlauf-stabil |
| Anhänge | Bilder/Dateien in beide Richtungen |
| Konflikte | Erkennung per ETag, Konfliktdatei + Auflöse-Dialog |

### Nicht-Ziele v1

- Echtzeit-Kollaboration (Nextcloud-Text-Sessions/Yjs)
- Öffentliche Freigaben (Share-API), Templates, Mitgliederverwaltung, Berechtigungs-Level
- Sync von Seitenreihenfolge (`subpageOrder`) aus Obsidian heraus
- Mehrere Nextcloud-Server in einem Vault (bewusst ausgeschlossen: ein Vault = ein Server)
- Teilauswahl von Collectives (der Vault spiegelt immer alle Collectives, auf die der Nutzer Zugriff hat)
- Merge auf Zeilenebene (3-Wege-Merge) – nur Konflikterkennung

## 3. Rahmenbedingungen und Tech-Stack

| Thema | Vorgabe |
|---|---|
| Sprache | TypeScript, `strict: true` |
| Build | esbuild, Basis: offizielles `obsidian-sample-plugin` |
| HTTP | ausschließlich `requestUrl` aus `obsidian` (umgeht CORS, läuft mobil). Kein `fetch`, keine Node-Module |
| Hashing | Web Crypto `crypto.subtle.digest('SHA-256', …)` |
| Dateizugriff | nur Obsidian Vault-API (`app.vault`, `app.fileManager`), kein `fs` |
| Tests | Vitest für reine Logik; Integrationstests gegen Nextcloud in Docker |
| Lint | ESLint mit `eslint-plugin-obsidianmd` (Regeln für Community-Plugins) |
| Mindestversion | Obsidian ≥ 1.11.4 wegen Secret Storage (genaue Einführungsversion der API in M0 bestätigen); ≥ 1.13.0, falls die deklarative Settings-API genutzt wird |
| Server | Nextcloud mit Collectives-App, OCS-API `v1.0` (Version des Zielservers in M0 dokumentieren) |

## 4. Schnittstellen zum Server

### 4.1 Grundlagen

- OCS-Basis: `{server}/ocs/v2.php/apps/collectives/api/v1.0`
- Pflicht-Header: `OCS-APIRequest: true`, `Accept: application/json`
- Antworten sind in `{ ocs: { meta, data } }` gekapselt → Client entpackt `data`.
- Auth: HTTP Basic mit Benutzername + App-Passwort.
- Seiteninhalt liegt **nicht** in der OCS-API, sondern als Datei. Lesen/Schreiben per WebDAV:
  `{server}/remote.php/dav/files/{user}/{collectivePath}/{filePath}/{fileName}`
- Seiten-ID = Nextcloud-File-ID der Markdown-Datei.

### 4.2 Verwendete OCS-Endpunkte

| Zweck | Methode + Pfad | Parameter |
|---|---|---|
| Collectives auflisten | `GET /collectives` | – |
| Collective anlegen | `POST /collectives` | `name`, `emoji?` [VERIFIZIEREN] |
| Seiten eines Collectives | `GET /collectives/{cId}/pages` | → `{ pages: PageInfo[] }` |
| Eine Seite | `GET /collectives/{cId}/pages/{id}` | → `{ page }` |
| Seite anlegen | `POST /collectives/{cId}/pages/{parentId}` | `title`, `templateId?` |
| Seite „touch“ (letzter Bearbeiter) | `GET /collectives/{cId}/pages/{id}/touch` | – |
| Verschieben/Umbenennen | `PUT /collectives/{cId}/pages/{id}` | `parentId?`, `title?`, `index?`, `copy=false` |
| In anderes Collective verschieben | `PUT /collectives/{cId}/pages/{id}/to/{newCId}` | `parentId?`, `index?`, `copy=false` |
| Emoji setzen/entfernen | `PUT /collectives/{cId}/pages/{id}/emoji` | `emoji` (null = entfernen) |
| Tag zuweisen / entfernen | `PUT` / `DELETE /collectives/{cId}/pages/{id}/tags/{tagId}` | – |
| Seite in Papierkorb | `DELETE /collectives/{cId}/pages/{id}` | – |
| Tags des Collectives | `GET /collectives/{cId}/tags` | – |
| Tag anlegen | `POST /collectives/{cId}/tags` | `name`, `color` [VERIFIZIEREN] |
| Anhänge auflisten | `GET /collectives/{cId}/pages/{id}/attachments` | – |
| Anhang hochladen | `POST /collectives/{cId}/pages/{id}/attachments` | multipart, Feld `file` |
| Anhang löschen | `DELETE /collectives/{cId}/pages/{id}/attachments/{attId}` | – |
| Seiten-Papierkorb | `GET /collectives/{cId}/pages/trash` | – (nur für Lösch-Erkennung/Restore) |

### 4.3 PageInfo-Felder (relevant)

`id`, `slug`, `title`, `emoji`, `tags` (Liste von Tag-IDs [VERIFIZIEREN]), `timestamp` (mtime), `size`, `fileName`, `filePath`, `collectivePath`, `parentId`, `subpageOrder`, `lastUserId`, `linkedPageIds`, `trashTimestamp`.

### 4.4 Dateistruktur auf dem Server

- Startseite eines Collectives: `Readme.md` im Collective-Root, `parentId = 0`.
- Seite ohne Unterseiten: `Titel.md`.
- Seite mit Unterseiten: Ordner `Titel/` mit `Titel/Readme.md`; Unterseiten liegen im Ordner.
- Anhänge: Ordner `.attachments.{pageId}/` neben der Seitendatei [VERIFIZIEREN].
- Wird eine Blattseite zur Elternseite, wandelt Collectives `Titel.md` in `Titel/Readme.md` um. Ob die File-ID erhalten bleibt: [VERIFIZIEREN].

### 4.5 WebDAV

| Zweck | Aufruf |
|---|---|
| Inhalt lesen | `GET` → Body + `ETag`-Header |
| Inhalt schreiben | `PUT` mit `If-Match: <etag>` → `412` bedeutet Konflikt |
| ETags mehrerer Dateien | `PROPFIND` Depth 1 mit `getetag`, `getlastmodified`, `oc:fileid` |
| Anhang laden | `GET` auf `.attachments.{id}/{name}` |

Nach erfolgreichem `PUT` wird `touch` aufgerufen, damit Collectives den letzten Bearbeiter aktualisiert [VERIFIZIEREN, ob nötig].

## 5. Architektur

```
src/
  main.ts                 Plugin-Lebenszyklus, Commands, Event-Registrierung
  settings/
    types.ts              Settings-Interface, Defaults
    settingsTab.ts        UI
  api/
    http.ts               requestUrl-Wrapper: Auth, Timeouts, Retry, Fehlerklassen
    ocsClient.ts          OCS-Aufrufe, Entpacken von ocs.data
    webdavClient.ts       GET/PUT/PROPFIND/MKCOL/DELETE, XML-Parsing via DOMParser
    collectivesApi.ts     typisierte Fachmethoden (listPages, createPage, …)
    loginFlow.ts          Nextcloud Login Flow v2
    types.ts              Collective, PageInfo, Tag, Attachment
  sync/
    state.ts              persistenter Sync-Zustand (siehe 6.3)
    localScanner.ts       erfasst lokale Dateien + Hashes
    remoteScanner.ts      erfasst Remote-Seiten + Metadaten
    planner.ts            REINE Funktion: (state, local, remote) → Operationen
    executor.ts           führt Operationen aus, aktualisiert State
    conflicts.ts          Konfliktdateien, Auflösung
    scheduler.ts          Intervall, Debounce nach Speichern, Mutex
    dirtyQueue.ts         lokale Vault-Events sammeln
  mapping/
    paths.ts              Remote-Struktur ↔ Vault-Pfade, Dateinamen-Sanitizing
    frontmatter.ts        Frontmatter lesen/schreiben/entfernen
    links.ts              Link-Konvertierung in beide Richtungen
    attachments.ts        Anhang-Pfade und Einbettungen
  ui/
    statusBar.ts
    conflictModal.ts      Diff-Ansicht lokal vs. remote, Auswahl
    collectivePicker.ts
    confirmModal.ts
  util/
    hash.ts, logger.ts, errors.ts
tests/
  unit/                   planner, paths, links, frontmatter, http-Fehler
  fixtures/               aufgezeichnete API-Antworten aus M0
  integration/            gegen Docker-Nextcloud
scripts/
  dev-nextcloud/          docker-compose für Testserver mit Collectives
docs/
  api-notes.md            Ergebnisse M0
```

Regel: `planner.ts`, `paths.ts`, `links.ts`, `frontmatter.ts` sind frei von Obsidian- und Netzwerkabhängigkeiten und vollständig unit-getestet.

## 6. Lokale Abbildung

### 6.1 Ordnerstruktur im Vault

Der Vault-Root ist der Sync-Root. Jedes Collective ist ein Ordner auf oberster Ebene des Vaults.

| Remote | Lokal |
|---|---|
| Collective „Handbuch“ | Ordner `Handbuch/` |
| Startseite `Readme.md` | `Handbuch/Handbuch.md` |
| Blattseite `Onboarding.md` | `Handbuch/Onboarding.md` |
| Elternseite `Prozesse/Readme.md` | `Handbuch/Prozesse/Prozesse.md` (Folder-Note) |
| Unterseite `Prozesse/Urlaub.md` | `Handbuch/Prozesse/Urlaub.md` |
| `.attachments.123/bild.png` | siehe 9 |

Vom Sync ausgenommen: `app.vault.configDir` (`.obsidian/`), Konfliktdateien (8), Dateien direkt im Vault-Root (Hinweis im Log), versteckte Ordner, Nicht-Markdown-Dateien außerhalb von Anhang-Ordnern.

Der Zielserver wird beim Einrichten festgelegt. Ein Serverwechsel in einem bestehenden Vault ist nicht vorgesehen; Settings zeigen dafür einen Hinweis („neuen Vault anlegen“).

Begründung: Viele `Readme.md` sind in Obsidian (Quick Switcher, Wikilinks) unbrauchbar; die Folder-Note-Konvention ist verbreitet.

### 6.2 Frontmatter

Flache Keys, damit die Obsidian-Properties-Ansicht funktioniert:

```yaml
---
nc_page_id: 1234
nc_collective_id: 12
nc_emoji: "📘"
nc_tags: [Projekt, Wichtig]
nc_title: "Original/Titel mit Sonderzeichen"   # nur wenn vom Dateinamen abweichend
---
```

- Beim Hochladen werden nur die `nc_*`-Felder entfernt. Übriges Frontmatter des Nutzers wird mit hochgeladen (entschieden; Collectives zeigt es als Text an). Beim Herunterladen wird ein YAML-Block am Seitenanfang wieder als Frontmatter erkannt und mit den `nc_*`-Feldern zusammengeführt. Ist nach dem Entfernen der `nc_*`-Felder kein Feld übrig, wird der Block komplett weggelassen.
- Option `tagsProperty`: `nc_tags` (Default) oder `tags` (Obsidian-Tags; Leerzeichen werden dann zu `-`, Rückabbildung über Tag-Liste des Collectives).
- `nc_page_id` ist die Identität einer Datei. Fehlt sie, gilt die Datei als neu.

### 6.3 Sync-State

Gespeichert über `this.saveData()` getrennt von Settings (eigener Key oder Datei `sync-state.json` im Plugin-Ordner via `app.vault.adapter`). Pro Seite:

| Feld | Bedeutung |
|---|---|
| `pageId`, `collectiveId` | Identität |
| `localPath` | Vault-Pfad beim letzten Sync |
| `remoteFilePath`, `remoteFileName`, `parentId` | Remote-Ort beim letzten Sync |
| `remoteEtag`, `remoteMtime`, `remoteSize` | Remote-Stand |
| `baseHash` | SHA-256 des **Remote-Formats** des Inhalts beim letzten Sync (nach Link-Konvertierung, ohne `nc_*`-Frontmatter) |
| `metaHash` | Hash von Titel, Emoji, Tags |
| `attachments` | Liste `{ id, name, etag, localPath }` |
| `lastSyncedAt` | Zeitstempel |

Zusätzlich: `schemaVersion`, `serverUrl`, `user`, Tag-Cache je Collective.

Wichtig: `baseHash` wird auf dem konvertierten Remote-Format berechnet. Sonst erzeugt die Link-Konvertierung bei jedem Lauf eine Scheinänderung (Ping-Pong).

### 6.4 Dateinamen

- Unzulässig in Obsidian-Dateinamen/Links: `* " \ / < > : | ? # ^ [ ]`. Diese werden durch `_` ersetzt (konfigurierbar), der Originaltitel steht dann in `nc_title`.
- Umbenennen lokal → neuer Titel = Dateiname (bzw. `nc_title`, wenn gesetzt und nur Sanitizing-Unterschied).
- Namenskollisionen bei Sanitizing: Suffix ` (2)`; Originaltitel in `nc_title`.

## 7. Sync-Ablauf

### 7.1 Auslöser

| Auslöser | Verhalten |
|---|---|
| Plugin-Start | nach `workspace.onLayoutReady`, Default an |
| Intervall | Default 5 min, 0 = aus |
| Nach Speichern | Debounce 10 s nach letztem `modify` einer betroffenen Datei, nur diese Seite |
| Mobile Foreground | Sync, wenn App wieder aktiv wird (`visibilitychange`) |
| Manuell | Command „Jetzt synchronisieren“, „Aktuelle Seite synchronisieren“ |

Ein Mutex verhindert parallele Läufe; Auslöser während eines Laufs setzen ein „erneut laufen“-Flag.

### 7.2 Phasen eines Laufs

1. **Remote scannen**: `GET /collectives` (alle), je Collective `GET …/pages`, Tags cachen.
2. **Lokal scannen**: alle Dateien unter dem Wurzelordner; `nc_page_id` aus Frontmatter (über `metadataCache`), Hash des Remote-Formats nur für Dateien mit mtime > `lastSyncedAt` oder aus der Dirty-Queue.
3. **Planen** (`planner.ts`, rein): Entscheidungstabelle 7.3 → Liste von Operationen, sortiert: Ordner/Eltern vor Kindern, Löschungen zuletzt.
4. **Ausführen**: Operationen sequenziell; jede Operation aktualisiert State sofort (Absturzsicherheit). Fehler einer Seite brechen den Lauf nicht ab.
5. **Abschluss**: State speichern, Statusleiste, Konflikte melden.

### 7.3 Entscheidungstabelle Inhalt

`L` = lokal geändert (`hash(local) ≠ baseHash`), `R` = remote geändert (`mtime/size ≠ state` und nach GET `hash(remote) ≠ baseHash`).

| L | R | Aktion |
|---|---|---|
| nein | nein | nichts |
| ja | nein | PUSH: `PUT` mit `If-Match`; bei `412` → Konflikt |
| nein | ja | PULL: lokal überschreiben (via `vault.process`) |
| ja | ja | Inhalt identisch → nur State aktualisieren; sonst KONFLIKT |

### 7.4 Struktur- und Lebenszyklus-Fälle

| Fall | Erkennung | Aktion |
|---|---|---|
| Neue Remote-Seite | ID nicht im State | Datei lokal anlegen |
| Neue lokale Datei | kein `nc_page_id` | Elternseite aus Ordner bestimmen → `POST pages/{parentId}` → Inhalt per `PUT` → `nc_page_id` ins Frontmatter |
| Remote umbenannt/verschoben | gleiche ID, anderer `filePath`/`fileName`/`parentId` | lokal umbenennen/verschieben (`fileManager.renameFile`, aktualisiert Links) |
| Lokal umbenannt/verschoben | gleiche ID, anderer `localPath` | `PUT pages/{id}` mit `title`/`parentId`; Ordnerwechsel in anderes Collective → `…/to/{newCId}` |
| Beidseitig verschoben, unterschiedlich | beides | Remote gewinnt, Hinweis im Log |
| Remote gelöscht | ID fehlt in Liste | Setting: lokal in Obsidian-Papierkorb (Default) / behalten und entkoppeln |
| Lokal gelöscht | ID im State, Datei fehlt | Nach Bestätigung → `DELETE pages/{id}` (Collectives-Papierkorb). Abgelehnt → Seite lokal wiederherstellen. Mehrere Löschungen eines Laufs werden in **einem** Dialog gesammelt (Liste mit Checkboxen, „Alle löschen“/„Alle wiederherstellen“). Gelöschte Elternseite = Löschung inkl. Unterseiten, im Dialog sichtbar |
| Lokal wiederhergestellt | Datei mit `nc_page_id` taucht wieder auf, Seite im Remote-Papierkorb | `PATCH pages/trash/{id}` (Restore), danach normaler Abgleich |
| Gelöscht + gegenüber geändert | Kombination | Änderung gewinnt; Seite wird wiederhergestellt bzw. neu angelegt |
| Markdown-Datei direkt im Vault-Root | kein Collective-Ordner | ignorieren, Hinweis |
| Neues Remote-Collective | ID nicht im State | Ordner auf oberster Ebene anlegen, Seiten herunterladen |
| Neuer lokaler Ordner auf oberster Ebene | kein bekanntes Collective | Collective anlegen (`POST /collectives`, Name = Ordnername). Die Datei im Ordner mit Ordnernamen wird zur Startseite, übrige Dateien zu Seiten |
| Collective remote gelöscht/entzogen | ID fehlt in Liste | wie „Remote gelöscht“, für den ganzen Ordner; immer mit Rückfrage |
| Lokaler Collective-Ordner gelöscht | Ordner fehlt | Nach Bestätigung (eigener Dialog mit Collective-Name und Seitenzahl) → `DELETE /collectives/{id}` (Collectives-Papierkorb, wiederherstellbar). Abgelehnt → Ordner lokal wiederherstellen. Fehlen die Rechte (nur Collective-Admin darf löschen [VERIFIZIEREN]) → Ordner wiederherstellen, Hinweis |
| Collective-Ordner umbenannt | gleiche Collective-ID | Collective umbenennen (`PUT /collectives/{id}`) [VERIFIZIEREN, ob Umbenennen per API möglich]; sonst lokal zurückbenennen und Hinweis |

Neue lokale Unterseite unter einer Blattseite: Remote-Elternseite wird dadurch zum Ordner. Lokal muss danach die Folder-Note-Struktur hergestellt werden (Datei in den neuen Ordner verschieben).

### 7.5 Metadaten

- Emoji: Vergleich `nc_emoji` vs. Remote; Änderung lokal → `PUT …/emoji`.
- Tags: Abgleich der Namen; fehlende Tags im Collective per `POST /tags` anlegen (Default-Farbe), dann `PUT`/`DELETE …/tags/{tagId}`.
- Konfliktregel Metadaten: getrennt vom Inhalt über `metaHash`; bei beidseitiger Änderung gewinnt Remote, Hinweis im Log.

### 7.6 Eigene Schreibzugriffe ignorieren

Vault-Events, die das Plugin selbst auslöst, dürfen keinen neuen Sync triggern: Pfade während des Schreibens in einem `suppressedPaths`-Set führen und nach dem Event entfernen.

## 8. Konflikte

- Default-Strategie `conflictFile`: lokale Datei bleibt; Remote-Version wird als `Titel (Konflikt YYYY-MM-DD HHmm).md` daneben abgelegt (ohne `nc_page_id`, wird nicht gesynct); Seite im State als `conflict` markiert und bis zur Auflösung nicht gepusht.
- Konflikt-Dialog: Liste aller Konflikte; pro Seite Diff (zeilenbasiert, einfache LCS-Implementierung oder kleine Lib ohne Node-Abhängigkeit) und Buttons „Lokal behalten“ (→ Push mit aktuellem ETag), „Remote übernehmen“, „Später“.
- Weitere Strategien als Setting: `preferLocal`, `preferRemote`.
- Statusleiste zeigt Anzahl offener Konflikte.

## 9. Links und Anhänge

### 9.1 Link-Format in Collectives [VERIFIZIEREN in M0]

Erwartet werden relative Markdown-Links mit File-ID, z. B. `[Titel](Unterordner/Seite.md?fileId=1234)`, sowie absolute URLs auf `/apps/collectives/{Collective}/{slug}-{id}`. M0 erstellt dazu Fixtures aus echten Seiten (Link per Collectives-UI einfügen, Datei per WebDAV lesen).

### 9.2 Remote → lokal

| Remote | Lokal |
|---|---|
| Link mit auflösbarer `fileId` oder Seiten-ID in URL | `[[Vault/Pfad/Seite\|Linktext]]` (Alias nur, wenn Text ≠ Titel) |
| Anker `#ueberschrift` | `[[Seite#Überschrift]]` (Slug → Überschrift über Heading-Liste der Zielseite; sonst Anker unverändert) |
| Nicht auflösbar / extern | unverändert |
| Bild `![](.attachments.123/bild.png)` | `![[bild.png]]` mit lokalem Pfad gemäß 9.4 |

### 9.3 Lokal → remote

| Lokal | Remote |
|---|---|
| `[[Seite]]`, `[[Seite\|Alias]]`, `[[Seite#H]]` auf gesyncte Seite | Format laut M0, relativ zur Quelldatei, inkl. `fileId` |
| Wikilink auf Datei außerhalb des Sync-Bereichs | Text bleibt als `[[…]]` stehen, Warnung im Log |
| `![[bild.png]]` / `![](bild.png)` auf lokale Datei | Upload als Anhang, Link auf `.attachments.{id}/…` |
| Markdown-Links `[x](Seite.md)` | wie Wikilinks behandeln |

Rundlauf-Test ist Pflicht: `toLocal(toRemote(x)) == x` und `toRemote(toLocal(y)) == y` für alle Fixtures.

Code-Blöcke und Inline-Code werden von der Konvertierung ausgenommen.

### 9.4 Anhänge lokal

- Ablage: `{SeitenOrdner}/_attachments/{Seitentitel}/{datei}` (Setting `attachmentFolderPattern`).
- Pull: Liste per OCS, Download per WebDAV, nur wenn ETag/Größe neu.
- Push: neue eingebettete Dateien hochladen. Bevorzugt WebDAV-`PUT` in `.attachments.{pageId}/` (mit `requestUrl` einfach); falls Collectives das nicht erkennt, Multipart-Upload per OCS mit manuell gebautem `multipart/form-data`-Body [VERIFIZIEREN, welcher Weg funktioniert].
- Lokal gelöschter, nicht mehr referenzierter Anhang → Remote löschen (Setting, Default an). Max. Dateigröße als Setting (Default 20 MB).

## 10. Authentifizierung und Settings

### 10.1 Auth

- Variante A (M1): Server-URL, Benutzername, App-Passwort; Button „Verbindung testen“ (`GET /collectives`).
- Variante B (M9): Nextcloud Login Flow v2 – `POST /index.php/login/v2`, Login-URL im Browser öffnen, Endpunkt pollen, App-Passwort übernehmen.
- Speicherung: App-Passwort im Secret Storage von Obsidian, nie im Klartext in `data.json` (Vorbild: Nextcloud Sync, siehe 18).
- Keine Credentials in Logs.

### 10.2 Settings

| Key | Default | Zweck |
|---|---|---|
| `serverUrl`, `username`, `appPassword` | – | Verbindung |
| `newFolderBehaviour` | `createCollective` | `createCollective`/`ask`/`ignore` |
| `syncIntervalMinutes` | 5 | 0 = aus |
| `syncOnStartup` | true | |
| `syncOnSave`, `syncOnSaveDebounceSec` | true, 10 | |
| `conflictStrategy` | `conflictFile` | `conflictFile`/`preferLocal`/`preferRemote` |
| `localDeleteBehaviour` | `ask` | `ask` (Bestätigung, dann Remote-Papierkorb) / `trashRemote` (ohne Rückfrage). Für Collectives immer `ask` |
| `remoteDeleteBehaviour` | `obsidianTrash` | `obsidianTrash`/`keepUnlinked` |
| `tagsProperty` | `nc_tags` | `nc_tags`/`tags` |
| `convertLinks` | true | |
| `attachmentFolderPattern` | `_attachments/{title}` | |
| `maxAttachmentSizeMb` | 20 | |
| `debugLogging` | false | |

## 11. UI und Commands

| Element | Inhalt |
|---|---|
| Statusleiste (Desktop) | `NC ✓ 12:50` · `NC ⟳` · `NC ⚠ 2` (Klick öffnet Konflikte/Log) |
| Mobile | Notice nach Lauf nur bei Fehlern/Konflikten; Ribbon-Icon für manuellen Sync |
| Commands | Jetzt synchronisieren · Aktuelle Seite synchronisieren · Aktuelle Seite in Collectives öffnen · Neue Unterseite anlegen · Konflikte anzeigen · Sync-Log anzeigen · Sync-Zustand zurücksetzen (Neuabgleich ohne Datenverlust) |
| Settings-Tab | Verbindung, Liste der Collectives (nur Anzeige mit Emoji und Seitenzahl), Verhalten, Erweitert |

### Erstsynchronisation

- Leerer Vault (abgesehen von `.obsidian/`): alles herunterladen.
- Nicht leerer Vault: Dialog mit Wahl „Remote → lokal; vorhandene Ordner gleichen Namens werden zusammengeführt, lokale Dateien ohne ID werden hochgeladen“ oder „Abbrechen“. Empfehlung im Dialog: neuen, leeren Vault verwenden. Niemals stillschweigend überschreiben.

## 12. Fehlerbehandlung und Logging

- Fehlerklassen: `AuthError` (401/403 → Sync pausieren, Notice), `NotFound`, `Conflict` (412), `Network` (Retry mit Backoff 1/2/4 s, max. 3), `ServerError` (5xx, Retry), `ApiChanged` (unerwartete Antwortstruktur → Sync stoppen, klare Meldung).
- Beim Start Versions-Check: Collectives-Capabilities/Version abfragen (`/ocs/v2.php/cloud/capabilities`) und gegen getestete Versionen prüfen; bei Abweichung Warnung.
- Logger mit Ringpuffer (letzte 500 Einträge), anzeigbar im Modal, kopierbar; `debugLogging` schaltet Request-Details (ohne Auth-Header) zu.

## 13. Tests und Qualität

| Ebene | Inhalt | Pflicht |
|---|---|---|
| Unit | `planner` (alle Zeilen aus 7.3/7.4), `paths` (Mapping, Sanitizing, Kollisionen), `links` (Rundlauf, Code-Blöcke, Anker), `frontmatter`, Fehlerabbildung `http` | ja, Coverage ≥ 90 % für diese Module |
| Fixtures | echte API-Antworten und Seiteninhalte aus M0, anonymisiert | ja |
| Integration | `scripts/dev-nextcloud/docker-compose.yml` (Nextcloud + Collectives + Teams/Circles), Tests für API-Client und End-to-End-Sync mit In-Memory-Vault-Fake | ja ab M4 |
| Manuell | Checkliste `docs/manual-test.md`: Desktop macOS, iOS, Android; Offline-Bearbeitung; gleichzeitige Bearbeitung im Browser | vor jedem Release |

Integrationstests laufen nie gegen produktive Server.

## 14. Meilensteine

Jeder Meilenstein = ein Branch/PR, später je ein Forgejo-Issue. Ein Meilenstein ist fertig, wenn alle Akzeptanzkriterien erfüllt sind, `npm run build`, `npm run lint` und `npm test` grün sind und dieses Dokument (Status-Tabelle in 16) aktualisiert ist.

### M0 – Verifikation (Spike)
- Docker-Testserver aufsetzen; Collectives-Version notieren.
- Alle Endpunkte aus 4.2 per Skript aufrufen, Antworten als Fixtures speichern.
- Klären: Link-Format (9.1), Anhang-Ordner, File-ID bei Blatt→Elternseite, `If-Match`-Verhalten, WebDAV-PUT vs. Multipart für Anhänge, ob `touch` nötig ist, Verhalten bei offener Text-Session im Browser, Mindestversion der Secret-Storage-API.
- Schnelltest: Nextcloud Sync (siehe 18) testweise auf den `Collectives/`-Ordner richten und beobachten, wie Collectives auf per WebDAV geänderte, neue und verschobene Dateien reagiert.
- Referenzcode von Nextcloud Sync sichten (Login Flow v2, Secret Storage, `If-Match`-Handling, Mobile-Trigger) und übernehmbare Muster in `docs/api-notes.md` notieren.
- Ergebnis: `docs/api-notes.md`, alle [VERIFIZIEREN]-Stellen in diesem Plan aufgelöst.
- Akzeptanz: Jede [VERIFIZIEREN]-Markierung ist bestätigt oder korrigiert.

### M1 – Grundgerüst, Settings, Verbindung
- Projekt aus Sample-Plugin, ESLint, Vitest, CI-fähige npm-Skripte.
- Settings-Tab mit Verbindung und „Verbindung testen“.
- Akzeptanz: Plugin lädt auf Desktop und Mobile; Verbindungstest zeigt Erfolg/Fehler korrekt.

### M2 – API-Clients
- `http.ts`, `ocsClient.ts`, `webdavClient.ts`, `collectivesApi.ts` mit Typen und Fehlerklassen.
- Akzeptanz: Unit-Tests gegen Fixtures; Integrationstest listet Collectives/Seiten, liest und schreibt eine Seite.

### M3 – Pull (nur lesen)
- Remote-Scanner, Pfad-Mapping, Frontmatter, Datei-Anlage und -Update, State, Erstsync-Dialog.
- Akzeptanz: Alle Collectives des Servers erscheinen als Ordner auf oberster Ebene mit korrekter Hierarchie; zweiter Lauf ohne Änderungen erzeugt keine Schreibzugriffe.

### M4 – Push Inhalt und Konflikte
- Lokaler Scanner, Dirty-Queue, Planner (7.3), PUT mit ETag, Konfliktdatei, Konflikt-Dialog, Statusleiste.
- Akzeptanz: Lokale Änderung landet in Collectives; gleichzeitige Änderung erzeugt Konflikt statt Datenverlust; keine Ping-Pong-Schreibvorgänge.

### M5 – Struktur: Anlegen, Umbenennen, Verschieben, Löschen
- Alle Fälle aus 7.4 inklusive Blatt→Elternseite und Collective-übergreifendem Verschieben.
- Akzeptanz: Jeder Fall aus 7.4 hat einen Planner-Unit-Test und einen Integrationstest.

### M6 – Tags und Emojis
- Abgleich laut 7.5, Tag-Anlage, `tagsProperty`-Option.
- Akzeptanz: Änderungen in beide Richtungen; kein Duplikat-Tag.

### M7 – Links
- `links.ts` laut 9.2/9.3, Integration in Pull/Push, Hash auf Remote-Format.
- Akzeptanz: Rundlauf-Tests grün; in Collectives gesetzte Links funktionieren in Obsidian und umgekehrt.

### M8 – Anhänge
- Pull/Push/Löschen laut 9.4, Größenlimit.
- Akzeptanz: Bild in Obsidian eingefügt erscheint in Collectives und umgekehrt; unveränderte Anhänge werden nicht erneut übertragen.

### M9 – Automatik, Mobile, Login Flow
- Scheduler (Intervall, Debounce, Foreground), Mutex, Login Flow v2, Performance (≥ 500 Seiten: Leerlauf-Sync < 5 s bei LAN).
- Akzeptanz: Manuelle Testcheckliste auf iOS und Android bestanden.

### M10 – Härtung und Release
- Versions-Check, Log-Modal, README (Installation, Risiken, Backup-Hinweis), `manifest.json`, `versions.json`, Release-Build; Installation per BRAT.
- Akzeptanz: Release-Artefakte (`main.js`, `manifest.json`, `styles.css`) gebaut; README vollständig.

## 15. Offene Entscheidungen

| # | Frage | Vorschlag bis zur Entscheidung |
|---|---|---|
| 1 | Plugin-Name und ID | **entschieden:** `nextcloud-collectives` |
| 2 | Lizenz | **entschieden:** MIT |
| 3 | Veröffentlichung im Community-Store | erst nach M10 entscheiden; bis dahin BRAT |
| 4 | Mehrere Nextcloud-Server | **entschieden:** ein Server pro Vault; alle Collectives bilden den Vault |
| 5 | Nutzer-Frontmatter mit hochladen? | **entschieden:** ja, nur `nc_*` entfernen |
| 6 | Ziel-Version Nextcloud/Collectives | wird in M0 erfasst |
| 7 | Eigenes Plugin oder bestehendes nutzen/forken? | **entschieden:** eigenes Plugin; bestehende Plugins nur als Referenz (siehe 18) |

## 16. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Collectives-API ändert sich | Sync bricht | Versions-Check, `ApiChanged`-Fehler, Fixtures je Version |
| Gleichzeitige Bearbeitung im Browser (Text-Session) | Überschreiben | ETag-Prüfung, M0-Test, Hinweis in README |
| Link-Konvertierung nicht verlustfrei | Inhaltsänderungen, Ping-Pong | Rundlauf-Tests, Hash auf Remote-Format, unbekannte Links unverändert lassen |
| Falsch erkannte Löschungen | Datenverlust | Löschen nur nach Bestätigung, immer in den Collectives-Papierkorb (wiederherstellbar); lokale Wiederherstellung stellt auch remote wieder her. Sicherung: Löscht ein Lauf > 20 % der Seiten eines Collectives, wird der Lauf angehalten und gesondert nachgefragt |
| Credential-Leak | Zugriff auf Nextcloud | App-Passwort nur im Secret Storage |
| Mobile ohne Hintergrundausführung | verspäteter Sync | Sync beim Öffnen/Foreground, Statusanzeige |

## 17. Status

| Meilenstein | Status |
|---|---|
| M0 | offen |
| M1 | offen |
| M2 | offen |
| M3 | offen |
| M4 | offen |
| M5 | offen |
| M6 | offen |
| M7 | offen |
| M8 | offen |
| M9 | offen |
| M10 | offen |

## 18. Referenzen und Marktlage

Recherche 2026-10-15: Es gibt kein Obsidian-Plugin für Nextcloud Collectives. Folgende Projekte dienen als Referenz; Code darf unter Einhaltung der jeweiligen Lizenz übernommen werden, mit Quellenangabe im Code und in `README.md`.

| Projekt | Lizenz | Übernehmen / ansehen |
|---|---|---|
| [siosig/obsidian-nextcloudsync](https://github.com/siosig/obsidian-nextcloudsync) („Nextcloud Sync“) | MIT | Login Flow v2, Secret Storage, `If-Match`/412-Konfliktbehandlung, Capabilities- und Wartungsmodus-Erkennung (`/status.php`), Mobile-Trigger (Start, Rückkehr in App), Massenlösch-Schutz, Teststrategie mit echtem Nextcloud |
| [onlymykazari/obsidian-nextcloud-deck](https://github.com/onlymykazari/obsidian-nextcloud-deck) („NextDeck“) | in M0 prüfen | Muster „App-API ↔ Markdown-Notizen“, Ringpuffer-Sync-Log, Schutz gegen selbst ausgelöste Vault-Events |

Bewusst verworfen:
- Nextcloud Sync direkt auf den `Collectives/`-Ordner richten: keine Emojis, Tags, Link-Umwandlung, Collective-Anlage; `Readme.md`-Struktur bleibt sichtbar.
- Nextcloud Sync forken: große fremde Codebasis, Upstream nimmt laut README kaum PRs an, dauerhafte Fork-Pflege.
