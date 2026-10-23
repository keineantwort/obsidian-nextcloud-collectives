# 0010 – Rename a collective via the Circles API

- Status: accepted
- Date: 2026-10-16
- Related: architecture §4.2, §7.4, ONC-1

## Context

`PUT /collectives/{id}` accepts only `emoji`. The name of a collective is the name of its team (circle).

## Decision

A locally renamed collective folder is renamed via `PUT /ocs/v2.php/apps/circles/circles/{circleId}/name` (`value`). The ID stays; name, slug and WebDAV path follow (confirmed in M0). If the permissions are missing, the folder is renamed back locally.

## Alternatives considered

- **Not supporting renames** – a local rename would always be reverted, poor UX.

## Consequences

- Dependency on a second app API (Circles/Teams); errors there are to be treated as `ApiChanged`.
- Deleting a collective remains reserved for circle admins/owners (members: 403); the plugin checks `level` beforehand.
