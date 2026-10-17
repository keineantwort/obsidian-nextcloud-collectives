# 0021 – Anhänge: Einbettungen über den Index, Abgleich über ETags, Schritt nach dem Inhalt

- Status: akzeptiert
- Datum: 2026-10-17
- Bezug: PLAN §9.2–9.4, ADR 0009, ADR 0020, Issue ONC-9

## Kontext

M8 bringt Bilder und Dateien in beide Richtungen: Collectives schreibt `![name](.attachments.{pageId}/name)`, Obsidian bettet `![[bild.png]]` ein (Dateien liegen irgendwo im Vault, meist wo Obsidian eingefügte Bilder ablegt). Hash und Basis (`baseHash`) laufen über das Remote-Format (ADR 0020), die Einbettung muss sich also ohne zusätzlichen Zustand in beide Richtungen umrechnen lassen. Anhänge dürfen nicht bei jedem Lauf übertragen werden, und Nutzerdaten dürfen nie ohne Rückfrage überschrieben oder gelöscht werden (AGENTS Regel 4).

## Entscheidung

- **Einbettungen im Text.** `links.ts` wandelt `![alt](.attachments.{id}/name)` ⇄ `![[Vault/Pfad/name]]` (`![[Pfad|alt]]`, wenn der Alt-Text vom Dateinamen abweicht; leerer Alt-Text wird zum Dateinamen kanonisiert). Lokal werden `![[…]]` und `![alt](pfad)` auf Dateien im Vault erkannt (Pfad ab Wurzel, relativ zur Notiz oder ein Name, den nur eine Datei hat). Notizen, fehlende Dateien, Dateien über dem Größenlimit, Code und Einbettungen mit Überschrift bleiben unverändert.
- **`AttachmentIndex`** (`mapping/attachments.ts`, rein) gehört zum `LinkIndex` und wird pro Durchlauf gebaut: Dateien des Vaults mit Größe (`LocalSnapshot.attachmentFiles`), Standardordner je Seite (Muster, relativ zum Ordner der Notiz, `{title}` = Dateiname der Notiz) und die schon gesyncten Pfade aus dem State. Ein Pfad im Standardordner oder aus dem State zählt auch dann als Anhang der Seite, wenn die Datei noch fehlt – so bleibt der Hash stabil, solange der Download aussteht.
- **Ablage.** Heruntergeladene Dateien liegen in `{Ordner der Notiz}/_attachments/{Notizname}/` (Setting `attachmentFolderPattern`). Eingefügte Dateien bleiben, wo der Nutzer sie hat; der State merkt sich den tatsächlichen Pfad. Beim Umbenennen oder Verschieben einer Notiz werden Anhänge nicht mitgezogen (der State-Pfad bleibt gültig).
- **Eigener Schritt nach dem Inhalt** (`executorAttachments.ts`). Nach `create`/`adopt`/`update`/`push` einer Seite läuft der Anhang-Schritt; für Seiten, an denen sonst nichts zu tun ist und die Anhänge im State haben, plant der Planer eine Operation `attachments` (damit Änderungen auf dem Server ohne Änderung des Seitentextes auffallen). Der Schritt liest den Ordner `.attachments.{id}` per PROPFIND Depth 1 (ETag, Größe, `fileid`) und entscheidet je Datei. Pro Seite also höchstens ein PROPFIND, wenn nichts zu tun ist.
- **State.** `attachments: { id, name, etag, localPath, hash }`; `hash` = SHA-256 der Bytes, die beide Seiten zuletzt hatten. `etag: ''` markiert „noch nicht übertragen“ (Fehler beim Transfer, Name auf dem Server belegt): der nächste Lauf versucht es erneut. Die Anhang-Id ist die `fileid` aus PROPFIND (im Integrationstest gegen die OCS-Liste bestätigt); `0` = unbekannt.
- **Abgleich je Datei.**
  - Nur lokal und von der Notiz eingebettet → Upload per `MKCOL` (falls nötig) und `PUT` mit `If-None-Match: *` (nie über eine vorhandene Datei). Danach ein PROPFIND für ETag und Id.
  - Nur auf dem Server und eingebettet → Download. Gleicher ETag wie im State → keine Übertragung.
  - Server-ETag geändert → Download; die Vault-Datei wird nur ersetzt, wenn sie noch dem State-Hash entspricht; sonst bleibt sie, die Serverfassung wird als Konfliktdatei (`name (Konflikt …).ext`) daneben gelegt.
  - Auf beiden Seiten ohne gemeinsamen Stand → Bytes vergleichen: gleich übernehmen, verschieden: Konfliktdatei.
  - Auf dem Server gelöscht → Vault-Datei in den Obsidian-Papierkorb (`remoteDeleteBehaviour`), aber nur, wenn sie unverändert ist.
  - Im Vault gelöscht und nicht mehr eingebettet → auf dem Server löschen (Papierkorb von Collectives; Setting `deleteRemoteAttachments`, Standard an). Ist sie noch eingebettet, wird sie wiederhergestellt.
  - Verschoben im Vault → die Einbettung (von Obsidian nachgezogen) liefert den neuen Pfad; keine Übertragung.
  - Fehlt der Ordner auf dem Server, obwohl der State Anhänge kennt, bleibt alles unangetastet.
- **Größenlimit.** `maxAttachmentSizeMb` (1–1000, Standard 20). Größere Dateien werden weder hoch- noch heruntergeladen; eine zu große lokale Datei wird nicht umgewandelt (die Einbettung bleibt `![[…]]` im Seitentext).
- **Transport.** `HttpRequest.body` darf ein `ArrayBuffer` sein, `binaryResponse` liefert `HttpResponse.data`, `timeoutMs` pro Request (Anhänge 180 s statt 30 s). `WebdavClient.getBinary`/`putBinary`. Schreibende Requests werden weiterhin nie wiederholt.

## Betrachtete Alternativen

- **OCS-Multipart-Upload** – siehe ADR 0009 (Umbenennung bei Kollision).
- **Anhänge nur im Planer entscheiden** – der Planer kennt die Einbettungen nicht (Text), der Schritt braucht den Seitentext nach dem Inhalt.
- **Lokale Änderungen vorhandener Anhänge hochladen** – nicht umgesetzt (siehe Einschränkungen).
- **Datei-Hashes vor jedem Lauf** – Kosten auf Mobilgeräten; Server-Änderungen werden per ETag erkannt, Bytes nur gelesen, wenn der ETag abweicht.

## Konsequenzen

- Pro Lauf ein PROPFIND je Seite mit gesyncten Anhängen.
- Wird dieselbe Datei in mehreren Seiten eingebettet, wird sie je Seite hochgeladen (eigener `.attachments.{id}`-Ordner).

## Bekannte Einschränkungen

- Eine lokal geänderte Datei mit gleichem Namen wird nicht hochgeladen; ändert sich die Datei auf dem Server, entsteht eine Konfliktdatei.
- Heißen zwei eingebettete Dateien einer Seite gleich (verschiedene Ordner), wird nur eine hochgeladen.
- Dateien, deren Name `[ ] | # ^` enthält, werden heruntergeladen, aber nicht als Wikilink eingebettet.
- Nicht-Bild-Links (`[Name](.attachments.{id}/datei.pdf)`) werden nicht umgewandelt und nicht heruntergeladen.
- Ist ein Anhang beim Pull einer neuen Seite schon durch eine fremde Datei am Zielpfad belegt, werden die Bytes verglichen (gleich: übernommen; verschieden: Konfliktdatei).
- Anhänge werden beim Umbenennen oder Verschieben der Notiz nicht mitgezogen.
- Der Seitentext einer Seite im Zustand `conflict` verweist nur auf Anhänge, die die Notiz selbst einbettet; Anhänge, die nur in der Serverfassung stehen, kommen nach der Auflösung.
