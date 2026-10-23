# 0025 – English documentation, user manual, architecture instead of plan

- Status: accepted
- Date: 2026-10-23
- Related: [0001](0001-adrs-as-markdown-in-the-repo.md) (language of the ADRs), [0013](0013-localisation-de-en.md)

## Context

All documentation was written in German. The Obsidian community store shows the `README.md` of the GitHub repository as the plugin's detail page, and the store audience is international. People who check out or fork the repository need the developer documentation (plan, ADRs, API notes) as much as the maintainer does. The milestones M0–M10 in `PLAN.md` are implemented, so the plan no longer works as a to-do list, while its sections on server interfaces, mapping and sync rules still describe how the plugin works. The settings were only explained in their short descriptions in the settings tab and in parts of the README.

## Decision

- **Everything in the repository is in English**: README, architecture, ADRs, API notes, release and CI notes, the manual test checklist, `AGENTS.md`, `CONTRIBUTING.md`, code comments and test names. Existing ADRs are translated without changing their content and get English file names. Commit messages, Forgejo issues and pull request descriptions are not covered by this decision.
- **`README.md` is the store page**: what the plugin does, installation, first steps, risks and links into the manual. A German copy lives in `README.de.md`; both link to each other at the top.
- **User manual** in `docs/user/en/` and `docs/user/de/`, plain Markdown without a site generator, including a reference of every setting (effect, default, values, risks). The manual follows the two UI languages of [0013](0013-localisation-de-en.md) and uses the UI texts from `src/i18n/` verbatim.
- **`docs/architecture.md` replaces `PLAN.md`** as the authoritative description of how the plugin works. Section numbers 1–13 stay as they were in the plan, so references such as "architecture §7.4" keep their meaning; risks and references follow as §14 and §15. Milestones, status table and the list of open decisions are dropped (they remain in the git history; decisions are in the ADRs). Open items become Forgejo issues.
- **Keeping docs in step**: a pull request that changes user-visible behaviour or a setting updates the README and the manual in both languages. A change to the sync rules updates `docs/architecture.md`.
- The settings tab links to the manual.

## Alternatives considered

- **Docusaurus or MkDocs with i18n** – a build, hosting (e.g. GitHub Pages) and extra dependencies for a few pages; GitHub renders the Markdown in `docs/` well enough. The files can be moved into such a site later without rewriting them.
- **Keep `PLAN.md` and translate it** – the milestone sections and the status table only describe history and would need to be maintained for nothing.
- **English only, no German manual** – the UI is bilingual, and German-speaking Nextcloud users are a large share of the audience.
- **Keep the developer documentation in German** – excludes most people who fork the repository; a partial switch would leave the repository in two languages.

## Consequences

- The store page and the manual can be read by an international audience; German users keep a full manual.
- Every user-visible change costs two manual edits (English and German); `AGENTS.md` makes this part of the definition of done.
- References to `PLAN.md` in code, tests and ADRs point to `docs/architecture.md`.
- [0001](0001-adrs-as-markdown-in-the-repo.md) is superseded in one point: ADRs are written in English.
