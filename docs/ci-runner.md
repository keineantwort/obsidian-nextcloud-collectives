# Anforderungen an den Forgejo-Actions-Runner

Für die Workflows in `.forgejo/workflows/` dieses Repos (Nextcloud-Collectives-Plugin für Obsidian). Zweck dieses Dokuments: klären, ob ein vorhandener Runner im HomeLab geeignet ist.

## Welcher Workflow braucht was

| Workflow | Auslöser | Braucht |
|---|---|---|
| `ci.yml` | jeder PR, Push auf `main` | nur Node.js; Laufzeit ca. 1–2 Minuten |
| `release.yml` | Tag `x.y.z` | Node.js, `curl`, `jq`; Secret `RELEASE_TOKEN` |
| `integration.yml` | wöchentlich (Mo 03:00), manuell, Tag `x.y.z` | **Docker** (siehe unten), die anspruchsvolle Anforderung |

`ci.yml` und `release.yml` laufen auf jedem Standard-Runner. Die Fragen betreffen fast nur `integration.yml`.

## Anforderungen

### 1. Label und Basis

- Label **`ubuntu-latest`** (so steht es in `runs-on`), alternativ Label in den Workflows anpassen.
- Job-Umgebung mit `git`, `curl`, `jq`, `sed`, `sh`. Node.js 22 lädt `actions/setup-node@v4` selbst nach, sofern die Umgebung Node für Actions mitbringt und ins Internet darf.
- Die Actions `actions/checkout@v4` und `actions/setup-node@v4` müssen auflösbar sein (Runner-Einstellung für die Action-Quelle, z. B. Spiegel auf code.forgejo.org oder Zugang zu github.com).

### 2. Docker (nur `integration.yml`)

Der Job startet mit `docker compose` einen Nextcloud-Container (Image `nextcloud:<33|34|35|latest>-apache`) samt Collectives-App und führt dann `npm run test:int` aus.

- Docker-Engine erreichbar **aus dem Job heraus**, mit **Compose-Plugin v2, mindestens 2.18** (`up --wait --wait-timeout`).
- **Der Test greift über `http://localhost:<Port>` auf den Container zu.** Der Port wird vom Compose-File auf `127.0.0.1` des Docker-Hosts veröffentlicht. Der Job muss deshalb im selben Netzwerk-Namespace wie dieser Host-Port laufen:
  - Runner im **Host-Modus** (Label mit `:host`), oder
  - Job-Container mit **`network: host`** und Docker-Socket des Hosts, oder
  - Docker-in-Docker, wenn der Job-Container das Netzwerk des DinD-Daemons teilt.

  Läuft der Job in einem normalen, isolierten Container mit durchgereichtem Socket, erreicht er `localhost:<Port>` **nicht**. Dann braucht es eine Änderung am Workflow (Container-Name statt `localhost`); bitte dies im HomeLab-Projekt klären.
- Zugriff auf den Docker-Socket ist faktisch Root auf dem Docker-Host. Empfehlung: dedizierter oder kurzlebiger Runner nur für vertrauenswürdige Repos (dieses Repo ist privat und die Workflows laufen nicht für Fremd-PRs).
- Bei mehreren Jobs gleichzeitig: Jede Matrix-Variante nutzt eigenen Compose-Projektnamen (`nc-test-<Version>`) und eigenen Port (**8133, 8134, 8135, 8199**), das sind vier freie Ports auf `127.0.0.1` des Docker-Hosts.

### 3. Ressourcen

Je Nextcloud-Job (vier Jobs, bei freier Kapazität gleichzeitig):

- ca. 1–2 CPU-Kerne und **2 GB RAM**; bei vier parallelen Jobs also ca. 8 GB RAM. Bei knappem RAM Runner-`capacity` auf 1–2 setzen, die Jobs warten dann.
- Festplatte: Image ca. 1,2 GB je Version (4 Versionen, gemeinsame Layer) plus Datenvolume und `node_modules`; **mindestens 10 GB frei** auf dem Docker-Host.
- Laufzeit: Start und Installation von Nextcloud ca. 2–5 Minuten, Tests ca. 5–15 Minuten. Timeout im Workflow: 45 Minuten je Job.

### 4. Netzwerk (ausgehend)

- Docker Hub (Image-Pull `nextcloud`). Anonyme Pulls sind limitiert (100 je 6 Stunden und IP); wöchentlich vier Pulls sind unkritisch, ein Pull-Through-Cache ist nicht nötig.
- `apps.nextcloud.com` (die Container-Hooks installieren `collectives` und `circles` aus dem Nextcloud-App-Store).
- npm-Registry (`npm ci`), Node-Download durch `setup-node`.
- Kein eingehender Zugriff nötig; der Testserver bindet nur an `127.0.0.1`.

### 5. Secrets und Daten

- `integration.yml`: keine Secrets. Die Zugangsdaten des Testservers sind Wegwerf-Werte aus `scripts/dev-nextcloud/.env.example`; Testdaten sind künstlich und werden am Ende mit `docker compose down -v` gelöscht (läuft auch bei Fehlern).
- `release.yml`: Repository-Secret **`RELEASE_TOKEN`** (Forgejo-Token mit Schreibrecht auf Releases dieses Repos).

### 6. Aufräumen

Abgebrochene Jobs (Timeout, Runner-Neustart) können Container und Volumes `nc-test-*` zurücklassen. Empfehlung: regelmäßig `docker system prune` bzw. gezielt `docker compose -p nc-test-<Version> down -v` auf dem Docker-Host.

## Fragen an das HomeLab-Projekt

1. Gibt es einen Runner mit dem Label `ubuntu-latest`? Läuft er im Host-Modus, als Job-Container oder mit DinD?
2. Ist Docker (Compose ≥ 2.18) aus Jobs erreichbar, und teilt der Job das Netzwerk mit dem Docker-Host (`localhost:<Port>`)?
3. Reichen RAM, CPU und Platz für vier parallele Nextcloud-Jobs, oder soll die Kapazität begrenzt werden?
4. Sind die Ports 8133, 8134, 8135 und 8199 auf dem Docker-Host frei?
5. Dürfen die Jobs ins Internet (Docker Hub, apps.nextcloud.com, npm, Node-Download)?
6. Wie sind die Actions `actions/checkout` und `actions/setup-node` aufgelöst?
7. Darf dieses Repo einen Runner mit Docker-Socket-Zugriff nutzen, oder gibt es einen dafür vorgesehenen?
