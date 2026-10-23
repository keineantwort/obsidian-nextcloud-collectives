# Architecture Decision Records

Format und Ablauf: [0001](0001-adrs-as-markdown-in-the-repo.md). Neue ADRs mit [template.md](template.md) anlegen, fortlaufend nummerieren und im selben PR wie die Umsetzung einreichen.

| Nr. | Entscheidung | Status |
|---|---|---|
| [0001](0001-adrs-as-markdown-in-the-repo.md) | ADRs als Markdown im Repository | akzeptiert |
| [0002](0002-own-plugin-instead-of-fork.md) | Eigenes Plugin statt Fork von Nextcloud Sync | akzeptiert |
| [0003](0003-one-server-per-vault.md) | Ein Server pro Vault, alle Collectives bilden den Vault | akzeptiert |
| [0004](0004-folder-note-convention.md) | Folder-Note-Konvention statt `Readme.md` | akzeptiert |
| [0005](0005-identity-and-frontmatter.md) | Identität über `nc_page_id`, Nutzer-Frontmatter wird mit hochgeladen | akzeptiert |
| [0006](0006-local-docker-test-server.md) | Lokaler Docker-Testserver für Verifikation und Integrationstests | akzeptiert |
| [0007](0007-content-via-webdav-metadata-via-ocs.md) | Inhalt per WebDAV, Metadaten per OCS, kein `touch` | akzeptiert |
| [0008](0008-link-format-on-push.md) | Link-Format beim Push: relativ mit `?fileId=` | akzeptiert |
| [0009](0009-attachments-via-webdav.md) | Anhänge per WebDAV-PUT statt OCS-Multipart | akzeptiert |
| [0010](0010-rename-collective-via-circles.md) | Collective umbenennen über die Circles-API | akzeptiert |
| [0011](0011-minimum-version-and-secret-storage.md) | Obsidian ≥ 1.11.4, App-Passwort im Secret Storage | akzeptiert, Eingabe-UI abgelöst durch 0014 |
| [0012](0012-concurrent-editing-in-the-browser.md) | Gleichzeitige Bearbeitung im Browser: ETag-Schutz, kein Session-Handling | akzeptiert |
| [0013](0013-localisation-de-en.md) | Benutzer-Texte auf Deutsch und Englisch nach Obsidian-Sprache | akzeptiert |
| [0014](0014-app-password-input-without-secretcomponent.md) | App-Passwort über ein Passwortfeld, Secret-ID vergibt das Plugin | akzeptiert |
| [0015](0015-http-error-mapping-and-retry.md) | HTTP-Fehlerabbildung zentral, 403 ≠ `AuthError`, Retry nur für lesende Requests | akzeptiert |
| [0016](0016-pull-text-based-frontmatter-and-sync-state.md) | Pull: Frontmatter textbasiert, Sync-State als eigene Datei, Konfliktkopie statt Überschreiben | akzeptiert |
| [0017](0017-push-etag-confirmation-and-conflict-resolution.md) | Push: bestätigte ETags, Entscheidung als reine Funktion, Konfliktauflösung über den State | akzeptiert |
| [0018](0018-structure-multiple-passes-confirmations-and-placement.md) | Struktur: mehrere Durchläufe, Rückfragen als Vorschläge, Platzierung neuer Dateien | akzeptiert |
| [0019](0019-tags-emoji-push-and-tags-property.md) | Tags und Emoji: Push über den metaHash, Eigenschaft `tags` bleibt Seiteninhalt | akzeptiert |
| [0020](0020-links-index-anchors-and-hash.md) | Links: Seitenindex, Anker unverändert, Hash im Remote-Format | akzeptiert |
| [0021](0021-attachments-embeds-index-and-reconciliation.md) | Anhänge: Einbettungen über den Index, Abgleich über ETags, Schritt nach dem Inhalt | akzeptiert |
| [0022](0022-automation-mutex-login-flow-and-throttled-saving.md) | Automatik: Mutex mit Re-Run-Flag, stille Auto-Läufe, Login Flow v2, gedrosseltes Speichern | akzeptiert |
| [0023](0023-release-version-check-log-and-ci.md) | Release: Versions-Check, Protokoll-Ansicht, Release-CI | akzeptiert, Integrationstest-Auslöser abgelöst durch 0024 |
| [0024](0024-integration-tests-split-pr-and-nightly.md) | Integrationstests aufgeteilt: aktuelle Version und latest pro PR, ältere und Performance nachts | akzeptiert |
