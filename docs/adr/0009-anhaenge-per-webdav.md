# 0009 – Anhänge per WebDAV-PUT statt OCS-Multipart

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §9.4, ONC-1

## Kontext

Collectives listet Anhänge aus dem Ordner `.attachments.{pageId}/` neben der Seitendatei. Upload ist per OCS-Multipart oder per WebDAV möglich (beides in M0 bestätigt).

## Entscheidung

Upload per WebDAV: `MKCOL .attachments.{pageId}/` falls nötig, dann `PUT` der Datei. ETags per `PROPFIND`. Löschen per OCS `DELETE …/attachments/{attId}` (landet im Papierkorb).

## Betrachtete Alternativen

- **OCS-Multipart** – Body muss für `requestUrl` manuell gebaut werden, und der Server benennt bei Namenskollision eigenmächtig um (`name (1).ext`), wodurch lokale Einbettungen nicht mehr passen.

## Konsequenzen

- Gleicher Codepfad wie für Seiteninhalte, deterministische Dateinamen.
- Die OCS-Anhangliste enthält keine ETags – Abgleich über PROPFIND.
