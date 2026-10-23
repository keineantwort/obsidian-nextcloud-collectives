[English](../en/sync.md) | **Deutsch**

# Wann synchronisiert wird

[Handbuch](README.md) › Wann synchronisiert wird

Jede Synchronisierung ist ein voller Lauf: Das Plugin vergleicht alle Collectives auf dem Server mit dem Vault, in beide Richtungen. Es läuft immer nur ein Lauf auf einmal. Wird während eines Laufs eine Synchronisierung angestoßen, folgt danach noch ein Lauf.

## Auslöser

| Auslöser | Wann | Einstellung |
|---|---|---|
| Start | Etwa 2 Sekunden, nachdem Obsidian den Vault geladen hat. | [Beim Start synchronisieren](settings.md#beim-start-synchronisieren) (Standard: an) |
| Intervall | Alle paar Minuten, solange Obsidian offen ist. | [Sync-Intervall (Minuten)](settings.md#sync-intervall-minuten) (Standard: 5, 0 = aus) |
| Nach Änderungen | Einige Sekunden, nachdem du eine synchronisierte Notiz zuletzt geändert, angelegt, umbenannt oder gelöscht hast. Jede weitere Änderung startet die Wartezeit neu. | [Nach Änderungen synchronisieren](settings.md#nach-änderungen-synchronisieren) (Standard: an) und [Wartezeit nach der letzten Änderung (Sekunden)](settings.md#wartezeit-nach-der-letzten-änderung-sekunden) (Standard: 10) |
| Zurück im Vordergrund | Wenn Obsidian wieder sichtbar wird, zum Beispiel wenn du auf dem Handy zur App zurückkehrst. Höchstens einmal innerhalb von 30 Sekunden nach der letzten automatischen Anforderung. | keine, immer an |
| Von Hand | Befehl **Jetzt synchronisieren**, das Symbol **Mit Nextcloud Collectives synchronisieren** in der Seitenleiste oder ein Klick auf die Statusleiste. | – |

Obsidian speichert beim Tippen automatisch, eine eigene Speichern-Aktion gibt es nicht. „Nach Änderungen“ wartet deshalb, bis du die eingestellte Zahl an Sekunden nicht mehr getippt hast.

Auf dem Handy hält das Betriebssystem Obsidian im Hintergrund an, Timer laufen dort nicht. Die Synchronisierung beim Zurückkehren hält das Handy aktuell.

## Läufe von Hand

Ein Lauf von Hand zeigt währenddessen „Synchronisierung mit Nextcloud läuft …“ und am Ende eine Zusammenfassung, zum Beispiel:

> Synchronisierung abgeschlossen. Neu: 2 · Aktualisiert: 1 · Hochgeladen: 1 · Unverändert: 40

Die Teile der Zusammenfassung:

| Text | Bedeutung |
|---|---|
| Neu | Seiten, die zum ersten Mal heruntergeladen wurden. |
| Aktualisiert | Notizen, die den Text vom Server bekommen haben. |
| Hochgeladen | Deine Änderungen, die zum Server gingen. |
| Nur Metadaten | Auf dem Server haben sich nur Emoji oder Tags geändert. |
| Emoji/Tags gesendet | Deine Änderungen an Emoji oder Tags gingen zum Server. |
| Neu hochgeladen | Neue Notizen, die als neue Seiten hochgeladen wurden. |
| Verschoben oder umbenannt | Seiten, die verschoben oder umbenannt wurden, in beide Richtungen. |
| In den Collectives-Papierkorb | Seiten oder Collectives, die auf dem Server gelöscht wurden (dort wiederherstellbar). |
| Hier entfernt | Notizen oder Ordner, die im Vault in den Papierkorb kamen. |
| Wiederhergestellt | Seiten, die aus dem Collectives-Papierkorb zurückgeholt wurden. |
| Anhänge | Übertragene oder gelöschte Anhang-Dateien. |
| Unverändert | Seiten, bei denen nichts zu tun war. |

Weitere Zeilen melden Konflikte, Seiten, die nicht geklappt haben, und andere Dinge, die du wissen solltest. Zusammenfassungen ohne Probleme verschwinden von selbst; Warnungen und Fehler bleiben, bis du sie schließt.

Rückfragen wie „diese Seite auf dem Server löschen?“ öffnen bei einem Lauf von Hand einen Dialog; siehe [Struktur](structure.md#der-bestätigungsdialog).

Startest du eine Synchronisierung, während eine läuft, siehst du „Es läuft bereits eine Synchronisierung. Sie läuft danach noch einmal.“

## Automatische Läufe sind still

Läufe durch Start, Intervall, Änderungen oder Vordergrund unterbrechen dich nicht:

- Keine Fortschrittsmeldung und keine Zusammenfassung, wenn alles geklappt hat. Eine Meldung erscheint nur bei Warnungen und Fehlern, und dieselbe Meldung wird nicht Lauf für Lauf wiederholt.
- Keine Dialoge. Rückfragen werden zurückgestellt, alles andere erledigt der Lauf. Du siehst „Einige Änderungen brauchen deine Entscheidung. Starte „Jetzt synchronisieren“, um zu antworten.“ Führe dann **Jetzt synchronisieren** aus.
- Die erste Synchronisierung eines Vaults mit Inhalt startet nie automatisch; siehe [Erste Schritte](getting-started.md#vault-mit-inhalt).
- Kein Netz (auf dem Handy normal) und fehlende Anmeldedaten erzeugen keine Meldung. Der nächste Lauf versucht es erneut.

### Pausierte Läufe

Weist der Server Benutzername oder App-Passwort ab, oder antwortet er so, dass das Plugin ihn nicht versteht, pausieren die automatischen Läufe. Du siehst den Fehler einmal. Sie laufen wieder, sobald du etwas in den Einstellungen des Plugins änderst (zum Beispiel dich neu anmeldest oder ein neues App-Passwort einträgst), oder nach einer Synchronisierung von Hand, bei der keine Seite fehlgeschlagen ist. Synchronisierungen von Hand laufen immer, auch während die automatischen pausieren.

## Statusleiste

Am Desktop zeigt die Statusleiste den Stand der Synchronisierung. Auf dem Handy hat Obsidian keine Statusleiste; nutze dort die Befehle.

| Text | Bedeutung | Klick |
|---|---|---|
| `NC –` | Seit dem Start von Obsidian noch nicht synchronisiert. | Synchronisiert jetzt. |
| `NC ⟳` | Eine Synchronisierung läuft. | – |
| `NC ✓ 14:05` | Zuletzt synchronisiert um diese Uhrzeit. | Synchronisiert jetzt. |
| `NC ⚠︎ 2` | Anzahl offener Konflikte. | Öffnet den Konflikt-Dialog. |
| `NC ✕` | Die letzte Synchronisierung ist fehlgeschlagen. | Öffnet den Konflikt-Dialog, wenn es offene Konflikte gibt, sonst synchronisiert er jetzt. |

Fährst du mit der Maus über die Statusleiste, zeigt sie den ganzen Satz, zum Beispiel „Nextcloud Collectives: zuletzt synchronisiert um 14:05. 2 offene Konflikte. Klicken, um die Konflikte anzuzeigen.“

## Was nicht synchronisiert wird

- Notizen direkt im Vault-Ordner, außerhalb eines Collective-Ordners. Das Protokoll vermerkt, wie viele es sind.
- Ordner und Dateien, deren Name mit einem Punkt beginnt, und der Konfigurationsordner von Obsidian.
- Konfliktkopien (Dateien mit „(Konflikt …)“ oder „(Conflict …)“ im Namen).
- Dateien, die keine Markdown-Notizen (`.md`) sind, außer eine synchronisierte Notiz bettet sie als Anhang ein. Canvas-Dateien (`.canvas`) und Bases (`.base`) werden nicht synchronisiert.
- Anhänge über der Einstellung [Größter Anhang (MB)](settings.md#größter-anhang-mb).
- Ordner auf oberster Ebene, wenn die Einstellung [Neue Ordner auf oberster Ebene](settings.md#neue-ordner-auf-oberster-ebene) auf „Ordner ignorieren“ steht.
