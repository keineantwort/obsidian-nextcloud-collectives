# 0030 – No GitHub artifact attestations for the release files

- Status: accepted
- Date: 2026-10-25
- Related: [0023](0023-release-version-check-log-and-ci.md), [docs/release.md](../release.md), issue ONC-52 (recommendation of the automatic review in the community directory, ONC-31)

## Context

The automatic review of the Obsidian community directory recommends GitHub artifact attestations for `main.js` and `styles.css`, so that users can check with `gh attestation verify` that the files were built from the source repository. The recommendation is not blocking.

Forgejo is the source of the code and builds the release in `release.yml`; the GitHub repository is a mirror that only receives the tag and the three uploaded files. An attestation (`actions/attest-build-provenance`) is a Sigstore signature with a short-lived certificate that is issued only against an OIDC token of **GitHub Actions**. The certificate binds repository, workflow and commit; `gh attestation verify -R <repo>` checks exactly that identity. A build on Forgejo cannot obtain such a token, and an attestation made elsewhere does not pass the check or get stored in GitHub.

## Decision

The release files get **no GitHub artifact attestations**. Forgejo stays the only place that builds a release; `release.yml` is unchanged.

## Alternatives considered

- **Second build in a GitHub Actions workflow on the mirror** (builds from the tagged commit, attests, creates the GitHub release) – possible, but then two builds exist and must deliver byte-identical files (Node, npm and esbuild versions, `npm ci` result). Without that, the attested file differs from the one on Forgejo, and the attestation would vouch for a different build than the one that was tested. It also needs a GitHub workflow and extra token permissions (`id-token`, `attestations`) in a repository that is otherwise a pure mirror. The benefit (a verifiable origin for a small, single-maintainer plugin whose source is public and whose files the directory scans itself) does not justify this.
- **Attest the files that Forgejo built, from a GitHub workflow that only downloads them** – the attestation would only prove that GitHub saw the file, not where it came from. It would give a false sense of provenance.
- **Own signature from Forgejo (e.g. `cosign sign-blob` with a key kept as a Forgejo secret), signatures as release assets** – works without GitHub, but it is not a GitHub attestation (`gh attestation verify` does not accept it), users would have to install `cosign` and trust a published key, and key handling becomes a new task of the maintainer. Can be revisited if users ask for it.

## Consequences

- positive: No second build, no extra workflow or token rights on GitHub; the release process stays as in [docs/release.md](../release.md).
- negative / cost: The release files carry no cryptographic proof of origin. The review recommendation stays unmet. Users who want certainty build from the tag themselves (`npm ci && npm run build`).
- follow-up work: Revisit if the project moves its source or its release build to GitHub, or if Forgejo gains a way to obtain a GitHub-accepted identity.
