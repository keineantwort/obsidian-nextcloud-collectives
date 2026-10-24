[English](../en/troubleshooting.md) | **Deutsch**

# Hilfe bei Problemen

[Handbuch](README.md) › Hilfe bei Problemen

## Das Protokoll

Der Befehl **Protokoll anzeigen** (auch der Knopf **Protokoll anzeigen** in den Einstellungen unter „Diagnose“) öffnet „Nextcloud Collectives Sync – Protokoll“. Es zeigt die letzten Einträge dieser Sitzung: Synchronisierungen, Warnungen, Fehler, die Nextcloud-Version. **Protokoll kopieren** kopiert es in die Zwischenablage.

![Das Protokoll der Sitzung mit der Nextcloud-Version und einer angelegten Konfliktkopie](../../images/de/log.png)

- Zugangsdaten werden nie protokolliert.
- Lehnt der Server einen Vorgang ab, enthält der Eintrag seine Begründung als `detail` (zum Beispiel `Tag already exists for collective: Projekt`; der Server antwortet auf Englisch). Sie kann Namen von Collectives, Seiten oder Tags enthalten, nie Passwörter oder Seiteninhalte.
- Das Protokoll liegt nur im Speicher (die letzten 500 Einträge) und ist nach einem Neustart von Obsidian weg. Kopiere es gleich, nachdem das Problem aufgetreten ist.
- Mit der Einstellung [Ausführliches Protokoll](settings.md#ausführliches-protokoll) steht zusätzlich jede Anfrage an den Server darin (Methode, Pfad, Status, Dauer; nie Passwörter oder Inhalte). Die Pfade enthalten deinen Benutzernamen und die Namen von Collectives und Seiten.

Hänge das Protokoll an, wenn du ein Problem meldest. Probleme meldest du als [GitHub-Issue](https://github.com/keineantwort/obsidian-nextcloud-collectives/issues).

## Verbindungstest und Anmeldung

Diese Meldungen erscheinen in den Einstellungen nach **Verbindung testen** oder **Anmelden**, und nach „Synchronisierung gestoppt.“, wenn eine Synchronisierung scheitert.

| Meldung | Was zu tun ist |
|---|---|
| Bitte die Server-URL angeben. | Trage die Adresse deiner Nextcloud bei „Server-URL“ ein. |
| Die Server-URL ist ungültig. Beispiel: `https://cloud.example.com` | Gib nur die Adresse an, ohne `?…` oder `#…` und ohne Benutzernamen darin. |
| Bitte den Benutzernamen angeben. | Trage deinen Benutzernamen ein oder nutze „Anmelden“. |
| Bitte ein App-Passwort hinterlegen. | Trage ein App-Passwort ein oder nutze „Anmelden“. |
| Anmeldung fehlgeschlagen. Bitte Benutzername und App-Passwort prüfen. | Das App-Passwort ist falsch oder wurde in Nextcloud widerrufen. Melde dich neu an oder erstelle ein neues App-Passwort. Bis dahin pausieren die automatischen Läufe. |
| Zugriff verweigert (HTTP 403). Bitte prüfen, ob die App Collectives für dein Konto freigegeben ist. | Vielleicht hat deine Administration die App Collectives auf bestimmte Gruppen beschränkt. |
| Die Collectives-API wurde nicht gefunden. Bitte die Server-URL prüfen und sicherstellen, dass die App Collectives auf dem Server aktiviert ist. | Prüfe die Adresse (ein Unterpfad wie `/nextcloud` muss dabei sein) und frage deine Administration, ob Collectives installiert ist. |
| Der Server ist nicht erreichbar. Bitte Server-URL und Netzwerkverbindung prüfen. | Prüfe dein Netz und die Adresse. Automatische Läufe versuchen es später ohne Meldung erneut. |
| Der Server hat mit einem Fehler geantwortet (HTTP …). | Ein Problem auf dem Server. Versuche es später erneut; bleibt es, sag deiner Administration Bescheid. |
| Unerwartete Antwort vom Server. Ist die Server-URL korrekt und läuft dort Nextcloud mit der App Collectives? | Die Adresse zeigt vielleicht auf etwas anderes als Nextcloud. |
| Die Anmeldung im Browser braucht https:// … | Nimm eine `https://`-Adresse oder gib ein App-Passwort von Hand ein. |
| Die Anmeldeseite ist abgelaufen. Bitte erneut versuchen. | Du hast nicht innerhalb von 20 Minuten bestätigt. Wähle erneut „Anmelden“. |
| Anmeldung fehlgeschlagen: … | Der Grund steht nach dem Doppelpunkt; siehe die Zeilen oben. |

## Meldungen bei der Synchronisierung

| Meldung | Bedeutung und was zu tun ist |
|---|---|
| Synchronisierung gestoppt. … Das lässt sich in den Einstellungen des Plugins ändern. | In den Verbindungseinstellungen fehlt etwas oder stimmt nicht. Siehe die Tabelle oben. |
| Synchronisierung gestoppt. Unerwartete Antwort vom Server. Möglicherweise ist die Server-URL falsch oder die App Collectives wurde inkompatibel geändert. | Das Plugin stoppt, statt zu raten. Prüfe die Adresse. Nach einem Update von Collectives schau nach einem Update des Plugins. Die automatischen Läufe pausieren, bis du eine Einstellung änderst oder „Jetzt synchronisieren“ ausführst. |
| Synchronisierung gestoppt. Unbekannter Fehler bei der Synchronisierung. | Schau ins Protokoll und melde das Problem. |
| Dieser Vault wird bereits mit einem anderen Server synchronisiert (…). | Ein Vault gehört zu einem Server. Trage die alte Server-URL wieder ein oder lege für den neuen Server einen neuen Vault an. Es wurde nichts geändert. |
| Dieser Vault wird bereits mit einem anderen Nextcloud-Konto (…) auf diesem Server synchronisiert. | Ein Vault gehört zu einem Konto. Melde dich mit dem alten Konto an oder lege für das andere Konto einen neuen Vault an. Es wurde nichts geändert. |
| Nextcloud … wurde mit diesem Plugin nicht getestet. | Dein Server läuft mit einer Nextcloud-Hauptversion, mit der das Plugin nicht getestet wurde (getestet: 33, 34, 35). Die Synchronisierung läuft weiter. Geht etwas schief, schau ins Protokoll und melde es. Die Meldung kommt einmal pro Sitzung. |
| … Seiten konnten nicht synchronisiert werden. Sie werden bei der nächsten Synchronisierung erneut versucht. | Einzelne Seiten sind gescheitert (zum Beispiel ein Netzfehler mitten im Lauf). Details stehen im Protokoll. Die nächste Synchronisierung versucht es erneut. |
| … Seiten wurden nicht gesendet: Der Server hat ihre aktuelle Version nicht bestätigt. | Das Plugin lädt nur hoch, wenn es die aktuelle Fassung auf dem Server kennt. Die nächste Synchronisierung versucht es erneut. |
| … Notizen tragen eine Seiten-ID, die es auf dem Server nicht gibt. Sie wurden nicht angetastet. | Die `nc_page_id` dieser Notizen ist unbekannt (zum Beispiel aus einem anderen Vault kopiert, oder die Seite wurde endgültig gelöscht). Entferne die Eigenschaft `nc_page_id`, wenn die Notiz als neue Seite hochgeladen werden soll. |
| Du darfst ein Collective nicht umbenennen. Der Ordnername wurde zurückgesetzt. | Nur Admins und Eigentümer eines Collectives dürfen es umbenennen. |
| Du darfst ein Collective nicht löschen. Der Ordner wurde wiederhergestellt. | Nur Admins und Eigentümer eines Collectives dürfen es löschen. |
| … Seiten wurden auf beiden Seiten verschoben. Es gilt der Ort auf dem Server. | Siehe [Struktur](structure.md#änderungen-auf-dem-server). |
| … Notizen haben ein Emoji-Feld, das kein einzelnes Emoji ist: Es wurde nicht gesendet. | Korrigiere das Emoji mit dem Befehl „Seiten-Emoji setzen“. |
| Einige Änderungen brauchen deine Entscheidung. Starte „Jetzt synchronisieren“, um zu antworten. | Ein automatischer Lauf hat eine Rückfrage zurückgestellt. Führe **Jetzt synchronisieren** aus. |
| Die automatische Synchronisierung wartet auf die erste Synchronisierung dieses Vaults. Starte einmal „Jetzt synchronisieren“. | Der Vault hatte vor der ersten Synchronisierung schon Inhalt. Führe **Jetzt synchronisieren** aus und bestätige. Siehe [Erste Schritte](getting-started.md#vault-mit-inhalt). |
| Synchronisierung abgebrochen. Es wurde nichts geändert. | Du hast die erste Synchronisierung abgebrochen. |
| Es läuft bereits eine Synchronisierung. Sie läuft danach noch einmal. | Nichts zu tun. |

## Häufige Fragen

**Kann ich mehrere Nextcloud-Server in einen Vault synchronisieren?**
Nein. Ein Vault ist fest an einen Server gebunden. Nimm einen Vault pro Server.

**Kann ich ein anderes Konto im selben Vault nutzen?**
Nein. Ein Vault ist fest an ein Konto gebunden. Für ein anderes Konto legst du einen weiteren Vault an.

**Kann ich nur einige Collectives synchronisieren?**
Nein. Das Plugin synchronisiert alle Collectives deines Kontos.

**Kann ich andere Notizen im selben Vault haben?**
Notizen direkt im Vault-Ordner werden nicht synchronisiert. Ordner auf oberster Ebene mit Notizen werden Collectives, außer du stellst [Neue Ordner auf oberster Ebene](settings.md#neue-ordner-auf-oberster-ebene) auf „Vorher fragen“ oder „Ordner ignorieren“. Ein eigener Vault ist trotzdem die sicherere Wahl.

**Ich habe aus Versehen eine Seite gelöscht. Wie bekomme ich sie zurück?**
Auf dem Server liegt sie im Collectives-Papierkorb; stelle sie dort wieder her, dann kommt sie bei der nächsten Synchronisierung zurück. Hast du die Notiz noch (zum Beispiel im Papierkorb von Obsidian), lege sie zurück in ihren Ordner: Eine Notiz mit ihrer `nc_page_id` stellt die Seite aus dem Collectives-Papierkorb wieder her.

**Funktioniert das Plugin auf dem Handy?**
Ja, auf iOS und Android. Dort gibt es keine Statusleiste; nutze die Befehle und das Symbol in der Seitenleiste. Das Handy synchronisiert, wenn du zu Obsidian zurückkehrst; siehe [Wann synchronisiert wird](sync.md).

**Kann ich den Vault zusätzlich mit einem anderen Werkzeug synchronisieren (Obsidian Sync, iCloud, Syncthing)?**
Nötig ist das nicht: Jedes Gerät synchronisiert für sich mit Nextcloud. Das Plugin speichert seinen Sync-Stand in seinem Plugin-Ordner (`sync-state.json`). Synchronisiert ein anderes Werkzeug denselben Vault, können beide dieselben Dateien ändern; das ist nicht getestet.

**Wo liegt mein Passwort?**
Im Secret Storage von Obsidian. Die Plugin-Einstellungen enthalten nur eine ID, die darauf verweist.

**Die Statusleiste zeigt `NC ✕`. Was nun?**
Die letzte Synchronisierung ist fehlgeschlagen. Führe **Jetzt synchronisieren** aus, um die Meldung zu sehen, und schau ins Protokoll.
