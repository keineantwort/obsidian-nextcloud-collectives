# Nextcloud Collectives Sync (Obsidian-Plugin)

Obsidian-Plugin, das alle Collectives eines Nextcloud-Servers bidirektional mit einem Vault synchronisiert.

**Status:** Vorab-Version 0.2.0, noch nicht im Community-Store. Funktionsumfang und Meilensteine: [PLAN.md](PLAN.md). Hinweise für Coding-Agents: [AGENTS.md](AGENTS.md).

## Voraussetzungen

- Obsidian ab 1.11.4 (Desktop, iOS und Android).
- Ein Nextcloud-Server mit der App **Collectives**. Getestet mit Nextcloud 33, 34 und 35 (jeweils mit der dazu passenden Collectives-Version, zuletzt 4.7.1). Welche Versionen genau gelaufen sind, steht im Protokoll des wöchentlichen Integrationslaufs. Bei einer anderen Nextcloud-Hauptversion zeigt das Plugin einmal eine Warnung und synchronisiert trotzdem.
- Ein Nextcloud-Konto; das Plugin meldet sich per Login Flow oder mit einem App-Passwort an (kein Hauptpasswort).

## Installation

Das Plugin ist noch nicht im Community-Store. Zwei Wege:

1. **BRAT** (Plugin „Obsidian42 – BRAT“): „Add beta plugin“ mit dem Repository-Link des Plugins. BRAT lädt `main.js`, `manifest.json` und `styles.css` aus dem neuesten Release und aktualisiert sie später. BRAT liest nur GitHub-Repositories; liegt das Release woanders, nimm den zweiten Weg.
2. **Von Hand**: Lade `main.js`, `manifest.json` und `styles.css` aus dem neuesten Release herunter, lege sie in `<Vault>/.obsidian/plugins/nextcloud-collectives/` und aktiviere das Plugin unter „Community plugins“. Auf dem Handy ist der Ordner `.obsidian` versteckt: Bereite den Vault am besten am Desktop vor.

Danach in den Einstellungen die Server-URL eintragen und „Anmelden“ wählen. Die Release-Dateien baust du selbst mit `npm ci && npm run build` (erzeugt `main.js` im Projektordner).

## Risiken und Backup

Das Plugin schreibt in beide Richtungen: in deinen Vault **und** auf deinen Nextcloud-Server. Fehler können Seiten verändern, verschieben oder in den Papierkorb legen.

- **Mache vor der ersten Synchronisierung eine Sicherung** des Vault-Ordners (und bei wichtigen Collectives eine Sicherung auf dem Server). Lege für die erste Synchronisierung am besten einen neuen, leeren Vault an.
- Das Plugin überschreibt nichts still: Bei Konflikten bleibt deine Datei erhalten, gelöscht wird nur nach Rückfrage und nur in die Papierkörbe (Collectives bzw. Obsidian), siehe unten.
- **Gleichzeitiges Bearbeiten im Browser** und in Obsidian kann Eingaben im Browser verlieren (Abschnitt „Konflikte“).
- Ein Vault gehört zu **einem** Server und **einem** Konto. Ein anderes Konto braucht einen neuen Vault.
- Die Collectives-Schnittstelle ist nicht offiziell stabil. Antwortet der Server unerwartet, stoppt das Plugin mit einer Meldung, statt zu raten.
- Das App-Passwort liegt im Secret Storage von Obsidian, nicht in den Plugin-Einstellungen und nie im Protokoll.

## Hilfe bei Problemen

Der Befehl **„Protokoll anzeigen“** (auch in den Einstellungen unter „Diagnose“) zeigt, was das Plugin in dieser Sitzung getan hat, und kopiert es. Mit der Einstellung „Ausführliches Protokoll“ steht zusätzlich jede Anfrage an den Server darin (Methode, Pfad, Status, Dauer; nie Passwörter oder Inhalte). Hänge das Protokoll an eine Fehlermeldung. Es liegt nur im Speicher und ist nach einem Neustart weg.

## Hilfe

### Anmeldung und automatische Synchronisierung

In den Einstellungen meldest du dich entweder mit „Anmelden“ im Browser an (Nextcloud Login Flow: Benutzername und App-Passwort werden danach automatisch eingetragen, das App-Passwort liegt im Secret Storage von Obsidian) oder trägst ein App-Passwort von Hand ein. Danach synchronisiert das Plugin von selbst: kurz nach dem Start, im eingestellten Intervall (Standard 5 Minuten, 0 = aus), einige Sekunden nachdem du eine Notiz zuletzt geändert hast und wenn Obsidian auf dem Handy wieder in den Vordergrund kommt. Automatische Läufe sind still und öffnen keine Dialoge: Rückfragen (z. B. beim Löschen) werden zurückgestellt, ein Hinweis erinnert dich daran, „Jetzt synchronisieren“ auszuführen. Weist der Server das Passwort ab, pausieren die automatischen Läufe, bis du dich neu anmeldest. Die Erstsynchronisierung eines Vaults mit Inhalt startest du immer selbst. Eine Checkliste für Tests auf dem Handy steht in [docs/manual-test.md](docs/manual-test.md).

### Emoji und Tags

Emoji (`nc_emoji`) und Tags (Obsidians Eigenschaft `tags`) einer Seite stehen im Frontmatter der Notiz und werden in beide Richtungen abgeglichen: Änderst du sie in der Notiz, gehen sie beim nächsten Sync zum Server (fehlende Tags werden im Collective angelegt, ohne Beachtung der Groß-/Kleinschreibung gegen vorhandene geprüft). Änderst du sie auf dem Server und in der Notiz, verhält es sich wie bei einer Textänderung auf beiden Seiten: Je nach Einstellung „Konfliktstrategie“ entsteht eine Konfliktkopie (die Notiz bleibt wie sie ist, die Werte des Servers stehen in der Kopie) oder die lokale bzw. die Server-Fassung gewinnt. Die Eigenschaften des Plugins (`nc_…`) sind standardmäßig ausgeblendet (Einstellung „Eigenschaften des Plugins ausblenden“). Im Kontextmenü einer Notiz oder eines Ordners (und im Editor-Menü) findest du „Seiten-Emoji setzen“ und „Seite umbenennen“; letzteres benennt bei einer Seite mit Unterseiten die Notiz und ihren Ordner zusammen um. Das Emoji setzt du am einfachsten mit dem Befehl „Seiten-Emoji setzen“ (Auswahl und Prüfung); legst du in der Notiz selbst eine Eigenschaft `Emoji` an, öffnet sich dieselbe Auswahl. Erlaubt ist genau ein Emoji, anderes wird nicht gesendet und beim Sync gemeldet. Die Tags sind Obsidians Eigenschaft `tags`; auch `#Tags` im Text zählen und werden hinzugefügt (entfernst du ein `#Tag` aus dem Text, bleibt es bestehen, bis du es aus der Eigenschaft löschst). Ein Leerzeichen im Tag-Namen auf dem Server erscheint in Obsidian als `-`; ein `-` bleibt ein `-`, auch wenn du es in Obsidian neu tippst. Die Tags erscheinen in Collectives als Tags, nicht als Text. In der Dateiliste zeigt ein Ordner das Emoji seiner Seite, und die Seite des Ordners steht zuerst im Ordner (nur die Anzeige, abschaltbar).

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
