# 0005 – Identität über `nc_page_id`, Nutzer-Frontmatter wird mit hochgeladen

- Status: akzeptiert
- Datum: 2026-10-15 (ergänzt 2026-10-16 um M0-Befund)
- Bezug: PLAN.md §6.2, §15 #5

## Kontext

Eine lokale Datei muss nach Umbenennen/Verschieben in Obsidian ihrer Remote-Seite zugeordnet bleiben. Nutzer pflegen eigenes Frontmatter (Properties), das Collectives nicht kennt.

## Entscheidung

- Die Seiten-ID (= Nextcloud-File-ID) steht als `nc_page_id` im Frontmatter und ist die Identität der Datei. Weitere Plugin-Felder: `nc_collective_id`, `nc_emoji`, `nc_tags`, `nc_title`.
- Beim Hochladen werden nur `nc_*`-Felder entfernt; übriges Frontmatter wird mit hochgeladen. Bleibt nichts übrig, entfällt der Block.

## Betrachtete Alternativen

- **ID nur im Sync-State** – geht bei Umbenennen außerhalb von Obsidian oder bei State-Verlust verloren.
- **Gesamtes Frontmatter lokal behalten** – Nutzer-Properties wären auf dem Server unsichtbar und gingen bei Bearbeitung im Browser verloren.

## Konsequenzen

- M0 (manuelle Prüfung): Der Text-Editor zeigt Frontmatter als Codeblock an und erhält ihn beim Speichern byte-genau. Er fügt aber eine Leerzeile nach dem Block ein und entfernt den abschließenden Zeilenumbruch. Unser Remote-Format muss diese Normalform erzeugen, damit Browser-Speichervorgänge keine Scheinänderungen auslösen.
