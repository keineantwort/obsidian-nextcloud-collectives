# Contributing

Thanks for looking into the code. This page gets you from a fresh clone to a running plugin and a green test suite, and tells you where the design is written down.

The project is developed on the maintainer's Forgejo instance and mirrored to [GitHub](https://github.com/keineantwort/obsidian-nextcloud-collectives). Issues and pull requests are welcome on GitHub.

## Where things are explained

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the plugin works: server interfaces, module layout, mapping between collectives and the vault, sync rules, conflicts, links, attachments, auth, tests. **Authoritative**: code that deviates from it is a bug or needs the document updated in the same pull request. |
| [docs/adr/](docs/adr/README.md) | Architecture decisions with context and rejected alternatives. Read the relevant ADR before changing a decision; record a new or changed decision as a new ADR ([template](docs/adr/template.md)). |
| [docs/api-notes.md](docs/api-notes.md) | Verified behaviour of the Collectives OCS API and WebDAV, with recorded fixtures in `tests/fixtures/`. |
| [docs/user/](docs/user/en/README.md) | User manual in English and German, including the reference of all settings. |
| [docs/release.md](docs/release.md), [docs/ci-runner.md](docs/ci-runner.md) | Releases and CI. |
| [docs/manual-test.md](docs/manual-test.md) | Manual checklist for desktop, iOS and Android before a release. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents; they apply to humans too. |

## Prerequisites

- Node.js 24 and npm
- Docker with Compose, for the local Nextcloud test server (integration tests only)
- Obsidian 1.11.4 or later for trying the plugin

## Setup

```bash
npm install
npm run build        # type check + production build, writes main.js
npm run lint         # ESLint incl. eslint-plugin-obsidianmd
npm test             # unit tests (Vitest)
```

## Trying the plugin in Obsidian

`npm run dev` rebuilds `main.js` on every change. If a folder `dev-vault/` exists in the repository root (it is ignored by git), the build also copies `main.js`, `manifest.json` and `styles.css` to `dev-vault/.obsidian/plugins/nextcloud-collectives/`. Open `dev-vault` as a vault in Obsidian, enable the plugin and point it at the local test server below. Use the [Hot Reload](https://github.com/pjeby/hot-reload) plugin or toggle the plugin to pick up changes.

## Local Nextcloud test server

```bash
cp scripts/dev-nextcloud/.env.example scripts/dev-nextcloud/.env   # throwaway credentials
npm run nc:up        # Nextcloud + Collectives in Docker, only on 127.0.0.1
npm run test:int     # integration tests against it
npm run test:perf    # performance test with 500 pages (several minutes)
npm run nc:down
```

Details and options: [scripts/dev-nextcloud/README.md](scripts/dev-nextcloud/README.md). Integration tests run against this server only, never against a real one.

## Ground rules

The full list is in [AGENTS.md](AGENTS.md#hard-rules). The ones that surprise people most:

- The plugin runs on mobile: no Node modules, no Electron, no `fetch`. HTTP only through `requestUrl` from `obsidian`, hashing through `crypto.subtle`, XML through `DOMParser`.
- Notes are only touched through the vault API, never through the adapter.
- `src/sync/planner.ts` and `src/mapping/` stay free of Obsidian and network imports and are fully unit-tested.
- Never overwrite or delete user data without asking; when in doubt, create a conflict copy.
- User-facing texts go through `src/i18n/` in English and German.
- A change to user-visible behaviour or a setting updates the README and the user manual in both languages ([ADR 0025](docs/adr/0025-english-documentation-user-manual-and-architecture.md)).

## Pull requests

- One topic per pull request, split into meaningful commits.
- `npm run build`, `npm run lint`, `npm test` and `npm run test:int` are green; new logic has tests.
- The description says what changed, what you tested by hand (desktop, mobile) and what is left open.
- Never commit credentials; anonymize fixtures.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
