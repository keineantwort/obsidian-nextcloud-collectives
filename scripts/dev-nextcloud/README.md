# Lokaler Nextcloud-Testserver

Nextcloud + Collectives + Circles in einem Container (SQLite), nur auf `127.0.0.1` erreichbar. Ausschließlich für Entwicklung und Integrationstests, nie mit echten Daten.

```bash
./up.sh              # startet und wartet auf "healthy"; legt .env aus .env.example an
./down.sh            # stoppt, Daten bleiben erhalten
./down.sh --reset    # stoppt und löscht alle Daten (nächster Start = frische Installation)
```

- Weboberfläche: http://localhost:8080 (Admin bzw. Testnutzer `alice`, Passwörter in `.env`)
- Version über `NC_VERSION` in `.env` wählbar (Default 33)
- `hooks/10-collectives.sh` läuft einmalig nach der Installation: Apps aktivieren, Testnutzer anlegen
- App-Passwörter erzeugen Skripte bei Bedarf selbst per `occ user:auth-tokens:add`

Ab M1 als `npm run nc:up` / `npm run nc:down` verfügbar.
