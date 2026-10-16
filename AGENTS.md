# AGENTS.md – Hinweise für Coding-Agents

Projekt: Obsidian-Plugin, das Nextcloud Collectives bidirektional mit einem Vault-Ordner synchronisiert.
**Verbindliche Spezifikation: `PLAN.md`.** Vor jeder Arbeit lesen. Bei Widerspruch zwischen Code und Plan gilt der Plan; Abweichungen nur nach Rückfrage und dann im Plan dokumentieren.

## Arbeitsweise

- Immer genau einen Meilenstein (M0–M10 aus `PLAN.md` §14) pro Branch/PR bearbeiten. Branch-Name: `m<nr>-<kurzname>`, z. B. `m3-pull`.
- Mit M0 beginnen. Keine Implementierung auf Annahmen, die in `PLAN.md` mit [VERIFIZIEREN] markiert und noch nicht bestätigt sind.
- Unklare Anforderungen: nachfragen statt raten.
- Architekturentscheidungen stehen in `docs/adr/`. Vor einer Abweichung den passenden ADR lesen; neue oder geänderte Entscheidungen als neuen ADR im selben PR festhalten (Vorlage `docs/adr/template.md`).
- Vor eigenen Lösungen für Auth, WebDAV-Konflikte oder Mobile-Trigger die Referenzprojekte in `PLAN.md` §18 ansehen. Übernommener Code nur mit passender Lizenz und Quellenangabe.
- Nach Abschluss: Status-Tabelle in `PLAN.md` §17 aktualisieren, Abweichungen und Erkenntnisse in `docs/api-notes.md` bzw. im Plan festhalten.

## Befehle

```bash
npm install
npm run dev          # esbuild watch, schreibt main.js
npm run build        # Typecheck + Produktions-Build
npm run lint         # ESLint inkl. eslint-plugin-obsidianmd
npm test             # Vitest (Unit)
npm run test:int     # Integrationstests, benötigt laufenden Testserver
npm run nc:up        # Docker-Testserver starten (scripts/dev-nextcloud)
npm run nc:down
```


## Harte Regeln

1. Das Plugin muss auf Mobile laufen: keine Node-Module (`fs`, `path`, `crypto` aus Node, `http`), kein Electron, kein `fetch`. HTTP nur über `requestUrl` aus `obsidian`, Hashing über `crypto.subtle`, XML über `DOMParser`.
2. Dateizugriff nur über die Vault-API (`app.vault.process`, `app.fileManager.processFrontMatter`, `app.fileManager.renameFile`). Kein direkter Adapter-Zugriff auf Notizen.
3. `src/sync/planner.ts` und alles in `src/mapping/` bleiben frei von Obsidian- und Netzwerk-Imports und werden vollständig unit-getestet.
4. Niemals Nutzerdaten ohne Rückfrage überschreiben oder löschen. Im Zweifel Konfliktdatei anlegen.
5. Keine Credentials in Logs, Fixtures, Tests oder Commits. Fixtures anonymisieren.
6. Integrationstests nur gegen den lokalen Docker-Testserver, nie gegen produktive Server.
7. TypeScript `strict`; kein `any` ohne Begründungskommentar.
8. Neue Abhängigkeiten nur, wenn sie ohne Node laufen und klein sind; im PR begründen.

## Definition of Done (pro Meilenstein)

- Akzeptanzkriterien aus `PLAN.md` §14 erfüllt.
- `npm run build`, `npm run lint`, `npm test` grün (ab M4 auch `npm run test:int`).
- Neue Logik hat Tests; Planner-Fälle sind einzeln getestet.
- PR-Beschreibung: was umgesetzt wurde, was manuell getestet wurde (Desktop/Mobile), offene Punkte.
- `PLAN.md` §17 aktualisiert.

## Code-Stil

- Dateien und Module wie in `PLAN.md` §5.
- Kleine, reine Funktionen; Seiteneffekte im `executor` und in `main.ts` bündeln.
- Benutzer-Texte (Notices, Settings, Modals) nur über `src/i18n/` in Englisch (`en.ts`) und Deutsch (`de.ts`), siehe ADR 0013. Code und Kommentare auf Englisch.
- Fehler über die Klassen in `src/util/errors.ts`, nicht über rohe Strings.
