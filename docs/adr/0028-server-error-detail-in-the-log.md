# 0028 – Server error detail in the log

- Status: accepted
- Date: 2026-10-24
- Related: architecture §12, [ADR 0015](0015-http-error-mapping-and-retry.md), issue ONC-37

## Context

`ServerError` carried only the HTTP status, and the log only the error class (`error: 'ServerError'`). A 400 or 500 in the log could not be told apart: a duplicate tag, a full disk and a broken app all looked the same. Nextcloud does say why: OCS endpoints answer with `ocs.meta.message` (e.g. "Tag already exists for collective: Projekt"), WebDAV with a Sabre error XML (`s:exception`, `s:message`).

The log must not contain credentials (AGENTS.md, rule 5), and it must not contain page contents. The raw response body can contain both: an HTML error page, a proxy page, or a body that echoes the request.

## Decision

- `ServerError` gets an optional `detail`. `HttpClient` fills it for every non-2xx response via `extractErrorDetail` (`src/api/errorDetail.ts`, pure).
- Only two known shapes are read, never the raw body: `ocs.meta.message` from a JSON body, and `<s:exception>: <s:message>` from an XML body whose root is `{DAV:}error`. Anything else gives no detail.
- The detail is cleaned before it is stored: whitespace collapsed, the app password and the username replaced by `***` (only values of at least 3 characters, so a very short username does not mangle the text), cut to 200 characters.
- The log sites use `errorLogFields(err)` (`src/util/errors.ts`): the error class plus, for a `ServerError`, the detail. The error message itself is still never logged.
- Only `ServerError` carries the detail. 401/403/404/412 have their own classes and handling; their reason is clear from the class.

## Alternatives considered

- **Log the error message** – the message contains the request path and later maybe more; the existing rule "class only, never the message" stays.
- **Keep a cut-off raw body** – an HTML page or a reflected request can contain contents or secrets; only the two known fields are trustworthy.
- **Detail on every `NcError`** – more than the ticket needs; can follow if 403/404 reasons turn out to be useful.

## Consequences

- positive: The log tells why the server refused an operation, without a request-level debug log.
- negative: Server messages can contain names of collectives, pages or tags (as the request paths in the detailed log already do). The user manual says so.
- follow-up work: none.
