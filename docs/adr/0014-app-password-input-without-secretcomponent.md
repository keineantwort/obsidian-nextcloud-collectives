# 0014 – App password via a password field, the plugin assigns the secret ID

- Status: accepted
- Date: 2026-10-16
- Related: architecture §10.1, ADR [0011](0011-minimum-version-and-secret-storage.md), issue ONC-2

## Context

ADR 0011 provided for Obsidian's `SecretComponent` as the input for the app password. The manual test of M1 showed that the component opens a dialog in which the user has to assign or select a secret ID themselves. That is needlessly complicated for entering a password once. We do not need the ability to share a secret between plugins. With the login flow (M9) the plugin stores the password itself anyway.

## Decision

The settings tab shows a normal password field. On confirmation (leaving the field or Enter) the plugin stores the value via `app.secretStorage.setSecret(id, …)`. The plugin generates the ID randomly on first save (`nextcloud-collectives-` + 16 hex characters) and stores it in `data.json`. The plugin only reads and writes IDs it generated itself (prefix `nextcloud-collectives-` + hex). Any other ID in `data.json` is ignored or replaced on the next save – otherwise a manipulated `data.json` could make the plugin send another plugin's secret to a foreign server (security review M1). The field never displays the stored password, only the placeholder "Saved – type to replace". An empty field changes nothing.

From ADR 0011 the following still applies: Obsidian ≥ 1.11.4, password only in the secret storage, never in plain text in `data.json`.

## Alternatives considered

- **Keep `SecretComponent`** – Obsidian standard, but an unnecessary dialog with ID assignment for the user.
- **Fixed secret ID** (e.g. `nextcloud-collectives-app-password`) – simpler, but two vaults with different servers might share the secret if the secret storage spans vaults.

## Consequences

- Simpler setup; the secret ID is invisible to the user.
- A stored password cannot be viewed in the field, only replaced.
- A secret previously chosen via `SecretComponent` is not adopted; the app password has to be entered once more.
- For `http://` to a server outside the device, the settings tab warns that the app password is transmitted unencrypted.
- Deleting the password is not planned in M1; if needed, add it with the login flow (M9).
