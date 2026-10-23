[English](../en/settings.md) | **Deutsch**

# Einstellungen

[Handbuch](README.md) › Einstellungen

Öffne „Einstellungen › Nextcloud Collectives Sync“. Ganz oben führt **Hilfe** mit dem Link „Handbuch öffnen“ auf diese Seite. Die Einstellungen stehen hier in der Reihenfolge der Einstellungsseite. Text- und Zahlenfelder werden gespeichert, wenn du das Feld verlässt oder Enter drückst. Ein ungültiger Wert wird nicht gespeichert: Du siehst eine Meldung, und das Feld zeigt wieder den gespeicherten Wert.

Inhalt:

- [Verbindung](#verbindung): [Server-URL](#server-url), [Benutzername](#benutzername), [Mit dem Browser anmelden](#mit-dem-browser-anmelden), [App-Passwort](#app-passwort), [Verbindung testen](#verbindung-testen)
- [Automatische Synchronisierung](#automatische-synchronisierung): [Sync-Intervall (Minuten)](#sync-intervall-minuten), [Beim Start synchronisieren](#beim-start-synchronisieren), [Bei Rückkehr zu Obsidian synchronisieren](#bei-rückkehr-zu-obsidian-synchronisieren), [Nach Änderungen synchronisieren](#nach-änderungen-synchronisieren), [Wartezeit nach der letzten Änderung (Sekunden)](#wartezeit-nach-der-letzten-änderung-sekunden)
- [Verhalten](#verhalten): [Konflikte](#konflikte), [Neue Ordner auf oberster Ebene](#neue-ordner-auf-oberster-ebene), [Notizen in diesem Vault löschen](#notizen-in-diesem-vault-löschen), [Auf dem Server gelöschte Seiten](#auf-dem-server-gelöschte-seiten), [Anhang-Ordner](#anhang-ordner), [Größter Anhang (MB)](#größter-anhang-mb), [Anhänge auf dem Server löschen](#anhänge-auf-dem-server-löschen), [Eigenschaften des Plugins ausblenden](#eigenschaften-des-plugins-ausblenden), [Seite des Ordners zuerst anzeigen](#seite-des-ordners-zuerst-anzeigen), [Seiten-Emoji in Titeln anzeigen](#seiten-emoji-in-titeln-anzeigen)
- [Diagnose](#diagnose): [Protokoll](#protokoll), [Ausführliches Protokoll](#ausführliches-protokoll)

## Verbindung

### Server-URL

Die Adresse deines Nextcloud-Servers, zum Beispiel `https://cloud.example.com`.

- Standard: leer.
- Lässt du `https://` weg, ergänzt das Plugin es. Ein Unterpfad (`https://example.com/nextcloud`) ist erlaubt; ein `/index.php` am Ende wird ignoriert. Abfragen (`?…`), Anker (`#…`) und Benutzernamen in der Adresse sind nicht erlaubt.
- Mit `http://` zu einem anderen Rechner erscheint unter dem Feld eine Warnung: „Achtung: Bei http:// wird das App-Passwort unverschlüsselt übertragen. Für Server außerhalb dieses Geräts bitte https:// verwenden.“ Die Anmeldung im Browser funktioniert mit so einer Adresse nicht.
- **Ein Vault ist fest an einen Server gebunden.** Wurde ein Vault einmal synchronisiert, stoppt eine Synchronisierung mit einer anderen Server-Adresse mit einer Meldung und ändert nichts. Für einen anderen Server legst du einen neuen Vault an.

### Benutzername

Dein Nextcloud-Anmeldename. Die Anmeldung im Browser trägt ihn ein.

- Standard: leer.
- Wurde ein Vault einmal mit einem Konto synchronisiert, stoppt eine Synchronisierung mit einem anderen Konto auf demselben Server mit einer Meldung und ändert nichts. Für ein anderes Konto legst du einen neuen Vault an.

### Mit dem Browser anmelden

Knopf **Anmelden**. Öffnet die Anmeldeseite deiner Nextcloud im Browser (Nextcloud Login Flow). Hast du dich dort angemeldet und den Zugriff erlaubt, werden Benutzername und App-Passwort automatisch eingetragen, und du siehst „Angemeldet als … Das App-Passwort ist gespeichert.“

- Trage zuerst die Server-URL ein.
- Solange das Plugin wartet, heißt der Knopf **Abbrechen**, und es erscheint der Link „Anmeldeseite erneut öffnen“ (falls sich der Browser nicht geöffnet hat).
- Die Anmeldeseite läuft nach 20 Minuten ab: „Die Anmeldeseite ist abgelaufen. Bitte erneut versuchen.“
- Braucht `https://` (oder eine Adresse auf diesem Gerät). Mit `http://` siehst du „Die Anmeldung im Browser braucht https:// – mit http:// würde das App-Passwort unverschlüsselt übertragen. Nutze https:// oder gib ein App-Passwort von Hand ein.“
- Änderst du die Server-URL, während das Plugin wartet, wird das neue App-Passwort nicht gespeichert.
- Jede Anmeldung legt in Nextcloud ein neues App-Passwort an. Du siehst und widerrufst sie in Nextcloud unter „Persönliche Einstellungen › Sicherheit“.

### App-Passwort

Die Alternative zur Anmeldung im Browser: In Nextcloud unter „Persönliche Einstellungen › Sicherheit“ ein App-Passwort erstellen und hier einfügen.

- Standard: leer.
- Das Passwort liegt im Secret Storage von Obsidian, nicht in den Plugin-Einstellungen (`data.json`), und wird nie wieder angezeigt. Ist eins gespeichert, zeigt das Feld „Gespeichert – zum Ersetzen neu eingeben“. Tippe ein neues ein, um es zu ersetzen.
- Nimm nicht dein Nextcloud-Hauptpasswort.

### Verbindung testen

Knopf **Verbindung testen**. Prüft Server-URL, Benutzername und App-Passwort und zählt deine Collectives, zum Beispiel „Verbindung erfolgreich: 3 Collectives gefunden.“ Verfügbar, sobald alle drei gesetzt sind. Die Fehlermeldungen erklärt [Hilfe bei Problemen](troubleshooting.md#verbindungstest-und-anmeldung).

## Automatische Synchronisierung

Wie die Auslöser zusammenspielen, steht in [Wann synchronisiert wird](sync.md).

### Sync-Intervall (Minuten)

Wie oft das Plugin von selbst synchronisiert, solange Obsidian offen ist.

- Standard: `5`.
- Werte: eine ganze Zahl von `0` bis `1440`. `0` schaltet das Intervall aus.
- Auf dem Handy läuft das Intervall nur, solange Obsidian im Vordergrund ist.

### Beim Start synchronisieren

Synchronisiert einmal, sobald Obsidian den Vault geladen hat (etwa 2 Sekunden danach).

- Standard: an.

### Bei Rückkehr zu Obsidian synchronisieren

Synchronisiert, wenn Obsidian wieder sichtbar wird, zum Beispiel wenn du auf dem Handy zur App oder am Desktop zum Obsidian-Fenster zurückwechselst. Höchstens einmal innerhalb von 30 Sekunden nach der letzten automatischen Synchronisierung.

- Standard: an.
- Auf dem Handy hält vor allem das den Vault aktuell, denn das Betriebssystem hält Obsidian im Hintergrund an, und das Intervall läuft dort nicht. Schalte es aus, wenn du auf dem Handy nur von Hand synchronisieren willst.
- Ist das aus, steht „Sync-Intervall (Minuten)“ auf 0 und sind „Beim Start synchronisieren“ und „Nach Änderungen synchronisieren“ aus, synchronisiert das Plugin nie von selbst; **Jetzt synchronisieren** funktioniert weiter.

### Nach Änderungen synchronisieren

Synchronisiert einige Sekunden, nachdem du eine synchronisierte Notiz nicht mehr bearbeitest. Auch Anlegen, Umbenennen, Verschieben und Löschen synchronisierter Notizen zählen als Änderung. Obsidian speichert beim Tippen automatisch, eine eigene Speichern-Aktion gibt es nicht.

- Standard: an.
- Jede dieser Synchronisierungen ist ein voller Lauf über alle Collectives.

### Wartezeit nach der letzten Änderung (Sekunden)

Wie lange das Plugin nach deiner letzten Änderung wartet, bevor „Nach Änderungen synchronisieren“ einen Lauf startet. Jede weitere Änderung startet die Wartezeit neu.

- Standard: `10`.
- Werte: eine ganze Zahl von `2` bis `600`.
- Wirkt nur, wenn „Nach Änderungen synchronisieren“ an ist.
- Eine kurze Wartezeit bringt deine Änderungen schneller zum Server, startet aber mehr Läufe, während du arbeitest.

## Verhalten

### Konflikte

Was passiert, wenn eine Seite seit der letzten Synchronisierung in diesem Vault und auf dem Server geändert wurde. Mehr in [Konflikte](conflicts.md).

- Standard: **Beide behalten (Konfliktkopie)**.
- Optionen:
  - **Beide behalten (Konfliktkopie)**: Lässt deine Datei unverändert, legt die Server-Fassung daneben ab, und du entscheidest später mit „Konflikte anzeigen“.
  - **Diesen Vault bevorzugen (überschreibt den Server)**: Die Server-Fassung wird ohne Rückfrage überschrieben.
  - **Server bevorzugen (überschreibt diesen Vault)**: Deine Datei wird ohne Rückfrage überschrieben.
- Risiko: Mit beiden „bevorzugen“-Optionen gehen die Änderungen der jeweils anderen Seite verloren. Eine Warnung unter der Einstellung weist darauf hin. Seiten mit bestehendem Konflikt brauchen weiterhin deine Entscheidung.
- Gilt auch für Emoji und Tags.

### Neue Ordner auf oberster Ebene

Was passiert, wenn du im Vault auf oberster Ebene einen Ordner anlegst und Notizen hineinlegst. Ein Ordner auf oberster Ebene ist auf dem Server ein Collective.

- Standard: **Collective anlegen**.
- Optionen:
  - **Collective anlegen**: Auf dem Server entsteht ein neues Collective mit dem Namen des Ordners. Die Notiz mit dem Namen des Ordners wird die Startseite, die übrigen Notizen werden Seiten.
  - **Vorher fragen**: Die Synchronisierung fragt im [Bestätigungsdialog](structure.md#der-bestätigungsdialog) („Collective „…“ auf dem Server anlegen“). Lässt du es unangehakt, bleibt der Ordner bei dieser Synchronisierung unberührt, und du wirst bei der nächsten erneut gefragt.
  - **Ordner ignorieren**: Der Ordner wird nicht synchronisiert.
- Risiko: Mit dem Standard wird jeder Ordner auf oberster Ebene mit Notizen hochgeladen, auch Ordner, die schon vor der ersten Synchronisierung im Vault lagen. Wähle „Vorher fragen“, wenn du andere Notizen im selben Vault hast.
- Ordner ohne Notizen werden nie hochgeladen.

### Notizen in diesem Vault löschen

Was auf dem Server passiert, wenn du im Vault eine synchronisierte Notiz oder einen Ordner löschst. Gelöschte Seiten kommen auf dem Server in den Collectives-Papierkorb und lassen sich dort wiederherstellen.

- Standard: **Vorher fragen**.
- Optionen:
  - **Vorher fragen**: Zeigt im [Bestätigungsdialog](structure.md#der-bestätigungsdialog) eine Liste, bevor auf dem Server etwas gelöscht wird. Was du nicht anhakst, kommt in den Vault zurück.
  - **Ohne Rückfrage in den Collectives-Papierkorb**: Gelöschte Notizen werden ohne Frage auf dem Server gelöscht.
- Ein ganzes Collective (sein Ordner auf oberster Ebene) wird immer bestätigt. Ebenso viele Seiten auf einmal (mindestens 3 Seiten und mehr als 20 % eines Collectives), siehe [Schutz vor Massenlöschung](structure.md#schutz-vor-massenlöschung).

### Auf dem Server gelöschte Seiten

Was mit deiner Datei passiert, wenn ihre Seite auf dem Server gelöscht wurde.

- Standard: **Datei in den Papierkorb legen**.
- Optionen:
  - **Datei in den Papierkorb legen**: Die Notiz kommt in den Papierkorb, wie in Obsidian eingestellt. Auf dem Server gelöschte Anhänge der Seite ebenso.
  - **Datei behalten (sie wird als neue Seite hochgeladen)**: Die Notiz bleibt und wird als neue Seite mit neuer Seiten-ID hochgeladen. Auf dem Server gelöschte Anhänge bleiben im Vault.
- Eine Datei, die du seit der letzten Synchronisierung geändert hast, wird nie entfernt: Die Seite wird stattdessen aus dem Collectives-Papierkorb wiederhergestellt und deine Änderung hochgeladen.
- Ein ganzes Collective, das auf dem Server gelöscht wurde oder das du verlassen hast, wird immer erst bestätigt.

### Anhang-Ordner

Wohin heruntergeladene Anhänge gespeichert werden, relativ zum Ordner der Notiz. `{title}` steht für den Namen der Notiz.

- Standard: `_attachments/{title}` (für `Handbuch/Onboarding.md`: `Handbuch/_attachments/Onboarding/`).
- Werte: einfache Ordnernamen, getrennt durch `/`. Nicht erlaubt: ein Punkt am Anfang, `..` und die Zeichen `* " \ < > : | ? # ^ [ ]`. `/` am Anfang und Ende wird entfernt.
- Dateien, die du von anderswo aus dem Vault einbettest, bleiben, wo sie sind; nur heruntergeladene Dateien landen hier.
- Eine Änderung gilt für Anhänge, die ab dann heruntergeladen werden. Dateien, die schon im Vault liegen, werden nicht verschoben.

### Größter Anhang (MB)

Größere Dateien werden weder hoch- noch heruntergeladen.

- Standard: `20`.
- Werte: eine ganze Zahl von `1` bis `1000`.
- Erhöhst du das Limit, werden zuvor zu große Dateien geholt, sobald sich der Text ihrer Seite auf dem Server das nächste Mal ändert.
- Große Anhänge kosten Zeit und mobile Daten, besonders auf dem Handy.

### Anhänge auf dem Server löschen

Löschst du eine Anhang-Datei im Vault und keine Notiz nutzt sie mehr, kommt sie auch auf dem Server in den Collectives-Papierkorb.

- Standard: an.
- Aus: Die Datei bleibt auf dem Server; das Plugin verfolgt sie nur nicht weiter.

### Eigenschaften des Plugins ausblenden

Blendet die Eigenschaften des Plugins (`nc_page_id`, `nc_collective_id`, `nc_emoji`, `nc_title`) in den Eigenschaften einer Notiz aus. Das Emoji setzt du mit dem Befehl oder dem Kontextmenü; Tags stehen in der Eigenschaft „tags“, die sichtbar bleibt.

- Standard: an.
- Nur die Anzeige ändert sich. Sind die Eigenschaften eingeblendet, erscheinen sie mit lesbaren Namen: „Seiten-ID“, „Collective-ID“, „Emoji“, „Seitentitel“.

### Seite des Ordners zuerst anzeigen

In der Dateiliste steht die Notiz, die zu einem Ordner gehört (`Ordner/Ordner.md`), immer als erste in diesem Ordner, unabhängig von der Sortierung.

- Standard: an.
- Nur die Anzeige ändert sich.

### Seiten-Emoji in Titeln anzeigen

Zeigt das Emoji einer Seite vor dem Titel der Notiz in der Dateiliste und im Kopf der Notiz.

- Standard: an.
- Nur die Anzeige ändert sich, nicht der Dateiname.

## Diagnose

### Protokoll

Knopf **Protokoll anzeigen**. Zeigt, was das Plugin in dieser Sitzung getan hat; wie der Befehl **Protokoll anzeigen**. Siehe [Hilfe bei Problemen](troubleshooting.md#das-protokoll).

### Ausführliches Protokoll

Protokolliert zusätzlich jede Anfrage an den Server: Methode, Pfad, Status und Dauer. Passwörter und Seiteninhalte stehen nie darin.

- Standard: aus.
- Schalte es ein, wenn du einem Problem nachgehst, und danach wieder aus. Die Pfade enthalten deinen Benutzernamen und die Namen von Collectives und Seiten; prüfe das Protokoll also, bevor du es weitergibst.
