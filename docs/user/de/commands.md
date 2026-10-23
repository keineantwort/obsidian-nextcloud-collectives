[English](../en/commands.md) | **Deutsch**

# Befehle und Menüs

[Handbuch](README.md) › Befehle und Menüs

## Befehle

Öffne die Befehlspalette (Strg/Cmd+P) und tippe „Nextcloud Collectives Sync“. Unter „Einstellungen › Tastenkürzel“ kannst du jedem Befehl ein Tastenkürzel geben.

| Befehl | Was er tut |
|---|---|
| **Jetzt synchronisieren** | Synchronisiert sofort alle Collectives. Zeigt Fortschritt und Zusammenfassung und stellt offene Rückfragen (Löschen, neue Collectives, die erste Synchronisierung eines Vaults mit Inhalt). Siehe [Wann synchronisiert wird](sync.md#läufe-von-hand). |
| **Konflikte anzeigen** | Öffnet den Konflikt-Dialog. Gibt es keinen Konflikt: „Es gibt keine offenen Konflikte.“ Siehe [Konflikte](conflicts.md#der-konflikt-dialog). |
| **Seiten-Emoji setzen** | Öffnet den Emoji-Dialog für die geöffnete Notiz. Ohne geöffnete Notiz: „Öffne zuerst eine Notiz.“ Siehe [Emoji und Tags](tags-emoji-links-attachments.md#emoji-setzen). |
| **Seite umbenennen** | Benennt die Seite der geöffneten Notiz um. Bei einer Seite mit Unterseiten werden Notiz und Ordner zusammen umbenannt. |
| **Protokoll anzeigen** | Zeigt das Protokoll dieser Sitzung. Siehe [Hilfe bei Problemen](troubleshooting.md#das-protokoll). |

### Seite umbenennen

Der Dialog **Seite umbenennen** hat ein Feld „Neuer Name“. Ist der Name leer oder gibt es schon eine Notiz oder einen Ordner mit diesem Namen, sagt er das und benennt nicht um. Nach **Umbenennen** siehst du „Seite umbenannt. Die Änderung wird mit dem nächsten Sync gesendet.“

Notizen, die keine synchronisierten Seiten sind, und die Startseite eines Collectives lassen sich so nicht umbenennen. Versuchst du es, siehst du „Das ist keine Notiz einer synchronisierten Seite, oder es ist die Startseite eines Collectives (benenne stattdessen den Ordner um).“ Ein Collective benennst du um, indem du seinen Ordner auf oberster Ebene umbenennst; siehe [Struktur](structure.md).

Du kannst Notizen und Ordner auch wie gewohnt in Obsidian umbenennen. Das Plugin bemerkt es bei der nächsten Synchronisierung. Der Befehl erspart dir nur, Notiz und Ordner getrennt umzubenennen.

## Symbol in der Seitenleiste

Das Symbol **Mit Nextcloud Collectives synchronisieren** (zwei kreisförmige Pfeile) in der Seitenleiste (Ribbon) tut dasselbe wie **Jetzt synchronisieren**. Auf dem Handy findest du es im Menü der Seitenleiste.

## Kontextmenüs

Rechtsklick (auf dem Handy langes Tippen) auf eine synchronisierte Notiz oder den Ordner einer Seite in der Dateiliste:

- **Seiten-Emoji setzen …**: wie der Befehl **Seiten-Emoji setzen**, für diese Seite.
- **Seite umbenennen …**: wie der Befehl **Seite umbenennen**, für diese Seite. Fehlt bei der Startseite eines Collectives.

Dieselben Einträge stehen im Editor-Menü einer synchronisierten Notiz (das Menü „…“ oder Rechtsklick in den Text).

## Statusleiste

Am Desktop zeigt die Statusleiste `NC` mit dem Stand der Synchronisierung, zum Beispiel `NC ✓ 14:05`. Ein Klick synchronisiert sofort oder öffnet den Konflikt-Dialog, wenn es offene Konflikte gibt. Was die einzelnen Zustände bedeuten, steht in [Wann synchronisiert wird](sync.md#statusleiste). Auf dem Handy gibt es keine Statusleiste.
