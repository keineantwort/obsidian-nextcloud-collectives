# Nextcloud Collectives Sync (Obsidian-Plugin)

Obsidian-Plugin, das alle Collectives eines Nextcloud-Servers bidirektional mit einem Vault synchronisiert.

**Status:** in Entwicklung (M5: Struktur) – noch nicht einsatzbereit. Spezifikation und Meilensteine: [PLAN.md](PLAN.md). Hinweise für Coding-Agents: [AGENTS.md](AGENTS.md).

## Hilfe

### Emoji und Tags

Emoji (`nc_emoji`) und Tags (`nc_tags`) einer Seite stehen im Frontmatter der Notiz und werden in beide Richtungen abgeglichen: Änderst du sie in der Notiz, gehen sie beim nächsten Sync zum Server (fehlende Tags werden im Collective angelegt, ohne Beachtung der Groß-/Kleinschreibung gegen vorhandene geprüft). Änderst du sie auf dem Server und in der Notiz, verhält es sich wie bei einer Textänderung auf beiden Seiten: Je nach Einstellung „Konfliktstrategie“ entsteht eine Konfliktkopie (die Notiz bleibt wie sie ist, die Werte des Servers stehen in der Kopie) oder die lokale bzw. die Server-Fassung gewinnt. Standardmäßig sind die Tags Obsidians Eigenschaft `tags` (Leerzeichen werden zu `-`); auch `#Tags` im Text zählen und werden hinzugefügt (entfernst du ein `#Tag` aus dem Text, bleibt es bestehen, bis du es aus der Eigenschaft löschst). Diese Eigenschaft bleibt Teil des Seitentexts und erscheint daher auch in Collectives. Die Einstellung „Eigenschaft für Tags“ schaltet auf die Plugin-Eigenschaft `nc_tags` um. In der Eigenschaften-Ansicht heißen die Plugin-Eigenschaften „Seiten-ID“, „Emoji“ usw., und das Emoji einer Seite steht vor dem Titel in der Dateiliste und im Notiz-Kopf (abschaltbar); die Dateinamen ändern sich nicht.

### Struktur: neue, umbenannte, verschobene und gelöschte Seiten

Das Plugin gleicht auch die Struktur ab, nicht nur den Text. Jedes Collective ist ein Ordner auf oberster Ebene des Vaults. Eine Seite mit Unterseiten ist ein Ordner mit einer gleichnamigen Notiz darin (`Handbuch/Prozesse/Prozesse.md`).

| Du machst im Vault … | … das passiert auf dem Server |
|---|---|
| eine neue Notiz anlegen | Sie wird als neue Seite hochgeladen, ihre `nc_page_id` steht danach im Frontmatter. Die Seite hängt unter der Seite, der ihr Ordner gehört; liegt sie in einem Ordner ohne Notiz, legt das Plugin dafür eine Ordnerseite an. |
| eine Notiz umbenennen oder in einen anderen Ordner verschieben | Die Seite wird umbenannt bzw. verschoben, auch in ein anderes Collective (ID und Emoji bleiben; die Tags der Notiz werden im neuen Collective neu zugewiesen). |
| den Ordner einer Seite mit Unterseiten umbenennen, oder nur die Notiz darin | Die Seite heißt danach wie der Ordner bzw. die Notiz; Ordner und Notiz bekommen denselben Namen. |
| einen neuen Ordner auf oberster Ebene mit Notizen anlegen | Ein neues Collective entsteht (einstellbar: „Neue Ordner auf oberster Ebene“). Die Notiz, die wie der Ordner heißt, wird die Startseite. |
| den Ordner eines Collectives umbenennen | Das Collective wird umbenannt. Das dürfen nur Admins und Eigentümer; sonst wird der Ordner zurückbenannt. |
| eine Notiz oder einen Ordner löschen | Das Plugin **fragt**, bevor eine Seite oder ein Collective auf dem Server in den Collectives-Papierkorb kommt (dort lässt sich beides wiederherstellen). Im Dialog ist nichts vorausgewählt: Was du anhakst, wird gelöscht; was du nicht anhakst, kommt in den Vault zurück. Schließt du den Dialog (Esc), passiert nichts, und beim nächsten Lauf wird erneut gefragt. Eine Seite mit Unterseiten wird samt Unterseiten gelöscht. |

In der anderen Richtung gilt:

- Eine auf dem Server umbenannte oder verschobene Seite wird im Vault umbenannt bzw. verschoben. Haben beide Seiten dieselbe Seite verschieden verschoben, gilt der Server.
- Eine auf dem Server gelöschte Seite kommt im Vault in den Papierkorb (Einstellung „Auf dem Server gelöschte Seiten“; „Datei behalten“ lädt sie als neue Seite wieder hoch). Hast du die Datei seit der letzten Synchronisierung geändert, wird sie **nie** entfernt: Die Seite wird aus dem Papierkorb wiederhergestellt und deine Änderung hochgeladen.
- Hat sich eine Seite auf dem Server geändert, während du sie im Vault gelöscht hast, kommt sie ohne Rückfrage zurück: die Änderung gewinnt.
- Legst du eine gelöschte Datei (mit ihrer `nc_page_id`) wieder in den Vault, wird die Seite aus dem Collectives-Papierkorb wiederhergestellt.
- Ein auf dem Server gelöschtes Collective (oder eins, das du verlassen hast) wird nur nach Rückfrage aus dem Vault entfernt.
- **Schutz vor Massenlöschung:** Würdest du mindestens 3 Seiten und mehr als 20 % der Seiten eines Collectives auf einmal löschen, fragt das Plugin immer, auch mit der Einstellung „Ohne Rückfrage in den Collectives-Papierkorb“.
- Markdown-Dateien direkt im Vault-Ordner (ohne Collective-Ordner) und Dateien in versteckten Ordnern werden nicht synchronisiert.

### Konflikte

Ein Konflikt entsteht, wenn eine Seite seit der letzten Synchronisierung sowohl im Vault als auch auf dem Server geändert wurde. Das Plugin überschreibt dann nichts:

- Deine Datei bleibt unverändert.
- Die Server-Fassung wird daneben als `Titel (Konflikt JJJJ-MM-TT HHmm).md` abgelegt. Diese Kopie wird nicht synchronisiert.
- Die Seite wird erst wieder hochgeladen, wenn du den Konflikt aufgelöst hast.

Eine **Kollision** ist ein Sonderfall beim ersten Abgleich: Am Zielpfad einer Server-Seite lag schon eine Datei aus deinem Vault. Auch hier bleibt deine Datei erhalten, und die Server-Seite landet als Konfliktkopie daneben.

Offene Konflikte zeigt die Statusleiste als `NC ⚠︎ n` (nur Desktop). Der Befehl **„Konflikte anzeigen“** öffnet den Dialog, auf Mobile ist er der einzige Weg. Der Dialog zeigt pro Seite die Unterschiede zwischen deiner Datei und der Server-Fassung:

| Auswahl | Wirkung |
|---|---|
| **Lokal behalten** | Deine Datei wird hochgeladen und ersetzt die Server-Fassung. Hat sich die Server-Fassung inzwischen erneut geändert, entsteht ein neuer Konflikt statt eines Überschreibens. Bei einer Kollision wird deine Datei dabei mit der Server-Seite verknüpft. |
| **Remote übernehmen** | Der Inhalt deiner Datei wird durch die Server-Fassung ersetzt. Die Server-Fassung wird dafür neu geladen, die Konfliktkopie muss also nicht mehr vorhanden sein. |
| **Später** | Alles bleibt, wie es ist. |

Nach „Lokal behalten“ oder „Remote übernehmen“ wird die Konfliktkopie in den Papierkorb verschoben, wie in Obsidian eingestellt. Danach läuft sofort eine Synchronisierung.

**Einstellung „Konflikte“** (Abschnitt „Verhalten“):

- **Beide behalten (Konfliktkopie)**: Standard, wie oben beschrieben.
- **Diesen Vault bevorzugen**: Bei beidseitiger Änderung wird die Server-Fassung ohne Rückfrage überschrieben.
- **Server bevorzugen**: Bei beidseitiger Änderung wird deine Datei ohne Rückfrage überschrieben.

Mit den beiden „bevorzugen“-Optionen gehen die Änderungen der jeweils anderen Seite verloren. Bereits bestehende Konflikte brauchen weiterhin deine Entscheidung.

Gleichzeitige Bearbeitung im Browser: Lädt das Plugin eine Seite hoch, während sie im Browser offen ist, meldet der Editor „Die Bearbeitungssitzung ist abgelaufen“. Lade die Seite dann neu. Was du danach im Browser noch eingibst, wird nicht mehr gespeichert ([ADR 0012](docs/adr/0012-gleichzeitige-bearbeitung-im-browser.md)).

Lizenz: [MIT](LICENSE)
