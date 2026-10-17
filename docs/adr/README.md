# Architecture Decision Records

Format und Ablauf: [0001](0001-adrs-als-markdown-im-repo.md). Neue ADRs mit [template.md](template.md) anlegen, fortlaufend nummerieren und im selben PR wie die Umsetzung einreichen.

| Nr. | Entscheidung | Status |
|---|---|---|
| [0001](0001-adrs-als-markdown-im-repo.md) | ADRs als Markdown im Repository | akzeptiert |
| [0002](0002-eigenes-plugin-statt-fork.md) | Eigenes Plugin statt Fork von Nextcloud Sync | akzeptiert |
| [0003](0003-ein-server-pro-vault.md) | Ein Server pro Vault, alle Collectives bilden den Vault | akzeptiert |
| [0004](0004-folder-note-konvention.md) | Folder-Note-Konvention statt `Readme.md` | akzeptiert |
| [0005](0005-identitaet-und-frontmatter.md) | Identität über `nc_page_id`, Nutzer-Frontmatter wird mit hochgeladen | akzeptiert |
| [0006](0006-lokaler-docker-testserver.md) | Lokaler Docker-Testserver für Verifikation und Integrationstests | akzeptiert |
| [0007](0007-inhalt-per-webdav-metadaten-per-ocs.md) | Inhalt per WebDAV, Metadaten per OCS, kein `touch` | akzeptiert |
| [0008](0008-linkformat-beim-push.md) | Link-Format beim Push: relativ mit `?fileId=` | akzeptiert |
| [0009](0009-anhaenge-per-webdav.md) | Anhänge per WebDAV-PUT statt OCS-Multipart | akzeptiert |
| [0010](0010-collective-umbenennen-ueber-circles.md) | Collective umbenennen über die Circles-API | akzeptiert |
| [0011](0011-mindestversion-und-secret-storage.md) | Obsidian ≥ 1.11.4, App-Passwort im Secret Storage | akzeptiert, Eingabe-UI abgelöst durch 0014 |
| [0012](0012-gleichzeitige-bearbeitung-im-browser.md) | Gleichzeitige Bearbeitung im Browser: ETag-Schutz, kein Session-Handling | akzeptiert |
| [0013](0013-lokalisierung-de-en.md) | Benutzer-Texte auf Deutsch und Englisch nach Obsidian-Sprache | akzeptiert |
| [0014](0014-app-passwort-eingabe-ohne-secretcomponent.md) | App-Passwort über ein Passwortfeld, Secret-ID vergibt das Plugin | akzeptiert |
| [0015](0015-http-fehlerabbildung-und-retry.md) | HTTP-Fehlerabbildung zentral, 403 ≠ `AuthError`, Retry nur für lesende Requests | akzeptiert |
| [0016](0016-pull-frontmatter-textbasiert-und-sync-state.md) | Pull: Frontmatter textbasiert, Sync-State als eigene Datei, Konfliktkopie statt Überschreiben | akzeptiert |
| [0017](0017-push-etag-bestaetigung-und-konfliktaufloesung.md) | Push: bestätigte ETags, Entscheidung als reine Funktion, Konfliktauflösung über den State | akzeptiert |
| [0018](0018-struktur-mehrere-durchlaeufe-rueckfragen-und-platzierung.md) | Struktur: mehrere Durchläufe, Rückfragen als Vorschläge, Platzierung neuer Dateien | akzeptiert |
| [0019](0019-tags-emoji-push-und-tags-eigenschaft.md) | Tags und Emoji: Push über den metaHash, Eigenschaft `tags` bleibt Seiteninhalt | akzeptiert |
| [0020](0020-links-index-anker-und-hash.md) | Links: Seitenindex, Anker unverändert, Hash im Remote-Format | akzeptiert |
| [0021](0021-anhaenge-einbettungen-index-und-abgleich.md) | Anhänge: Einbettungen über den Index, Abgleich über ETags, Schritt nach dem Inhalt | akzeptiert |
