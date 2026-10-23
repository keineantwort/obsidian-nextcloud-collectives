# AGENTS.md – Notes for coding agents

Project: Obsidian plugin that syncs Nextcloud Collectives bidirectionally with a vault.
**Authoritative description: [`docs/architecture.md`](docs/architecture.md).** Read it before any work. If code and architecture disagree, the architecture wins; deviate only after asking, and then update the document in the same PR.

## Way of working

- One issue (Forgejo, prefix `ONC-`) or one coherent topic per branch and PR. Branch name: short kebab-case, e.g. `onc-12-conflict-copy-update` or `docs-install-brat`.
- Split the work into meaningful commits; one PR, several commits.
- Unclear requirements: ask instead of guessing.
- Architecture decisions live in `docs/adr/`. Read the relevant ADR before deviating; record new or changed decisions as a new ADR in the same PR (template `docs/adr/template.md`).
- Before building your own solution for auth, WebDAV conflicts or mobile triggers, look at the reference projects in architecture §15. Code taken over only with a compatible licence and attribution.
- When done: update `docs/architecture.md` if behaviour or structure changed, record API findings in `docs/api-notes.md`, and update the README and the user manual (`docs/user/en/`, `docs/user/de/`) for user-visible changes (ADR 0025).

## Commands

```bash
npm install
npm run dev          # esbuild watch, writes main.js (and copies it into dev-vault/ if present)
npm run build        # type check + production build
npm run lint         # ESLint incl. eslint-plugin-obsidianmd
npm test             # Vitest (unit)
npm run test:int     # integration tests, needs the running test server
npm run test:perf    # performance test (500 pages, several minutes), needs the running test server
npm run nc:up        # start the Docker test server (scripts/dev-nextcloud)
npm run nc:down
```

## Hard rules

1. The plugin must run on mobile: no Node modules (`fs`, `path`, `crypto` from Node, `http`), no Electron, no `fetch`. HTTP only through `requestUrl` from `obsidian`, hashing through `crypto.subtle`, XML through `DOMParser`.
2. File access only through the vault API (`app.vault.process`, `app.fileManager.processFrontMatter`, `app.fileManager.renameFile`). No direct adapter access to notes.
3. `src/sync/planner.ts` and everything in `src/mapping/` stay free of Obsidian and network imports and are fully unit-tested.
4. Never overwrite or delete user data without asking. When in doubt, create a conflict file.
5. No credentials in logs, fixtures, tests or commits. Anonymize fixtures.
6. Integration tests only against the local Docker test server, never against production servers.
7. TypeScript `strict`; no `any` without a comment giving the reason.
8. New dependencies only if they run without Node and are small; justify them in the PR.

## Definition of done

- The issue's acceptance criteria are met.
- `npm run build`, `npm run lint`, `npm test` and `npm run test:int` are green.
- New logic has tests; planner cases are tested individually.
- Docs updated: architecture, ADR, API notes as needed; README and user manual in English **and** German for user-visible changes, settings reference (`docs/user/*/settings.md`) for every added or changed setting.
- PR description: what was implemented, what was tested manually (desktop/mobile), open points.

## Code style

- Files and modules as in architecture §5.
- Small, pure functions; side effects bundled in the `executor` and in `main.ts`.
- User texts (notices, settings, modals) only through `src/i18n/` in English (`en.ts`) and German (`de.ts`), see ADR 0013.
- Code, comments, test names and documentation in English (ADR 0025).
- Errors through the classes in `src/util/errors.ts`, not raw strings.
