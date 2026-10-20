# Runner für die Forgejo-Actions-Workflows

Für die Workflows in `.forgejo/workflows/` dieses Repos. Stand: Rückmeldung des HomeLab-Projekts (2026-10-20); die Anforderungen unten sind damit erfüllt.

## Welcher Workflow läuft wo

| Workflow | Auslöser | `runs-on` | Braucht |
|---|---|---|---|
| `ci.yml` | jeder PR, Push auf `main` | `ubuntu-latest` | Job-Container `node:24-bookworm`, Cache-Server des Runners (siehe unten); ca. 1–2 Minuten |
| `release.yml` | Tag `x.y.z` | `ubuntu-latest` | Job-Container `node:24-bookworm` (bringt `curl` und `git` mit), Cache-Server; Secret `RELEASE_TOKEN` |
| `integration.yml` | Pull Request (bei Änderungen an `src/`, `tests/`, `scripts/dev-nextcloud/`, `package*.json`), Push auf `main`, Tag `x.y.z`, wöchentlich (Mo 03:00), manuell | **`docker-host`** | Docker mit Compose, siehe unten |

## `ubuntu-latest` (Job-Container)

- `ci.yml` und `release.yml` laufen im Image `node:24-bookworm`; Node wird nicht pro Lauf heruntergeladen. `jq` fehlt im Image, JSON wird mit `node -p` gelesen.
- `actions/cache` legt `~/.npm` ab (Schlüssel: Hash von `package-lock.json`). Dafür muss im act_runner der Cache-Server eingeschaltet sein (`cache.enabled`, `host` aus den Job-Containern erreichbar, nicht `localhost`). Ohne ihn warnt der Schritt nur und `npm ci` lädt alles neu.
- `container.force_pull: false` im Runner, damit das Image nicht bei jedem Job neu gezogen wird.
- Umgesetzt im HomeLab (2026-10-20, act_runner v13.2): `cicd-runner1` und `cicd-runner2` haben je einen eigenen Cache-Server auf `172.17.0.1:8088` (nur von der Docker-Bridge im LXC erreichbar), Daten unter `/srv/act-runner/actcache`. Je Runner gibt es pro neuem Hash von `package-lock.json` einen ersten Lauf ohne Treffer. Der Runner räumt selbst auf: unbenutzte Einträge nach 7 Tagen, alle nach spätestens 30 Tagen.

## `docker-host` (Host-Runner auf den Docker-LXCs)

- Der Runner hat **kein Job-Container-Image**; der Job nutzt, was auf dem LXC liegt: Node 24, `curl`, `jq`, `git`, Docker mit Compose v5.1.4. Daher kein `actions/setup-node` in `integration.yml`. Weder `sudo` noch `apt-get` stehen dem Runner-User zur Verfügung: **Der Workflow darf nichts nachinstallieren**, nur `npm ci` im Arbeitsverzeichnis.
- Der Job läuft im Netzwerk des Hosts, `http://localhost:<Port>` erreicht den veröffentlichten Port des Testservers.
- Die vier Matrix-Jobs (Nextcloud 33, 34, 35, `latest`) verteilt Forgejo auf beide LXCs. Ports 8133, 8134, 8135 und 8199 sowie die Compose-Projekte `nc-test-<Version>` kollidieren nicht, auch wenn zwei Jobs auf demselben Host laufen, weil jede Variante eigenen Port und Projektnamen hat.
- Der Testserver bindet nur an `127.0.0.1`; Zugangsdaten sind Wegwerf-Werte aus `scripts/dev-nextcloud/.env.example`; am Ende läuft `docker compose down -v` (auch bei Fehlern).

## Bedarf je Nextcloud-Job

- ca. 1–2 CPU-Kerne, 2 GB RAM, Image ca. 1,2 GB je Version plus Datenvolume; mindestens 10 GB frei auf dem Docker-Host.
- Laufzeit: Start ca. 2–5 Minuten, Tests ca. 5–15 Minuten (Timeout 45 Minuten). Ein neuer Push auf denselben PR-Branch bricht den laufenden Lauf ab und startet neu (`concurrency`), damit nicht mehrere Läufe die LXCs belegen.
- Ausgehend: Docker Hub (`nextcloud`), `apps.nextcloud.com` (Collectives, Circles), npm-Registry.

## Aufräumen

Abgebrochene Jobs (Timeout, Runner-Neustart) können Container und Volumes `nc-test-*` zurücklassen. Gezielt: `docker compose -p nc-test-<Version> down -v` auf dem betroffenen LXC, im Zweifel `docker system prune`.
