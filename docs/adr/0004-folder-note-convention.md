# 0004 – Folder-Note-Konvention statt `Readme.md`

- Status: akzeptiert
- Datum: 2026-10-15
- Bezug: PLAN.md §6.1

## Kontext

Collectives speichert Startseiten und Elternseiten als `Readme.md`. In Obsidian sind viele gleichnamige `Readme.md` im Quick Switcher, in Wikilinks und in Tabs unbrauchbar.

## Entscheidung

Lokal heißt die Datei einer Elternseite wie ihr Ordner (`Prozesse/Prozesse.md`), die Startseite wie das Collective (`Handbuch/Handbuch.md`). Das Mapping in `src/mapping/paths.ts` übersetzt in beide Richtungen.

## Betrachtete Alternativen

- **`Readme.md` beibehalten** – 1:1-Abbild, aber in Obsidian schlecht bedienbar.
- **Elternseite als Datei neben dem Ordner** (`Prozesse.md` + `Prozesse/`) – verbreitet, aber Verschieben in Obsidian trennt Datei und Ordner leicht.

## Konsequenzen

- M0: Elternseiten bleiben auf dem Server Ordner, auch ohne Unterseiten; lokal ist das eine Folder-Note ohne Geschwister.
- Wird lokal eine Unterseite unter einer Blattseite angelegt, muss die Blattseite in den neuen Ordner wandern (Collectives macht `Titel.md` → `Titel/Readme.md`, File-ID bleibt).
