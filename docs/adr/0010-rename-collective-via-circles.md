# 0010 – Collective umbenennen über die Circles-API

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §4.2, §7.4, ONC-1

## Kontext

`PUT /collectives/{id}` akzeptiert nur `emoji`. Der Name eines Collectives ist der Name seines Teams (Circle).

## Entscheidung

Ein lokal umbenannter Collective-Ordner wird über `PUT /ocs/v2.php/apps/circles/circles/{circleId}/name` (`value`) umbenannt. ID bleibt, Name, Slug und WebDAV-Pfad ziehen nach (M0 bestätigt). Fehlen die Rechte, wird der Ordner lokal zurückbenannt.

## Betrachtete Alternativen

- **Umbenennen nicht unterstützen** – lokales Umbenennen würde immer zurückgedreht, schlechte UX.

## Konsequenzen

- Abhängigkeit von einer zweiten App-API (Circles/Teams); Fehler dort sind als `ApiChanged` zu behandeln.
- Collective-Löschen bleibt Circle-Admins/Ownern vorbehalten (Mitglieder: 403); das Plugin prüft `level` vorab.
