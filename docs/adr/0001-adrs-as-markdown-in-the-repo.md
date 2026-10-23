# 0001 – ADRs als Markdown im Repository

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: ONC-1

## Kontext

Architekturentscheidungen standen bisher verstreut in `PLAN.md` §15 und in Chat-Verläufen. Coding-Agents und Menschen brauchen eine feste, versionierte Stelle, an der sie Begründungen nachlesen können, bevor sie von einer Entscheidung abweichen.

## Entscheidung

Entscheidungen werden als Markdown-Dateien im Format [MADR](https://adr.github.io/madr/) (vereinfacht, deutsch) unter `docs/adr/NNNN-kurzname.md` abgelegt. Vorlage: `template.md`, Übersicht: `README.md`. Neue ADRs entstehen im selben PR wie die Umsetzung. Akzeptierte ADRs werden nicht umgeschrieben, sondern durch neue abgelöst.

## Betrachtete Alternativen

- **Docusaurus-Site** – eigene npm-Toolchain, Build und Hosting für ein Plugin-Repo; Docusaurus kann dieselben Markdown-Dateien später trotzdem rendern.
- **Nur `PLAN.md` §15** – keine Begründungen und Alternativen, wird unübersichtlich.

## Konsequenzen

- ADRs durchlaufen denselben Review wie der Code und sind für Agents direkt lesbar (`AGENTS.md` verweist darauf).
- Eine spätere Doku-Site bleibt möglich, ohne Dateien umzuziehen.
