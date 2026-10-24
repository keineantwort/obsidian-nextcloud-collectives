# Local Nextcloud test server

Nextcloud + Collectives + Circles in one container (SQLite), reachable only on `127.0.0.1`. Strictly for development and integration tests, never with real data.

```bash
./up.sh              # starts and waits for "healthy"; creates .env from .env.example
./down.sh            # stops, data is kept
./down.sh --reset    # stops and deletes all data (next start = fresh installation)
```

- Web interface: http://localhost:8080 (admin or test user `alice`, passwords in `.env`)
- Version selectable via `NC_VERSION` in `.env` (default 33; tested 33–35, see `docs/release.md`)
- `./versions.sh [project name]` shows the Nextcloud, Collectives, Circles and Text versions of the running server
- `npm run test:int` also takes `NC_PORT`, `NC_TEST_USER`, `NC_TEST_PASSWORD` from the environment (takes precedence over `.env`)
- `hooks/10-collectives.sh` runs once after the installation: enables the apps (retries the app store download up to five times), creates the test user
- Scripts create app passwords themselves when needed, via `occ user:auth-tokens:add`

Also available as `npm run nc:up` / `npm run nc:down`.
