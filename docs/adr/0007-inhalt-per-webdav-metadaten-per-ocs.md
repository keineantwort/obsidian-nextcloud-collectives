# 0007 – Inhalt per WebDAV, Metadaten per OCS, kein `touch`

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §4, `docs/api-notes.md` §3–5, ONC-1

## Kontext

Die Collectives-OCS-API liefert keine Seiteninhalte. Inhalt liegt als Datei im (pro Nutzer konfigurierbaren) Collectives-Ordner.

## Entscheidung

- Inhalt lesen/schreiben per WebDAV (`GET`, `PUT` mit `If-Match`, neue Dateien mit `If-None-Match: *`), Pfade immer aus `collectivePath`/`filePath`/`fileName` der API.
- Struktur und Metadaten (Anlegen, Umbenennen, Verschieben, Emoji, Tags, Papierkorb) per OCS.
- Kein `touch` nach dem `PUT`: Collectives' `NodeWrittenListener` setzt beim WebDAV-Schreiben selbst den letzten Bearbeiter, verschickt Benachrichtigungen und aktualisiert `linkedPageIds` (M0 bestätigt).

## Betrachtete Alternativen

- **Alles per WebDAV** (Collectives erkennt rohe PUT/MOVE/DELETE, M0) – Titel-Bereinigung, Emoji und Tags wären so nicht steuerbar; Seitenanlage über OCS liefert sofort die ID.
- **`touch` nach jedem PUT** – zusätzlicher Request ohne Nutzen, doppelte Benachrichtigungen.

## Konsequenzen

- Konflikterkennung über ETag/412 (M0 bestätigt).
- ETags pflanzen sich bis `.Collectives/` fort; ein Depth-0-PROPFIND erkennt Inhaltsänderungen günstig. Emoji/Tags ändern keinen ETag – die Seitenliste muss trotzdem geladen werden.
