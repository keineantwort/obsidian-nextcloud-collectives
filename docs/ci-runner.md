# Runner für die Forgejo-Actions-Workflows

Für die Workflows in `.forgejo/workflows/` dieses Repos. Stand: Rückmeldung des HomeLab-Projekts (2026-10-20); die Anforderungen unten sind damit erfüllt.

## Welcher Workflow läuft wo

| Workflow | Auslöser | `runs-on` | Braucht |
|---|---|---|---|
| `ci.yml` | jeder PR, Push auf `main` | `ubuntu-latest` | Job-Container `node:24-bookworm`, Cache-Server des Runners (siehe unten); ca. 1–2 Minuten |
| `release.yml` | Tag `x.y.z` | `ubuntu-latest` | Job-Container `node:24-bookworm` (bringt `curl` und `git` mit), Cache-Server; Secret `RELEASE_TOKEN` |
| `integration.yml` | Pull Request (bei Änderungen an `src/`, `tests/`, `scripts/dev-nextcloud/`, `vitest.*.config.ts`, `package*.json`), Push auf `main`, manuell | **`docker-host`** | Docker mit Compose, siehe unten |
| `nightly.yml` | täglich 01:00 UTC, aber nur wenn `main` sich seit der Nacht davor geändert hat; die Nacht von Mittwoch auf Donnerstag immer; manuell | `ubuntu-latest` (Prüfung) und **`docker-host`** | wie `integration.yml` |

## `ubuntu-latest` (Job-Container)

- `ci.yml` und `release.yml` laufen im Image `node:24-bookworm`; Node wird nicht pro Lauf heruntergeladen. `jq` fehlt im Image, JSON wird mit `node -p` gelesen.
- `actions/cache` legt `~/.npm` ab (Schlüssel: Hash von `package-lock.json`). Dafür muss im act_runner der Cache-Server eingeschaltet sein (`cache.enabled`, `host` aus den Job-Containern erreichbar, nicht `localhost`). Ohne ihn warnt der Schritt nur und `npm ci` lädt alles neu.
- `container.force_pull: false` im Runner, damit das Image nicht bei jedem Job neu gezogen wird.
- Umgesetzt im HomeLab (2026-10-20, act_runner v13.2): `cicd-runner1` und `cicd-runner2` haben je einen eigenen Cache-Server auf `172.17.0.1:8088` (nur von der Docker-Bridge im LXC erreichbar), Daten unter `/srv/act-runner/actcache`. Je Runner gibt es pro neuem Hash von `package-lock.json` einen ersten Lauf ohne Treffer. Der Runner räumt selbst auf: unbenutzte Einträge nach 7 Tagen, alle nach spätestens 30 Tagen.

## `docker-host` (Host-Runner auf den Docker-LXCs)

- Der Runner hat **kein Job-Container-Image**; der Job nutzt, was auf dem LXC liegt: Node 24, `curl`, `jq`, `git`, Docker mit Compose v5.1.4. Daher kein `actions/setup-node` in `integration.yml` und `nightly.yml`. Weder `sudo` noch `apt-get` stehen dem Runner-User zur Verfügung: **Der Workflow darf nichts nachinstallieren**, nur `npm ci` im Arbeitsverzeichnis.
- Der Job läuft im Netzwerk des Hosts, `http://localhost:<Port>` erreicht den veröffentlichten Port des Testservers.
- Die Matrix-Jobs verteilt Forgejo auf beide LXCs: Integration gegen Nextcloud 35 und `latest` (`integration.yml`) sowie 33 und 34 (`nightly.yml`) mit Compose-Projekt `nc-test-<Version>` und Port 81xx (8133, 8134, 8135, 8199), Performance gegen 33, 34, 35 und `latest` (`nightly.yml`) mit `nc-perf-<Version>` und Port 82xx (8233, 8234, 8235, 8299). Sie kollidieren nicht, auch wenn mehrere Jobs auf demselben Host laufen, weil jeder Job eigenen Port und Projektnamen hat.
- Der Testserver bindet nur an `127.0.0.1`; Zugangsdaten sind Wegwerf-Werte aus `scripts/dev-nextcloud/.env.example`; am Ende läuft `docker compose down -v` (auch bei Fehlern).

## Bedarf je Nextcloud-Job

- ca. 1–2 CPU-Kerne, 2 GB RAM, Image ca. 1,2 GB je Version plus Datenvolume; mindestens 10 GB frei auf dem Docker-Host.
- Laufzeit: Start ca. 2–5 Minuten, Integrationstests ca. 5–15 Minuten (Timeout 45 Minuten), Performance-Test bis zu 20 Minuten (Timeout 60 Minuten). Ein neuer Push auf denselben PR-Branch bricht den laufenden Lauf ab und startet neu (`concurrency`), damit nicht mehrere Läufe die LXCs belegen.
- Ausgehend: Docker Hub (`nextcloud`, dazu `hub.docker.com/v2` für den Digest-Vergleich der `latest`-Jobs), `apps.nextcloud.com` (Collectives, Circles), npm-Registry.

## Aufräumen

Abgebrochene Jobs (Timeout, Runner-Neustart) können Container und Volumes `nc-test-*` bzw. `nc-perf-*` zurücklassen. Der nächste Lauf desselben Jobs und derselben Version räumt sie vor dem Start selbst weg (`docker compose down -v` im Schritt „Start Nextcloud“). Sonst würde er den alten Server mit allen Seiten des abgebrochenen Laufs weiterverwenden. Gezielt: `docker compose -p nc-test-<Version> down -v` (bzw. `nc-perf-<Version>`) auf dem betroffenen LXC, im Zweifel `docker system prune`.
