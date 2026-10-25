# 0030 – Settings as declarative definitions, classic rendering as fallback

- Status: accepted
- Date: 2026-10-25
- Related: architecture §3, §10.2, ADR [0011](0011-minimum-version-and-secret-storage.md), issue ONC-51

## Context

The review of the Obsidian community directory warned that `NcSettingTab` does not implement `getSettingDefinitions()`: its settings do not appear in the settings search of Obsidian ≥ 1.13.0. ADR 0011 had ruled out the declarative API because it had no type for secrets. `minAppVersion` is 1.11.4 because of `app.secretStorage`.

Our rows are more than plain values: text and number fields save on commit and refuse invalid values with a notice, the app password goes to the secret storage and never to `data.json` (ADR 0014), the browser login runs a cancellable flow, the connection test shows a result, and several rows carry warnings. Obsidian's own plugins use `{ name, desc, render }` for such rows; the framework sets name and description, `render` adds the controls.

## Decision

- `getSettingDefinitions()` returns the settings as groups (help, connection, automatic sync, behaviour, diagnostics). Every row is a `render` definition with `name`, `desc` and, where useful, `aliases`; the rows keep their existing behaviour. The built-in `control` types (`text`, `toggle`, …) are not used, because they would replace the commit-on-save and validation behaviour; the `secret` control (≥ 1.13.2) is not used either, so ADR 0014 stays valid.
- `display()` stays as the fallback for Obsidian < 1.13, which never calls `getSettingDefinitions()`. It renders the **same definitions** with `SettingGroup` (≥ 1.11.0), so both versions show the same settings and there is no second list to keep in sync.
- Warnings, results and status lines of a row are created in the row's `infoEl` instead of as sibling elements, because a row of a declarative group has no free container around it.
- `minAppVersion` stays 1.11.4.

## Alternatives considered

- **Raise `minAppVersion` to 1.13.0** – would drop all users of 1.11.4–1.12.x for a search feature; the fallback costs one small method.
- **Declarative `control` types for the simple fields** – search would index the same names; the gain is small and the fields would lose commit-on-save and the notice on invalid values. Two code paths (controls for new, `display()` for old Obsidian) would also have to be kept equal.

## Consequences

- The settings are found by the Obsidian settings search (Obsidian ≥ 1.13); the review warning is gone.
- One list of settings serves both rendering paths.
- Obsidian < 1.13 uses the grouped layout of `SettingGroup` instead of flat headings.
- Follow-up: once `minAppVersion` is raised for another reason, `display()` can be removed.
