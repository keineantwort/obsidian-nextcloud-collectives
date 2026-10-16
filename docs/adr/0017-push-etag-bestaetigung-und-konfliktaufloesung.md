# 0017 – Push: bestätigte ETags, Entscheidung als reine Funktion, Konfliktauflösung über den State

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §6.3, §7.3, §7.6, §8, §10.2, §14 M4, `docs/api-notes.md` §10a, Issue ONC-5 (M4)

## Kontext

M4 lädt lokale Änderungen hoch. Vier Fragen waren offen:

1. **ETag-Sekundenauflösung** (M2 nachgewiesen): Nextcloud bildet den ETag aus der mtime in ganzen Sekunden. Schreibt ein anderer Client in derselben Sekunde, in der das Plugin liest, bleibt der ETag gleich. Ein späterer `PUT` mit `If-Match` würde dessen Änderung überschreiben. Umgekehrt kann ein Schreibzugriff in derselben Sekunde *nach* dem Plugin-`PUT` unsichtbar bleiben.
2. Wo fällt die Entscheidung aus Tabelle 7.3 (lokal/remote geändert), wenn Pull, Push und die Strategien `preferLocal`/`preferRemote` zusammenkommen?
3. Wie wirken „Lokal behalten“ und „Remote übernehmen“ im Konflikt-Dialog, ohne eine zweite Sync-Logik neben dem Lauf aufzubauen?
4. Wie werden eigene Schreibzugriffe von Nutzer-Änderungen unterschieden (PLAN §7.6)?

## Entscheidung

- **Bestätigte ETags.** Ein per `GET` gelesener ETag gilt als bestätigt, wenn die Sekunde von `Last-Modified` vor der Sekunde von `Date` derselben Antwort liegt. Dann ändert jeder spätere Schreibzugriff die Sekunde und damit den ETag, `If-Match` schützt also. Fehlt einer der Header, gilt der ETag als unbestätigt.
  - Unbestätigter Stand: `remoteMtime` wird im State als `-1` gespeichert (`UNCONFIRMED_REMOTE_MTIME`). Der nächste Lauf liest die Seite dann erneut und vergleicht Hashes. Ein Schema-Wechsel ist nicht nötig.
  - Soll auf Basis eines unbestätigten ETags gepusht werden, wartet der Lauf 1,1 s und liest erneut. Bleibt der Stand unbestätigt, wird der Push auf den nächsten Lauf verschoben.
  - Nach einem eigenen `PUT` ist der Stand **immer** unbestätigt. Der nächste Lauf prüft ihn mit einem `GET` und Hash-Vergleich, schreibt dabei aber nichts. Erst der Lauf danach ist ein Leerlauf ohne Requests auf Inhalte. So bleibt auch ein Browser-Schreibzugriff in der Sekunde nach dem Plugin-`PUT` nicht unbemerkt.
  - Fehlt der ETag in einer erfolgreichen `PUT`-Antwort, wird er per Depth-0-`PROPFIND` nachgeholt.
- **Entscheidung als reine Funktion** `decideContent` in `src/sync/decide.ts` (unter der ESLint-Reinheitsregel): Eingaben sind `baseHash`, `localHash`, `remoteHash`, Seitenstatus und Strategie. Die Ausgabe ist `none`/`push`/`pull`/`adoptBase`/`conflict`. Der Executor führt nur aus. Für Seiten mit Status `conflict`/`collision` gilt immer `conflictFile`, und aus `push` wird `none`. Solche Seiten werden erst nach der Auflösung hochgeladen.
- **Strategien** `conflictFile` (Default), `preferLocal`, `preferRemote` als Setting. Die beiden `prefer`-Strategien überschreiben die Gegenseite ohne Rückfrage. Die Einwilligung dazu liegt in der Auswahl im Setting, die Beschreibung dort sagt das ausdrücklich.
- **Planner**: `planPull` heißt jetzt `planSync`. Eine bekannte Seite bekommt die Operation `push`, wenn remote unverändert ist (Listing-`timestamp`/`size` = State) und lokal ein Kandidat vorliegt. Kandidat ist eine Datei, deren mtime von `localMtime` abweicht oder die in der Dirty-Queue steht. Ob wirklich hochgeladen wird, entscheidet erst der Hash. Eine abweichende mtime bei gleichem Inhalt führt nur zu einem neuen `localMtime`. Das macht die offene M3-Frage unkritisch, ob `file.stat.mtime` direkt nach `vault.process` aktuell ist.
- **Konfliktauflösung als State-Übergang** (`src/sync/conflicts.ts`). Der Dialog ändert nur den State, danach läuft ein normaler Sync:
  - „Lokal behalten“: `status: synced`, `baseHash: ''`, `localMtime: -1`. Der nächste Lauf lädt mit `If-Match` auf den ETag hoch, der zum Zeitpunkt des Konflikts galt. Hat sich die Remote-Fassung seitdem erneut geändert, kommt `412` und daraus ein neuer Konflikt statt eines Überschreibens.
  - „Remote übernehmen“: `status: synced`, `baseHash` = Hash der aktuellen lokalen Datei, `remoteMtime: -1`. Der nächste Lauf liest remote, sieht „nur remote geändert“ und überschreibt die lokale Datei über `vault.process`, nur wenn sie sich zwischen Lesen und Schreiben nicht geändert hat.
  - Bei Kollisionen (Nutzerdatei ohne `nc_page_id`) schreibt die Auflösung zuerst minimale `nc_*`-Felder in die Datei. `metaHash: ''` sorgt dafür, dass der nächste Lauf die vollständigen Felder setzt.
  - Die Konfliktkopie wandert nach der Auflösung über `fileManager.trashFile` in den Papierkorb, wie in Obsidian eingestellt. Die Auswahl im Dialog gilt als Rückfrage im Sinne von AGENTS Regel 4.
- **Eigene Schreibzugriffe** (`src/sync/dirtyQueue.ts`): Der Vault-Port des Laufs markiert jeden Pfad vor `create`/`process` für 5 s als unterdrückt. Die Markierung wird beim ersten Event nicht verbraucht (Muster aus Nextcloud Sync, `docs/api-notes.md` §11). `modify`-Events auf andere Pfade landen in der Dirty-Queue, die der nächste Lauf leert. Automatische Auslöser (Debounce nach Speichern) bleiben M9.

## Betrachtete Alternativen

- **Push zurückstellen, solange die Remote-mtime jünger als 2 s ist** – kein Warten im Lauf, aber ein manueller Sync tut dann scheinbar nichts. Vom Nutzer verworfen.
- **Eigenes Feld `remoteConfirmed` im State** – klarer lesbar, erfordert aber ein neues `schemaVersion` samt Migration. Der Sentinel `-1` erzwingt dieselbe Prüfung über den bestehenden mtime-Vergleich.
- **Konfliktauflösung direkt im Dialog** (sofort `PUT` bzw. Datei überschreiben) – das wäre eine zweite Schreiblogik neben dem Executor, mit eigener ETag- und Race-Behandlung. Über den State-Übergang gelten dieselben Schutzmechanismen wie im Lauf.
- **Konfliktkopie liegen lassen** – sicherer, aber der Vault füllt sich mit erledigten Kopien. Vom Nutzer verworfen.

## Konsequenzen

- positiv: kein stilles Überschreiben bei Schreibzugriffen in derselben Sekunde; Pull, Push und Strategien folgen einer einzigen, vollständig unit-getesteten Entscheidungstabelle; nach dem Push kein Ping-Pong.
- negativ / Kosten: Nach jedem Push kostet der folgende Lauf ein `GET` pro hochgeladener Seite. In seltenen Fällen wartet ein Lauf 1,1 s pro Seite. Mit `preferRemote` können lokale Änderungen ohne Kopie verloren gehen. Das ist gewollt und wird im Setting erklärt.
- Folgearbeiten: M5 (neue lokale Dateien, Strukturfälle; Kollisionsdateien nicht als neue Seite hochladen), M6 (Metadaten-Push), M9 (Debounce nach Speichern nutzt die Dirty-Queue als Auslöser).
