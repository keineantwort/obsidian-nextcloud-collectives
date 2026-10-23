# 0015 – HTTP-Fehlerabbildung und Retry zentral im HTTP-Client

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §12, §14 (M2), Issue ONC-3

## Kontext

Bis M1 bildete nur der Verbindungstest HTTP-Status auf Fehlerklassen ab und behandelte 401 und 403 gleich als `AuthError`. Ab M2 sprechen alle Clients (OCS, Circles, WebDAV) über denselben Transport. Ein 403 bedeutet bei Nextcloud nicht nur „Zugangsdaten falsch“. Die Antwort kommt auch, wenn ein angemeldeter Nutzer eine Ressource nicht ändern darf, etwa wenn ein Mitglied ein Collective löschen will (M0, Fixture `collective-trash-as-member.json`). Würde das als `AuthError` gelten, pausierte der Sync (PLAN §12) wegen einer einzelnen verbotenen Aktion.

PLAN §12 verlangt außerdem Retry mit Backoff 1/2/4 s für Netzwerk- und Serverfehler.

## Entscheidung

- Die Statusabbildung steht an genau einer Stelle: `errorForStatus` in `src/api/http.ts`, aufgerufen von `HttpClient.send`.
  - 401 → `AuthError` (Zugangsdaten abgelehnt, Sync pausieren)
  - 403 → neue Klasse `ForbiddenError` (keine Rechte an dieser Ressource, nur die eine Aktion scheitert)
  - 404 → `NotFoundError`, 412 → `ConflictError`
  - jeder andere Nicht-2xx-Status → `ServerError(status)`
  - keine Antwort / Timeout → `NetworkError`
- Retry nur für **lesende** Methoden (`GET`, `PROPFIND`), nur bei `NetworkError` und Status ≥ 500, mit 1/2/4 s Pause, höchstens drei Wiederholungen. 4xx wird nie wiederholt.
- Schreibende Methoden (`PUT`, `POST`, `PATCH`, `DELETE`, `MKCOL`, `MOVE`) werden nie automatisch wiederholt. Ist ein `PUT` beim Server angekommen, aber die Antwort verloren gegangen, würde die Wiederholung mit dem alten `If-Match` einen falschen 412 erzeugen. Ein wiederholtes `POST` würde eine Seite doppelt anlegen. Der nächste Sync-Lauf übernimmt die Wiederholung, nachdem er den Stand neu gelesen hat.
- Der Verbindungstest in den Settings läuft ohne Retry, damit die Rückmeldung sofort kommt.

## Betrachtete Alternativen

- **403 weiter als `AuthError`** – pausiert den Sync für alle Collectives, obwohl nur eine Aktion verboten ist.
- **Retry für alle Methoden** – riskiert doppelte Seiten und Scheinkonflikte, siehe oben.
- **Statusabbildung je Client** – drei Kopien derselben Tabelle, die auseinanderlaufen.

## Konsequenzen

- positiv: Einheitliche Fehler in allen Clients. Aufrufer können `ForbiddenError` gezielt behandeln, etwa einen gelöschten Collective-Ordner wiederherstellen (PLAN §7.4).
- negativ: Ein Netzwerkfehler beim Schreiben scheitert sofort. Das ist gewollt, der nächste Lauf korrigiert ihn.
- Folgearbeiten: Der Sync (ab M3/M4) pausiert bei `AuthError` und meldet `ForbiddenError` pro Operation, ohne den Lauf abzubrechen.
