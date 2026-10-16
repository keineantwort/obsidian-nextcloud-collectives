# 0006 – Lokaler Docker-Testserver für Verifikation und Integrationstests

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §13, §15 #8, AGENTS Regel 6, ONC-1

## Kontext

M0 muss echtes Server-Verhalten klären (Link-Format, 412, File-IDs), und ab M4 sind Integrationstests Pflicht. Tests gegen produktive Server sind ausgeschlossen.

## Entscheidung

`scripts/dev-nextcloud/`: ein einzelner Container `nextcloud:<NC_VERSION>-apache` mit SQLite, Post-Install-Hook installiert Collectives und Circles und legt den Testnutzer an. Nur auf `127.0.0.1` gebunden, Wegwerf-Credentials in `.env` (gitignored). Unit-Tests laufen ohne Server gegen die M0-Fixtures.

## Betrachtete Alternativen

- **Mocks/Fake-Server** – würden nur unsere Annahmen wiederholen.
- **Nicht-produktive Nextcloud im HomeLab** – keine lokale Last, aber nicht reproduzierbar zurücksetzbar; offen als Option für CI.
- **Voller Stack (Postgres, Redis, TLS)** wie bei Nextcloud Sync – für den Anfang unnötig.

## Konsequenzen

- ca. 1,2 GB Image, Container nur bei Bedarf aktiv; `down.sh --reset` liefert frischen Zustand.
- SQLite verhält sich bei String-Vergleichen anders als MySQL (z. B. case-sensitive Tag-Namen) – Code darf sich darauf nicht verlassen.
- Offen (PLAN §15 #8): Remote-Testserver, damit Forgejo Actions `test:int` ausführen können; Entscheidung vor M4.
