# 0015 – HTTP error mapping and retry centrally in the HTTP client

- Status: accepted
- Date: 2026-10-16
- Related: architecture §12, milestone M2, issue ONC-3

## Context

Until M1 only the connection test mapped HTTP status codes to error classes, and it treated 401 and 403 alike as `AuthError`. From M2 on, all clients (OCS, Circles, WebDAV) use the same transport. In Nextcloud a 403 does not just mean "wrong credentials". The response also occurs when a signed-in user is not allowed to change a resource, for example when a member tries to delete a collective (M0, fixture `collective-trash-as-member.json`). If that counted as `AuthError`, the sync would pause (architecture §12) because of a single forbidden action.

Architecture §12 also requires retry with 1/2/4 s backoff for network and server errors.

## Decision

- The status mapping lives in exactly one place: `errorForStatus` in `src/api/http.ts`, called by `HttpClient.send`.
  - 401 → `AuthError` (credentials rejected, pause the sync)
  - 403 → new class `ForbiddenError` (no permission for this resource, only that one action fails)
  - 404 → `NotFoundError`, 412 → `ConflictError`
  - any other non-2xx status → `ServerError(status)`
  - no response / timeout → `NetworkError`
- Retry only for **reading** methods (`GET`, `PROPFIND`), only on `NetworkError` and status ≥ 500, with pauses of 1/2/4 s, at most three retries. 4xx is never retried.
- Writing methods (`PUT`, `POST`, `PATCH`, `DELETE`, `MKCOL`, `MOVE`) are never retried automatically. If a `PUT` reached the server but the response was lost, retrying with the old `If-Match` would produce a false 412. A repeated `POST` would create a page twice. The next sync run takes over the retry after re-reading the state.
- The connection test in the settings runs without retry so that feedback is immediate.

## Alternatives considered

- **Keep 403 as `AuthError`** – pauses the sync for all collectives although only one action is forbidden.
- **Retry for all methods** – risks duplicate pages and phantom conflicts, see above.
- **Status mapping per client** – three copies of the same table that drift apart.

## Consequences

- positive: Uniform errors in all clients. Callers can handle `ForbiddenError` specifically, for example restoring a deleted collective folder (architecture §7.4).
- negative: A network error while writing fails immediately. This is intended; the next run corrects it.
- Follow-up work: The sync (from M3/M4) pauses on `AuthError` and reports `ForbiddenError` per operation without aborting the run.
