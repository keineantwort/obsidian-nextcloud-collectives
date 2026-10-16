# 0012 – Gleichzeitige Bearbeitung im Browser: ETag-Schutz, kein Session-Handling

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §2 (Nicht-Ziel Echtzeit-Kollaboration), §16, ONC-1

## Kontext

Collectives-Seiten werden im Browser mit dem Text-Editor (kollaborative Sitzung, Autosave nach wenigen Sekunden) bearbeitet. Das Plugin schreibt per WebDAV in dieselbe Datei. Manuelle Prüfung am 2026-10-16 (Nextcloud 33.0.10, Text 7.0.1), zwei Durchläufe:

1. Browser tippt `BROWSER-2`, Autosave landet in der Datei.
2. Plugin liest die Datei (inkl. `BROWSER-2`) und schreibt per `PUT` mit `If-Match` eine geänderte Fassung.
3. Wenige Sekunden später (beim nächsten Sync-Poll des Editors) erscheint im Browser „Die Bearbeitungssitzung ist abgelaufen. Bitte die Seite neu laden.“ mit Button „Aktualisieren“.
4. Der Editor lässt weiter tippen (`BROWSER-3`), wiederholt die Meldung, speichert aber nichts mehr: Der ETag der Datei bleibt der des Plugin-PUT.
5. Nach „Aktualisieren“ zeigt der Browser die Plugin-Fassung inkl. `BROWSER-2`; `BROWSER-3` ist verloren.

## Entscheidung

- Das Plugin greift nicht in Text-Sessions ein (keine Nutzung der Session-/Yjs-API, Nicht-Ziel v1).
- Schutz auf Plugin-Seite ausschließlich über `If-Match`: Hat der Browser seit dem letzten Lesen gespeichert, scheitert der `PUT` mit 412 → Konfliktdatei, kein Überschreiben.
- Push erst nach Debounce (PLAN §7.1) und nur bei tatsächlicher Änderung, um das Zeitfenster klein zu halten.
- README und Settings weisen darauf hin: Wer eine Seite gleichzeitig im Browser offen hat, muss nach der Meldung „Bearbeitungssitzung abgelaufen“ neu laden; danach Getipptes geht verloren.

## Betrachtete Alternativen

- **Offene Sessions erkennen und Push zurückhalten** – benötigt die interne Session-API der Text-App, nicht dokumentiert, Versionsrisiko.
- **Inhalt über die Text-Session schreiben** (Yjs-Steps) – hoher Aufwand, ausdrücklich Nicht-Ziel v1.

## Konsequenzen

- Kein stiller Datenverlust auf der Plugin-Seite; der verbleibende Verlust (Eingaben im Browser nach der Warnung) ist für den Nutzer sichtbar.
- Risiko in PLAN §16 präzisiert. Ein späterer ADR kann Session-Erkennung nachrüsten, falls das in der Praxis stört.
