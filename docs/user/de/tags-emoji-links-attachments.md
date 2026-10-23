[English](../en/tags-emoji-links-attachments.md) | **Deutsch**

# Emoji, Tags, Links und Anhänge

[Handbuch](README.md) › Emoji, Tags, Links und Anhänge

## Emoji und Tags

Emoji (`nc_emoji`) und Tags (Obsidians Eigenschaft `tags`) einer Seite stehen in den Eigenschaften der Notiz und werden in beide Richtungen abgeglichen.

- Änderst du sie in der Notiz, gehen sie beim nächsten Sync zum Server. Tags, die das Collective noch nicht hat, werden dort angelegt; vorhandene werden ohne Beachtung der Groß-/Kleinschreibung zugeordnet.
- Wurden sie auf dem Server und in der Notiz geändert, entscheidet die Einstellung [Konflikte](settings.md#konflikte), wie bei einer Textänderung: eine Konfliktkopie (die Notiz bleibt wie sie ist, die Werte des Servers stehen in der Kopie), oder die Fassung dieses Vaults bzw. des Servers gewinnt.

### Emoji setzen

Am einfachsten geht es mit dem Befehl **Seiten-Emoji setzen** oder mit **Seiten-Emoji setzen …** im Kontextmenü einer Notiz oder eines Ordners (und im Editor-Menü). Der Dialog **Emoji der Seite** bietet Emoji in Gruppen und ein Feld „Emoji (genau eins)“. Wähle **Übernehmen**, oder **Emoji entfernen**, um es wegzunehmen. Das Emoji wird in der Notiz gespeichert und mit dem nächsten Sync gesendet.

Legst du in der Notiz, die du gerade bearbeitest, eine leere Eigenschaft `Emoji` an, öffnet sich derselbe Dialog.

Erlaubt ist genau ein Emoji. Anderes (Text, mehrere Emoji) wird nicht gesendet, und der Sync meldet: „Eine Notiz hat ein Emoji-Feld, das kein einzelnes Emoji ist: Es wurde nicht gesendet.“

In der Dateiliste zeigt ein Ordner das Emoji seiner Seite, und vor dem Titel einer Notiz steht ihr Emoji (Einstellung [Seiten-Emoji in Titeln anzeigen](settings.md#seiten-emoji-in-titeln-anzeigen)). Das ändert nur die Anzeige, nicht den Dateinamen.

### Tags

- Die Tags sind Obsidians Eigenschaft `tags`. Auch `#Tags` im Text zählen und werden der Eigenschaft hinzugefügt. Entfernst du ein `#Tag` aus dem Text, bleibt es bestehen, bis du es aus der Eigenschaft löschst.
- Ein Leerzeichen im Tag-Namen auf dem Server erscheint in Obsidian als `-`, weil Tags in Obsidian keine Leerzeichen haben können. Ein `-` bleibt ein `-`, auch wenn du es in Obsidian neu tippst.
- Die Tags erscheinen in Collectives als Tags, nicht als Text in der Seite.
- Verschiebst du eine Notiz in ein anderes Collective, werden ihre Tags dort neu zugewiesen.

Die eigenen Eigenschaften des Plugins (`nc_…`) sind standardmäßig ausgeblendet; siehe [Eigenschaften des Plugins ausblenden](settings.md#eigenschaften-des-plugins-ausblenden). Die Eigenschaft `tags` bleibt sichtbar.

## Links

Links zwischen Seiten werden in beide Richtungen umgewandelt:

| Im Vault | Auf dem Server |
|---|---|
| `[[Seite]]`, `[[Seite\|Text]]`, `[[Seite#Überschrift]]` auf eine synchronisierte Seite | Ein Collectives-Link auf die Seite, dem der Collectives-Editor folgen kann |
| Markdown-Link auf eine Notiz, etwa `[Text](Seite.md)` | Dasselbe; er kommt als Wikilink zurück |

Links, die auf dem Server entstanden sind (mit der Linkauswahl von Collectives oder von Hand), werden im Vault zu Wikilinks wie `[[Handbuch/Prozesse/Urlaub|Text]]`. Der Text nach `|` steht nur da, wenn er vom Seitentitel abweicht.

Gut zu wissen:

- Links auf Seiten in einem anderen Collective funktionieren auch, solange sie auf denselben Server zeigen.
- Anker (`#ueberschrift`) werden unverändert übernommen. Ein Link auf eine Überschrift mit Leer- oder Sonderzeichen springt in Obsidian oder Collectives unter Umständen nicht genau dorthin; der Link zur Seite funktioniert trotzdem.
- Links, die sich nicht auflösen lassen (externe Links, Seiten ohne Zugriff, Dateien außerhalb der Collectives), bleiben, wie sie sind. Ein Wikilink auf eine Notiz außerhalb der synchronisierten Ordner bleibt im Seitentext als `[[…]]` stehen.
- Code-Blöcke, Inline-Code und die Eigenschaften werden nie verändert.
- Ein Wikilink auf eine Seite, die erst in derselben Synchronisierung entsteht, wird bei der nächsten Synchronisierung umgewandelt.
- Wird eine verlinkte Seite umbenannt, ändert sich auch der Linktext in den Seiten, die auf sie verweisen. Das kann ein zusätzliches Hochladen dieser Seiten auslösen.

## Anhänge

Bilder und andere Dateien, die eine Notiz einbettet (`![[foto.png]]` oder `![](foto.png)`), werden mit der Seite abgeglichen.

### Vom Server in den Vault

Anhänge einer Seite werden in einen Ordner neben der Notiz heruntergeladen, standardmäßig `_attachments/<Name der Notiz>/` (Einstellung [Anhang-Ordner](settings.md#anhang-ordner)). Für `Handbuch/Onboarding.md` ist das `Handbuch/_attachments/Onboarding/`. Die Einbettung in der Notiz zeigt dorthin.

### Vom Vault zum Server

Dateien, die du in eine Notiz einbettest, werden als Anhänge der Seite hochgeladen. Sie bleiben im Vault, wo sie sind; das Plugin verschiebt sie nicht. Hochgeladen werden nur:

- Dateien im Ordner desselben Collectives und
- Dateien direkt im Vault-Ordner (dorthin legt Obsidian eingefügte Bilder standardmäßig).

Nutzt du in Obsidian einen anderen Anhang-Ordner („Einstellungen › Dateien und Links › Standardspeicherort für neue Anhänge“), wähle einen innerhalb des Collectives, zum Beispiel „Im selben Ordner wie die aktuelle Datei“ oder einen Unterordner.

Eine neue Notiz mit Bild geht zuerst mit der Einbettung, wie sie ist, zum Server; die Datei wird bei der nächsten Synchronisierung hochgeladen und der Link umgewandelt.

### Größenlimit

Dateien über [Größter Anhang (MB)](settings.md#größter-anhang-mb) (Standard 20 MB) werden weder hoch- noch heruntergeladen. Die Einbettung einer zu großen Datei bleibt im Seitentext als `![[…]]` stehen.

### Änderungen und Löschen

- Ändert sich ein Anhang auf dem Server und hast du ihn im Vault nicht geändert, wird die Datei im Vault ersetzt. Hast du ihn geändert, bleibt deine Datei, und die Datei des Servers wird als Konfliktkopie daneben gelegt.
- Änderst du einen vorhandenen Anhang im Vault, wird die Änderung **nicht** hochgeladen.
- Wird ein Anhang auf dem Server gelöscht, kommt die Datei im Vault in den Papierkorb, aber nur, wenn du sie nicht geändert hast, und nicht, wenn [Auf dem Server gelöschte Seiten](settings.md#auf-dem-server-gelöschte-seiten) auf „Datei behalten“ steht.
- Löschst du einen Anhang im Vault und keine Notiz bettet ihn mehr ein, kommt er auch auf dem Server in den Collectives-Papierkorb (Einstellung [Anhänge auf dem Server löschen](settings.md#anhänge-auf-dem-server-löschen), Standard an). Bettet die Notiz ihn noch ein, wird er erneut heruntergeladen.
- Anhänge wandern nicht mit, wenn du eine Notiz umbenennst oder verschiebst. Die Einbettung funktioniert weiter.

### Grenzen

- Ist dieselbe Datei in mehreren Seiten eingebettet, wird sie für jede Seite einmal hochgeladen.
- Heißen zwei eingebettete Dateien einer Seite gleich (in verschiedenen Ordnern), wird nur eine hochgeladen.
- Einfache Links auf Anhänge, die keine Einbettungen sind (etwa `[Bericht](.attachments.123/bericht.pdf)` auf dem Server), werden weder umgewandelt noch heruntergeladen.
- Dateien, deren Name `[ ] | # ^` enthält, werden heruntergeladen, aber nicht als Wikilink eingebettet.
