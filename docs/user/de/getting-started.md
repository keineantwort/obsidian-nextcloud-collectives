[English](../en/getting-started.md) | **Deutsch**

# Erste Schritte

[Handbuch](README.md) › Erste Schritte

## Bevor du anfängst

- Installiere das Plugin wie auf der [Hauptseite](../../../README.de.md#installation) beschrieben.
- **Mache eine Sicherung** deines Vault-Ordners und wichtiger Collectives auf dem Server. Das Plugin schreibt in beide Richtungen.
- **Nimm einen neuen, leeren Vault**, wenn es geht. Dann lädt die erste Synchronisierung nur deine Collectives herunter, und nichts im Vault wird mit ihnen vermischt.

Ein Vault ist fest an einen Nextcloud-Server und ein Konto gebunden. Für einen anderen Server oder ein anderes Konto legst du einen weiteren Vault an.

## Anmelden

Öffne „Einstellungen › Nextcloud Collectives Sync“. Im Abschnitt **Verbindung** steht alles, was du brauchst.

1. Trage die **Server-URL** ein, die Adresse deiner Nextcloud, zum Beispiel `https://cloud.example.com`. Lässt du `https://` weg, ergänzt das Plugin es. Läuft Nextcloud unter einem Unterpfad (`https://example.com/nextcloud`), gib den Pfad mit an.
2. Melde dich auf einem von zwei Wegen an:
   - **Mit dem Browser anmelden** (empfohlen): Wähle **Anmelden**. Die Anmeldeseite deiner Nextcloud öffnet sich im Browser. Melde dich dort an und erlaube den Zugriff. Zurück in Obsidian sind Benutzername und App-Passwort eingetragen, und die Einstellungen zeigen „Angemeldet als …“. Hat sich der Browser nicht geöffnet, nutze den Link „Anmeldeseite erneut öffnen“. Die Anmeldeseite läuft nach 20 Minuten ab. Solange das Plugin wartet, heißt der Knopf **Abbrechen**.
   - **App-Passwort von Hand**: Erstelle in Nextcloud unter „Persönliche Einstellungen › Sicherheit“ ein App-Passwort. Trage in Obsidian deinen **Benutzernamen** ein und füge das App-Passwort bei **App-Passwort** ein. Das Feld speichert, wenn du es verlässt oder Enter drückst, und zeigt danach „Gespeichert – zum Ersetzen neu eingeben“.
3. Wähle **Verbindung testen**. Der Knopf ist verfügbar, sobald Server-URL, Benutzername und App-Passwort gesetzt sind. Passt alles, siehst du „Verbindung erfolgreich: … Collectives gefunden.“ Sonst steht dort, was nicht stimmt; siehe [Hilfe bei Problemen](troubleshooting.md#verbindungstest-und-anmeldung).

Das App-Passwort liegt im Secret Storage von Obsidian, nicht in den Plugin-Einstellungen, und erscheint nie im Protokoll. Dein Nextcloud-Hauptpasswort wird nie gespeichert.

Mit `http://` statt `https://` warnen die Einstellungen, dass das App-Passwort unverschlüsselt übertragen wird, und die Anmeldung im Browser startet nicht. Adressen auf deinem eigenen Gerät (`localhost`, `127.0.0.1`) sind ausgenommen.

## Die erste Synchronisierung

Führe den Befehl **Jetzt synchronisieren** aus oder klicke auf das Symbol **Mit Nextcloud Collectives synchronisieren** in der Seitenleiste. Während der Synchronisierung siehst du „Synchronisierung mit Nextcloud läuft …“, am Ende eine Zusammenfassung wie „Synchronisierung abgeschlossen. Neu: 42“.

### Leerer Vault

Ein Vault gilt als leer, wenn er außer dem Konfigurationsordner von Obsidian (`.obsidian`) nichts enthält. Die erste Synchronisierung lädt dann ohne Rückfrage alle Seiten aller deiner Collectives herunter. Das gilt auch, wenn die erste Synchronisierung automatisch startet (zum Beispiel durch das Intervall).

### Vault mit Inhalt

Enthält der Vault schon Dateien oder Ordner, fragt das Plugin vorher. Der Dialog **Dieser Vault ist nicht leer** erklärt, was passiert:

- Jedes Collective wird ein Ordner auf oberster Ebene des Vaults. Vorhandene Ordner gleichen Namens werden zusammengeführt.
- Hat eine Seite denselben Namen wie eine vorhandene Datei, bleibt deine Datei unverändert. Die Server-Fassung wird daneben als „Titel (Konflikt JJJJ-MM-TT HHmm).md“ abgelegt. Das heißt Kollision; siehe [Konflikte](conflicts.md#kollisionen).
- Es wird nichts gelöscht oder überschrieben. Notizen ohne Seiten-ID werden als neue Seiten zu Nextcloud hochgeladen, und ein neuer Ordner auf oberster Ebene wird zu einem neuen Collective.

Wähle **Zusammenführen**, um fortzufahren, oder **Abbrechen** (der vorausgewählte Knopf; Esc wirkt genauso). Nach „Abbrechen“ siehst du „Synchronisierung abgebrochen. Es wurde nichts geändert.“

Automatische Läufe starten dieses Zusammenführen nie. Bis du einmal **Jetzt synchronisieren** ausführst und bestätigst, meldet ein automatischer Lauf „Die automatische Synchronisierung wartet auf die erste Synchronisierung dieses Vaults. Starte einmal „Jetzt synchronisieren“.“

Prüfe vor dem Zusammenführen die Einstellung [Neue Ordner auf oberster Ebene](settings.md#neue-ordner-auf-oberster-ebene): Standardmäßig wird jeder Ordner auf oberster Ebene mit Notizen ein neues Collective auf dem Server.

## So sieht dein Vault danach aus

Jedes Collective ist ein Ordner auf oberster Ebene des Vaults. Eine Seite mit Unterseiten ist ein Ordner mit einer gleichnamigen Notiz darin. Beispiel:

| In Collectives | Im Vault |
|---|---|
| Collective „Handbuch“ | Ordner `Handbuch/` |
| Seine Startseite | `Handbuch/Handbuch.md` |
| Seite „Onboarding“ (ohne Unterseiten) | `Handbuch/Onboarding.md` |
| Seite „Prozesse“ mit Unterseiten | `Handbuch/Prozesse/Prozesse.md` |
| Unterseite „Urlaub“ von „Prozesse“ | `Handbuch/Prozesse/Urlaub.md` |
| Bilder und Dateien einer Seite | `Handbuch/_attachments/Onboarding/…` (Einstellung [Anhang-Ordner](settings.md#anhang-ordner)) |

Standardmäßig steht die Notiz eines Ordners als erste in diesem Ordner, und das Emoji einer Seite erscheint vor dem Titel in der Dateiliste und im Kopf der Notiz. Beides ändert nur die Anzeige, nicht die Dateien.

### Eigenschaften des Plugins

Jede synchronisierte Notiz hat einige Eigenschaften (Frontmatter), die das Plugin verwaltet:

| Eigenschaft | Angezeigt als | Bedeutung |
|---|---|---|
| `nc_page_id` | Seiten-ID | Die ID der Seite auf dem Server. Sie verbindet die Notiz mit ihrer Seite. |
| `nc_collective_id` | Collective-ID | Die ID des Collectives. |
| `nc_emoji` | Emoji | Das Emoji der Seite, falls sie eins hat. |
| `nc_title` | Seitentitel | Nur wenn sich der Seitentitel nicht unverändert als Dateiname nutzen lässt, zum Beispiel weil er `#`, `^`, `[` oder `]` enthält. Diese Zeichen werden im Dateinamen durch `_` ersetzt. |
| `tags` | (Obsidians Tags) | Die Tags der Seite. |

Die Eigenschaften `nc_…` sind standardmäßig ausgeblendet (Einstellung [Eigenschaften des Plugins ausblenden](settings.md#eigenschaften-des-plugins-ausblenden)). Ändere oder lösche `nc_page_id` nicht: Ohne sie hält das Plugin die Notiz für eine neue Seite und lädt sie erneut hoch.

Weitere Eigenschaften, die du selbst anlegst, werden als Teil des Seitentexts hochgeladen. Collectives zeigt sie als Text oben auf der Seite.

## Wie es weitergeht

- [Wann synchronisiert wird](sync.md): Ab jetzt synchronisiert das Plugin von selbst.
- [Struktur](structure.md): was passiert, wenn du Notizen und Ordner anlegst, umbenennst, verschiebst oder löschst.
- [Einstellungen](settings.md): alle Optionen.
