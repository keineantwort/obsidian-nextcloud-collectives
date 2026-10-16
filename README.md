# Nextcloud Collectives Sync (Obsidian-Plugin)

Obsidian-Plugin, das alle Collectives eines Nextcloud-Servers bidirektional mit einem Vault synchronisiert.

**Status:** in Entwicklung – noch nicht einsatzbereit. Spezifikation und Meilensteine: [PLAN.md](PLAN.md). Hinweise für Coding-Agents: [AGENTS.md](AGENTS.md).

## Hilfe

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
