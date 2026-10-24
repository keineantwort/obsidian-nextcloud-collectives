# 0028 – Server error detail in the log

- Status: accepted
- Date: 2026-10-24
- Related: architecture §12, [ADR 0015](0015-http-error-mapping-and-retry.md), issue ONC-37

## Context

`ServerError` carried only the HTTP status, and the log only the error class (`error: 'ServerError'`). A 400 or 500 in the log could not be told apart: a duplicate tag, a full disk and a broken app all looked the same. Nextcloud does say why: OCS endpoints answer with `ocs.meta.message` (e.g. "Tag already exists for collective: Projekt"), WebDAV with a Sabre error XML (`s:exception`, `s:message`). This holds for 403 as well ("Member … not allowed to delete collective: 3").

The log must not contain credentials (AGENTS.md, rule 5), and it must not contain page contents. The raw response body can contain both: an HTML error page, a proxy page, or a body that echoes the request.

## Decision

- `NcError` gets an optional `detail` (constructor option next to `cause`). Every error built from an HTTP response carries it: `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError` and `ServerError`.
- `errorForResponse` in `src/api/http.ts` is the one place that turns a response into an error. It returns `null` for 2xx without reading the body; otherwise it reads the body once, also from the bytes of a binary response (attachment downloads have no text), and passes the detail to `errorForStatus`. `HttpClient` and the Login Flow use it.
- `extractErrorDetail` (`src/api/errorDetail.ts`, pure) reads only two known shapes, never the raw body: `ocs.meta.message` from a JSON body, and `<s:exception>: <s:message>` from an XML body whose root is `{DAV:}error`. Anything else gives no detail.
- The detail is cleaned before it is stored: whitespace collapsed, the secrets of the request replaced by `***` (app password and username in `HttpClient`, the poll token in the Login Flow; only values of at least 3 characters, so a very short username does not mangle the text), cut to 200 characters.
- The log sites use `errorLogFields(err)` (`src/util/errors.ts`): the error class plus the detail. The error message itself is still never logged.
- The production build keeps class names (esbuild `keepNames`, `esbuild.options.mjs`). Without it the minifier renamed the error classes and the log read `error=Q` (found in the manual test; present since the first release). `tests/unit/bundle.test.ts` bundles `errors.ts` with these options and checks the names. Cost: about 11 KB more in `main.js` (≈ 5 %).

## Alternatives considered

- **Log the error message** – the message contains the request path and later maybe more; the existing rule "class only, never the message" stays.
- **Keep a cut-off raw body** – an HTML page or a reflected request can contain contents or secrets; only the two known fields are trustworthy.
- **Detail only on `ServerError`** – the first draft. The detail belongs to the response, not to the class: 403 reasons are just as useful, and the extra branch in `errorLogFields` goes away.

## Consequences

- positive: The log tells why the server refused an operation, without a request-level debug log.
- negative: Server messages can contain names of collectives, pages or tags (as the request paths in the detailed log already do). The user manual says so.
- follow-up work: The XML preparation (`DAV:` namespace, `DOMParser`, `parsererror` check) now exists in `webdavClient.ts` and `errorDetail.ts`; a shared helper pays off once a third XML reader appears.
