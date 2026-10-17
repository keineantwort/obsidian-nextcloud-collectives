# 0020 – Links: Seitenindex, Anker unverändert, Hash im Remote-Format

- Status: akzeptiert
- Datum: 2026-10-17
- Bezug: PLAN.md §9.1–9.3, ADR 0008, Issue ONC-8

## Kontext

M7 wandelt Seitenlinks zwischen Collectives (`[Text](Pfad.md?fileId=…)` u. a.) und Obsidian-Wikilinks. Die Umwandlung braucht Wissen über alle Seiten (Titel, Pfade, Slugs). Der Hash (`baseHash`, lokaler Hash) muss unabhängig von der Linkschreibweise sein, sonst entstehen Scheinänderungen. Überschriften-Anker der Zielseite sind im Plan als Slug → Überschrift vorgesehen, die Slug-Regel des Servers ist aber nicht verifiziert und die Zieltexte liegen beim Pull nicht vor.

## Entscheidung

- `src/mapping/links.ts` (rein) wandelt in beide Richtungen auf Basis eines `LinkIndex`. Der Index wird pro Durchlauf aus Remote-Liste, lokalem Scan und Pfadplan gebaut (`src/sync/linkIndex.ts`) und über `ExecutorDeps.links` weitergegeben.
- Kanonisches Remote-Format: relativ mit `?fileId=` (ADR 0008); in eine andere Collective als `/apps/collectives/{slug}-{cId}/{pageSlug}-{id}`. Kanonisches lokales Format: `[[Vault/Pfad/Seite|Text]]` (Alias nur, wenn Text ≠ Titel).
- `toRemote` und `canonicalRemote` nehmen optional einen `LinkContext`; alle Hashes (lokal wie remote) laufen über das Remote-Format mit Kontext. So sind alle drei Server-Schreibweisen und eine umbenannte Zielseite hash-gleich.
- Anker werden **unverändert** übernommen (URL-kodiert im Remote-Format), keine Slug↔Überschrift-Abbildung.
- Konfliktkopien enthalten Wikilinks; „Remote übernehmen“ wandelt sie über `toRemote` zurück. Der Konflikt-Dialog nutzt den Index des letzten Durchlaufs.
- Code-Blöcke, Inline-Code, Frontmatter, Embeds (`![[…]]`, `![](…)`) werden nicht angefasst. Nicht auflösbare Links bleiben stehen. Markdown-Links auf Notizen werden wie Wikilinks nach Remote gewandelt und kommen als Wikilink zurück.

## Betrachtete Alternativen

- **Slug → Überschrift über die Zielseite** – braucht den Text jeder Zielseite und eine verifizierte Slug-Regel; später nachrüstbar.
- **Hash über den lokalen Text** – würde bei jeder Umbenennung einer Zielseite alle verlinkenden Seiten als geändert melden.

## Konsequenzen

- Anker auf Überschriften mit Umlauten/Leerzeichen springen in Obsidian oder Collectives ggf. nicht exakt; der Link zur Seite funktioniert.
- Wikilinks auf Seiten, die in diesem Lauf erst entstehen, werden erst im Folgelauf gewandelt (der Hash zieht dann nach, ein Push folgt).
- Index entsteht zu Laufbeginn; Verschiebungen innerhalb desselben Laufs wirken erst im nächsten.
