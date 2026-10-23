# 0013 – User-facing texts in German and English, following the Obsidian language

- Status: accepted
- Date: 2026-10-16
- Related: architecture §11, AGENTS.md (code style), issue ONC-2

## Context

Until now the rule was: user-facing texts in German. The plugin should also serve users with an English Obsidian interface, and a later publication in the community store (open decision on store publication) practically requires English. In M1 there are only about 25 texts – the change is cheap now and expensive later.

## Decision

All user-facing texts (settings, notices, modals, status bar) come from `src/i18n/`: `en.ts` defines the keys, `de.ts` must be complete via the type `Record<MessageKey, string>`. The language is determined when the plugin loads via `getLanguage()` (Obsidian ≥ 1.8.7): `de*` → German, everything else → English. Placeholders use the format `{name}`. No runtime switching is needed because Obsidian restarts after a language change anyway.

## Alternatives considered

- **German only** (previous rule) – excludes English-speaking users.
- **i18n library (e.g. i18next)** – unnecessary dependency for two languages and simple placeholders (AGENTS rule 8).

## Consequences

- Every new user-facing text needs a key in `en.ts` and `de.ts`; the type check enforces completeness.
- Pure modules (e.g. `connectionMessages.ts`) receive a `Translator` instead of hard-coding texts.
- More languages are possible by extending `Locale` and `resolveLocale`.
