# Architecture Decision Records

Format and process: [0001](0001-adrs-as-markdown-in-the-repo.md). Create new ADRs from [template.md](template.md), number them consecutively and submit them in the same PR as the implementation.

| No. | Decision | Status |
|---|---|---|
| [0001](0001-adrs-as-markdown-in-the-repo.md) | ADRs as Markdown in the repository | accepted, language superseded by 0025 |
| [0002](0002-own-plugin-instead-of-fork.md) | Own plugin instead of a fork of Nextcloud Sync | accepted |
| [0003](0003-one-server-per-vault.md) | One server per vault, all collectives make up the vault | accepted |
| [0004](0004-folder-note-convention.md) | Folder-note convention instead of `Readme.md` | accepted |
| [0005](0005-identity-and-frontmatter.md) | Identity via `nc_page_id`, user frontmatter is uploaded too | accepted |
| [0006](0006-local-docker-test-server.md) | Local Docker test server for verification and integration tests | accepted |
| [0007](0007-content-via-webdav-metadata-via-ocs.md) | Content via WebDAV, metadata via OCS, no `touch` | accepted |
| [0008](0008-link-format-on-push.md) | Link format on push: relative with `?fileId=` | accepted |
| [0009](0009-attachments-via-webdav.md) | Attachments via WebDAV PUT instead of OCS multipart | accepted |
| [0010](0010-rename-collective-via-circles.md) | Rename a collective via the Circles API | accepted |
| [0011](0011-minimum-version-and-secret-storage.md) | Obsidian ≥ 1.11.4, app password in secret storage | accepted, input UI superseded by 0014 |
| [0012](0012-concurrent-editing-in-the-browser.md) | Concurrent editing in the browser: ETag protection, no session handling | accepted |
| [0013](0013-localisation-de-en.md) | User-facing texts in German and English following the Obsidian language | accepted |
| [0014](0014-app-password-input-without-secretcomponent.md) | App password via a password field, the plugin assigns the secret ID | accepted |
| [0015](0015-http-error-mapping-and-retry.md) | Central HTTP error mapping, 403 ≠ `AuthError`, retry only for read requests | accepted |
| [0016](0016-pull-text-based-frontmatter-and-sync-state.md) | Pull: text-based frontmatter, sync state as a separate file, conflict copy instead of overwriting | accepted |
| [0017](0017-push-etag-confirmation-and-conflict-resolution.md) | Push: confirmed ETags, decision as a pure function, conflict resolution via the state | accepted, stale-choice check extended by 0027 |
| [0018](0018-structure-multiple-passes-confirmations-and-placement.md) | Structure: multiple passes, confirmations as proposals, placement of new files | accepted |
| [0019](0019-tags-emoji-push-and-tags-property.md) | Tags and emoji: push via the metaHash, the `tags` property stays page content | accepted |
| [0020](0020-links-index-anchors-and-hash.md) | Links: page index, anchors unchanged, hash in the remote format | accepted |
| [0021](0021-attachments-embeds-index-and-reconciliation.md) | Attachments: embeds via the index, reconciliation via ETags, step after the content | accepted |
| [0022](0022-automation-mutex-login-flow-and-throttled-saving.md) | Automation: mutex with re-run flag, silent auto runs, Login Flow v2, throttled saving | accepted |
| [0023](0023-release-version-check-log-and-ci.md) | Release: version check, log view, release CI | accepted, integration test trigger superseded by 0024 |
| [0024](0024-integration-tests-split-pr-and-nightly.md) | Integration tests split: current version and latest per PR, older versions and performance nightly | accepted, paths filter superseded by 0026, nightly condition refined by 0029 |
| [0025](0025-english-documentation-user-manual-and-architecture.md) | English documentation, user manual, architecture instead of plan | accepted |
| [0026](0026-required-checks-and-retried-app-install.md) | Required checks for main, in-job change detection, retried app installation | accepted, change detection extended by 0029 |
| [0027](0027-update-existing-conflict-copy.md) | Update the existing conflict copy when the server changes again | accepted |
| [0028](0028-server-error-detail-in-the-log.md) | Server error detail (OCS message, Sabre exception) on HTTP errors and in the log | accepted |
| [0029](0029-skip-integration-tests-for-documentation-on-main.md) | Skip the integration and nightly tests for documentation-only changes on main too | accepted |
| [0030](0030-no-github-artifact-attestations.md) | No GitHub artifact attestations for the release files | accepted |
| [0031](0031-declarative-settings-definitions.md) | Settings as declarative definitions for the settings search, classic rendering as fallback for Obsidian < 1.13 | accepted |
| [0032](0032-release-workflow-sets-the-tag.md) | The release workflow sets the tag after checking that the version is not released yet | accepted |
