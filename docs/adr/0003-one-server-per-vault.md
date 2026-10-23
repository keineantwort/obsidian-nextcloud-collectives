# 0003 – One server per vault, all collectives make up the vault

- Status: accepted
- Date: 2026-10-15
- Related: architecture §2, §6.1

## Context

A user can be a member of many collectives, possibly on several servers. Partial selection and multi-server operation multiply the states (path prefixes, credentials, collisions).

## Decision

A vault is bound to exactly one Nextcloud server. The vault root is the sync root; every collective the user has access to is a top-level folder. No partial selection. Switching servers is not supported (hint: create a new vault).

## Alternatives considered

- **Subfolder as sync root** – mixes synced and local notes, more special cases for links.
- **Multiple servers** – separate credentials and namespaces per server, considerably more complexity.
- **Partial selection of collectives** – the semantics of deleting vs. deselecting would be ambiguous.

## Consequences

- Simple, unambiguous path mapping.
- Files directly in the vault root are ignored (hint in the log).
- New local top-level folders become collectives (setting `newFolderBehaviour`).
