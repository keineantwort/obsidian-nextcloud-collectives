# 0011 – Obsidian ≥ 1.11.4, app password in secret storage

- Status: accepted; input UI superseded by [0014](0014-app-password-input-without-secretcomponent.md); settings tab structure extended by [0031](0031-declarative-settings-definitions.md)
- Date: 2026-10-16
- Related: architecture §3, §10.1, ONC-1

## Context

The app password must not be stored in plain text in `data.json`. Obsidian offers `app.secretStorage` (`@since 1.11.4`) and `SecretComponent` (`@since 1.11.1`); the declarative settings API only arrives with 1.13.0 and has no secret type.

## Decision

`minAppVersion` = 1.11.4. The app password is stored via `app.secretStorage`; `data.json` contains only the secret ID. The settings tab is a classic `PluginSettingTab` with `SecretComponent`.

## Alternatives considered

- **Minimum 1.13.0 like Nextcloud Sync** – no benefit as long as we do not need the declarative API.
- **Own encryption with a key in `localStorage`** (like NextDeck) – effectively plain text.

## Consequences

- Older Obsidian versions are not supported.
