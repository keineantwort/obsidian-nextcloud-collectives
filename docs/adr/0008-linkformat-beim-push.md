# 0008 – Link-Format beim Push: relativ mit `?fileId=`

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §9.1, §9.3, `docs/api-notes.md` §7, ONC-1

## Kontext

Collectives erkennt drei Link-Formen (relativ mit `?fileId=`, absolut, root-relativ). Der Link-Picker der Weboberfläche schreibt absolute URLs mit `/index.php/`. Lokal sollen Wikilinks stehen.

Manuelle Prüfung im Text-Editor (2026-10-16, Pretty-URLs aktiv):

| Form | Klick führt zur Seite |
|---|---|
| `Ziel.md?fileId=138` | ✔ |
| `http://host/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ neuer Tab, „Collective nicht gefunden“ |
| `/index.php/apps/collectives/Admins-Wiki-3/Ziel-138` | ✘ neuer Tab, „Collective nicht gefunden“ |
| `/apps/collectives/Admins-Wiki-3/Ziel-138` | ✔ |
| `Ziel.md` | ✔ |
| `Ziel.md?fileId=138#abschnitt-zwei` | ✔ (Anker nicht prüfbar) |

## Entscheidung

Push schreibt Seitenlinks als **relativen Pfad zur Quelldatei mit `?fileId={id}`** (Anker als `#slug` dahinter). Pull löst alle bekannten Formen auf (relativ, absolut, root-relativ, mit/ohne `index.php`, Collective als `{slug}-{id}` oder Name).

## Betrachtete Alternativen

- **Absolutes Picker-Format** – im Test nicht klickbar (Ursache offen: vermutlich `/index.php/` bei aktiven Pretty-URLs), außerdem serverabhängig.
- **Relativ ohne `fileId`** – klickbar, wird aber vom Server nicht als Seitenlink erkannt (keine Backlinks) und bricht bei Umbenennungen.

## Konsequenzen

- Links bleiben bei Umbenennen über die File-ID auflösbar; Backlinks in Collectives funktionieren.
- Rundlauf-Tests in M7 verwenden diese Form als kanonisches Remote-Format.
