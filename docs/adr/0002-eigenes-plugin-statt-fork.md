# 0002 – Eigenes Plugin statt Fork von Nextcloud Sync

- Status: akzeptiert
- Datum: 2026-10-15
- Bezug: PLAN.md §15 #7, §18

## Kontext

Es gibt kein Obsidian-Plugin für Nextcloud Collectives. Das Plugin „Nextcloud Sync“ (siosig/obsidian-nextcloudsync, MIT) synchronisiert beliebige Nextcloud-Ordner per WebDAV und ist ausgereift.

## Entscheidung

Wir schreiben ein eigenes Plugin. Bestehende Plugins dienen nur als Referenz; einzelne Muster oder Codeteile werden mit Lizenz- und Quellenangabe übernommen (gesichtete Commits: `docs/api-notes.md` §11).

## Betrachtete Alternativen

- **Nextcloud Sync direkt auf `.Collectives/` richten** – keine Emojis, Tags, Link-Umwandlung, Collective-Anlage; `Readme.md`-Struktur bleibt sichtbar.
- **Nextcloud Sync forken** – große fremde Codebasis (Diff3-Merge, Chunked Upload, Config-Sync …), Upstream nimmt kaum PRs an, dauerhafte Fork-Pflege. Außerdem schreibt es über den `DataAdapter` statt über die Vault-API (widerspricht AGENTS Regel 2).

## Konsequenzen

- Volle Kontrolle über das Collectives-spezifische Mapping.
- Bewährte Lösungen (Login Flow v2 mit Resume-Wake, Massenlösch-Schutz, PROPFIND-Parser) müssen bewusst nachgebaut werden.
