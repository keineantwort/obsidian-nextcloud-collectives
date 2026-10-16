# 0003 – Ein Server pro Vault, alle Collectives bilden den Vault

- Status: akzeptiert
- Datum: 2026-10-15
- Bezug: PLAN.md §2, §6.1, §15 #4

## Kontext

Ein Nutzer kann Mitglied vieler Collectives sein, ggf. auf mehreren Servern. Teilauswahl und Mehrserverbetrieb vervielfachen die Zustände (Pfadpräfixe, Credentials, Kollisionen).

## Entscheidung

Ein Vault ist an genau einen Nextcloud-Server gebunden. Der Vault-Root ist der Sync-Root; jedes Collective, auf das der Nutzer Zugriff hat, ist ein Ordner auf oberster Ebene. Keine Teilauswahl. Ein Serverwechsel ist nicht vorgesehen (Hinweis: neuen Vault anlegen).

## Betrachtete Alternativen

- **Unterordner als Sync-Root** – mischt gesyncte und lokale Notizen, mehr Sonderfälle bei Links.
- **Mehrere Server** – eigene Credentials und Namensräume je Server, deutlich mehr Komplexität.
- **Teilauswahl von Collectives** – Lösch- vs. Abwahl-Semantik wäre mehrdeutig.

## Konsequenzen

- Einfaches, eindeutiges Pfad-Mapping.
- Dateien direkt im Vault-Root werden ignoriert (Hinweis im Log).
- Neue lokale Ordner auf oberster Ebene werden zu Collectives (Setting `newFolderBehaviour`).
