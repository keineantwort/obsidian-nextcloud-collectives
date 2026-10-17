# 0022 – Automatik: Mutex mit Re-Run-Flag, stille Auto-Läufe, Login Flow v2, gedrosseltes Speichern

- Status: akzeptiert
- Datum: 2026-10-17
- Bezug: PLAN.md §7.1, §10.1, §12, §14 M9, Issue ONC-10

## Kontext

Bis M8 läuft ein Sync nur auf Befehl. M9 ergänzt Auslöser (Start, Intervall, Speichern, Vordergrund), die auch auf dem Handy laufen müssen, wo es keine Hintergrundausführung gibt und Rückfragen mitten im Schreiben stören. Ein erster Sync großer Collectives schrieb außerdem nach jeder Seite den gesamten State (O(N²)).

## Entscheidung

- **Scheduler** (`src/sync/scheduler.ts`, rein, Timer injiziert): Start (2 s nach `onLayoutReady`), Intervall, Debounce nach Änderungen, Vordergrund (`visibilitychange`, höchstens alle 30 s). Er fordert Läufe nur an.
- **Mutex mit Re-Run-Flag** im `SyncController`: Läufe und Konfliktauflösungen laufen über eine Warteschlange. Ein Auslöser während eines Laufs setzt das Flag; danach folgt genau ein weiterer Lauf. Ein manueller Auslöser gewinnt gegen automatische und zeigt „läuft danach noch einmal“.
- **Auto-Läufe sind still**: kein Fortschritts-Notice, kein Dialog. Die Erstsynchronisation eines nicht leeren Vaults wird nicht gestartet, Rückfragen (Löschen, neue Ordner) werden zurückgestellt und mit einem Hinweis gemeldet („Jetzt synchronisieren“ fragt). Notices nur bei Warnung/Fehler und nicht zweimal mit gleichem Text hintereinander. Kein Netz und fehlende Konfiguration bleiben still.
- **Pause bei `AuthError`/`ApiChanged`** (PLAN §12): Auto-Läufe stoppen, bis der Nutzer manuell synchronisiert (Erfolg) oder Einstellungen speichert.
- **Dirty-Schlüssel eines nicht sauber beendeten Laufs** (Fehler, Abbruch, `failed > 0`) kommen in die Queue zurück.
- **Speichern nach Änderung = `modify`-Event mit Debounce.** Obsidian hat kein Speichern-Ereignis, speichert beim Tippen selbst. Eigene Schreibzugriffe (TTL-Unterdrückung der `DirtyQueue`) lösen nichts aus. Der Lauf ist ein voller Lauf, nicht „nur diese Seite“ (siehe Konsequenzen).
- **Gedrosseltes Speichern** (`src/sync/throttledPersist.ts`): Nur die Operation `create` speichert „lazy“ (höchstens 1× pro Sekunde, Abschluss/Abbruch des Laufs schreibt nach). Alles andere (Push, Struktur, Konfliktkopien, neue Server-IDs) bleibt sofort. Eine neue Seite lässt sich nach einem Absturz aus ihrer Datei (`nc_page_id`) wieder zuordnen; ein verlorener `push`- oder `update`-Eintrag würde als Konflikt erscheinen.
- **Login Flow v2** (`src/api/loginFlow.ts`): `POST /index.php/login/v2`, Polling alle 2 s bis 20 min. Login-URL und Poll-Endpunkt müssen denselben Origin (Schema, Host, Port) wie die Server-URL haben; sonst `ApiChangedError`. Nur 404 gilt als „noch nicht fertig“. Zwischen den Polls wird auf Timer **oder** Rückkehr in den Vordergrund gewartet (Android friert Timer ein, solange der Browser vorne ist). Das App-Passwort geht direkt in den Secret Storage, nie in Logs oder `data.json`. Fallback-Link neben dem Abbrechen-Button, falls `window.open` blockiert wird.

## Betrachtete Alternativen

- **Sofort-Speichern beibehalten** – bei 500 Seiten ca. 500 Serialisierungen des State; Messwerte stehen in PLAN §17.
- **Auto-Läufe mit Dialogen** – Dialoge erscheinen zu zufälligen Zeitpunkten (auch im Hintergrund-Fenster) und blockieren das Schreiben.
- **Lauf „nur diese Seite“ nach Speichern** – würde Planner und Remote-Scan um einen Filter erweitern; der volle Lauf ist bei unveränderten Seiten günstig (ein Request je Collective), und der Filter ist bei Bedarf in M10 nachrüstbar.
- **Intervall nur auf Desktop** – auf dem Handy feuert der Timer nur im Vordergrund, schadet also nicht; der Nutzer behält die Wahl über die Einstellung.

## Konsequenzen

- positiv: Läufe überlappen nie; der Nutzer wird auf dem Handy nicht unterbrochen; große Erstsyncs schreiben den State selten.
- negativ / Kosten: Löschungen werden erst nach einem manuellen Lauf bestätigt. Ein Absturz innerhalb der lazy-Sekunde kostet die Zuordnung der zuletzt angelegten Seiten (wird beim nächsten Lauf aus der Datei wiederhergestellt).
- Folgearbeiten: „Aktuelle Seite synchronisieren“ als Befehl (M10); Konfliktkopie bei erneuter Server-Änderung aktualisieren (Hinweis aus M4, nicht Teil von M9).
