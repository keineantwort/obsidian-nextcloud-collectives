[English](../en/conflicts.md) | **Deutsch**

# Konflikte

[Handbuch](README.md) › Konflikte

## Wann ein Konflikt entsteht

Ein Konflikt entsteht, wenn eine Seite seit der letzten Synchronisierung sowohl im Vault als auch auf dem Server geändert wurde und die beiden Fassungen verschieden sind. Haben beide Seiten dieselbe Änderung gemacht, gibt es keinen Konflikt.

Mit der Standardeinstellung („Beide behalten (Konfliktkopie)“) überschreibt das Plugin nichts:

- Deine Datei bleibt unverändert.
- Die Server-Fassung wird daneben als `Titel (Konflikt JJJJ-MM-TT HHmm).md` abgelegt. Diese Kopie wird nicht synchronisiert. Läuft Obsidian auf Englisch, heißt die Kopie `Title (Conflict …).md`.
- Die Seite wird erst wieder hochgeladen, wenn du den Konflikt aufgelöst hast.

Die Zusammenfassung der Synchronisierung sagt das: „1 Konflikt: Deine Datei bleibt erhalten, die Server-Fassung liegt daneben mit „Konflikt“ im Namen. Mit dem Befehl „Konflikte anzeigen“ entscheidest du, welche Fassung bleibt.“

Für Emoji und Tags gilt dieselbe Regel. Wurden sie auf beiden Seiten geändert, behält die Notiz ihre Werte, und die Werte des Servers stehen in der Konfliktkopie.

## Kollisionen

Eine Kollision ist ein Sonderfall beim ersten Abgleich: Am Zielpfad einer Server-Seite lag schon eine Datei aus deinem Vault, und diese Datei hat keine `nc_page_id`. Auch hier bleibt deine Datei erhalten, und die Server-Seite landet als Konfliktkopie daneben. Der Konflikt-Dialog kennzeichnet sie mit „In deinem Vault gab es schon eine Datei mit diesem Namen.“

Auch Anhänge können kollidieren. Haben ein Bild im Vault und eins auf dem Server denselben Namen, aber verschiedenen Inhalt, wird die Datei des Servers als `name (Konflikt …).png` neben deine gelegt.

## Der Konflikt-Dialog

Offene Konflikte zeigt die Statusleiste als `NC ⚠︎ n` (nur Desktop); ein Klick öffnet den Dialog. Auch der Befehl **Konflikte anzeigen** öffnet ihn; auf dem Handy ist er der einzige Weg. Gibt es keine Konflikte, siehst du „Es gibt keine offenen Konflikte.“

Der Dialog **Synchronisierungskonflikte** listet jede Seite mit Konflikt. Pro Seite zeigt „Unterschiede anzeigen“ die Zeilen, die „Nur in deiner Datei“ und „Nur auf dem Server“ stehen. Die erste Seite ist gleich aufgeklappt. Sehr große Dateien zeigen „Zu groß für einen Vergleich.“

| Auswahl | Wirkung |
|---|---|
| **Lokal behalten** | Deine Datei wird hochgeladen und ersetzt die Server-Fassung. Hat sich die Server-Fassung inzwischen erneut geändert, entsteht ein neuer Konflikt statt eines Überschreibens („Die Server-Fassung von „…“ hat sich inzwischen erneut geändert, daher gibt es einen neuen Konflikt.“). Bei einer Kollision wird deine Datei dabei mit der Server-Seite verknüpft. |
| **Remote übernehmen** | Der Inhalt deiner Datei wird durch die Server-Fassung ersetzt. Die Server-Fassung wird dafür neu geladen, die Konfliktkopie muss also nicht mehr vorhanden sein. |
| **Später** | Alles bleibt, wie es ist. |

Nach „Lokal behalten“ oder „Remote übernehmen“ wird die Konfliktkopie in den Papierkorb verschoben, wie in Obsidian eingestellt. Danach läuft sofort eine Synchronisierung. Sind alle Konflikte geklärt, zeigt der Dialog „Alle Konflikte sind geklärt.“ und den Knopf **Schließen**.

Du kannst einen Konflikt auch von Hand lösen: Bearbeite deine Datei, bis sie stimmt, und wähle dann **Lokal behalten**.

## Die Einstellung „Konflikte“

Die Einstellung [Konflikte](settings.md#konflikte) im Abschnitt „Verhalten“ legt fest, was bei einer beidseitigen Änderung passiert:

- **Beide behalten (Konfliktkopie)**: Standard, wie oben beschrieben.
- **Diesen Vault bevorzugen (überschreibt den Server)**: Die Server-Fassung wird ohne Rückfrage überschrieben.
- **Server bevorzugen (überschreibt diesen Vault)**: Deine Datei wird ohne Rückfrage überschrieben.

Mit den beiden „bevorzugen“-Optionen gehen die Änderungen der jeweils anderen Seite verloren. Die Einstellungen zeigen eine Warnung, wenn du eine davon wählst. Bereits bestehende Konflikte brauchen weiterhin deine Entscheidung im Konflikt-Dialog.

## Gleichzeitig im Browser bearbeiten

Lädt das Plugin eine Seite hoch, während sie im Browser im Collectives-Editor offen ist, meldet der Editor „Die Bearbeitungssitzung ist abgelaufen. Bitte die Seite neu laden.“ Lade die Seite dann neu. Was du nach dieser Meldung im Browser noch eingibst, wird nicht mehr gespeichert.

Das Plugin schützt die Server-Seite: Hat der Browser die Seite gespeichert, nachdem das Plugin sie zuletzt gelesen hat, scheitert das Hochladen, und du bekommst einen Konflikt statt eines Überschreibens. In die laufende Bearbeitungssitzung des Browsers greift es nicht ein. Hintergrund: [ADR 0012](../../adr/0012-concurrent-editing-in-the-browser.md) (auf Englisch).

Hat der Server die aktuelle Fassung einer Seite nicht bestätigt, lädt das Plugin sie nicht hoch und versucht es bei der nächsten Synchronisierung erneut: „1 Seite wurde nicht gesendet: Der Server hat ihre aktuelle Version nicht bestätigt. Sie wird bei der nächsten Synchronisierung erneut versucht.“
