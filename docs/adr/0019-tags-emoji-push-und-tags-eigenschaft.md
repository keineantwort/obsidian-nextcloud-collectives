# 0019 – Tags und Emoji: Push über den metaHash, Eigenschaft `tags` bleibt Seiteninhalt

- Status: akzeptiert
- Datum: 2026-10-17
- Bezug: PLAN.md §6.2, §7.5, §10.2, §14 M6, Issue ONC-7 (M6)

## Kontext

M3 schreibt Emoji und Tags vom Server in die Notiz (`nc_emoji`, `nc_tags`, `metaHash`). M6 ergänzt die Gegenrichtung und die Option `tagsProperty`. Offen waren: Woran erkennt der Lauf, dass der Nutzer Emoji oder Tags geändert hat, ohne den Planner um Dateiinhalte zu erweitern? Was gilt bei `tagsProperty = tags` für den Seitentext? Was passiert mit den Tags beim Verschieben in ein anderes Collective?

## Entscheidung

- **Erkennung im Executor, nicht im Planner.** Eine Notiz mit geänderten Feldern hat eine neue mtime, der Planner plant dafür schon `push` (oder `update`). Der Executor liest die Datei dort ohnehin; `executorMeta.ts` vergleicht Emoji und Tags der Notiz mit dem `metaHash` des States (Tags vorher auf die Schreibweise des Servers abgebildet). Der Scan bleibt billig, der Planner rein. Der Leerlauf-Lauf liest keine zusätzlichen Dateien.
- **Dieselbe Entscheidung wie beim Inhalt** (auf Wunsch des Nutzers, 2026-10-17; ersetzt die Regel „Remote gewinnt“ aus PLAN §7.5 und die erste Fassung dieses ADR). `decideMeta` ruft `decideContent` auf den Hashes von Emoji und Tags auf: Basis = `metaHash` im State, lokal = Felder der Notiz, remote = Hash der Serverwerte. Nur die Notiz geändert → Push zum Server, danach schreibt der Lauf die `nc_*`-Felder in der Schreibweise des Servers neu. Nur der Server geändert → seine Werte in die Notiz. Beide gleich → nur die Basis rückt. Beide verschieden → `conflictStrategy`: `preferLocal` pusht, `preferRemote` übernimmt die Serverwerte, `conflictFile` lässt die Notiz unverändert, legt eine Konfliktkopie mit den Serverwerten an (`nc_emoji`/`nc_tags` ohne Seiten-ID) und setzt die Seite auf `conflict`; der `metaHash` rückt dabei auf die Serverwerte. Der Konflikt-Dialog gilt unverändert: „Lokal behalten“ pusht beim nächsten Lauf die Werte der Notiz, „Remote übernehmen“ setzt den `metaHash` auf die Werte der Notiz, sodass der nächste Lauf die Serverwerte übernimmt. Eine Seite, die schon als Konflikt wartet, wird nicht erneut angefasst. Zieht ein `update` einen Remote-Text, gehen die Änderungen der Notiz zuerst zum Server (bzw. bleiben bei `conflictFile` in der Datei).
- **Der `metaHash` enthält den Titel nicht mehr** (`metaHash(emoji, tags)`): Nur so lässt sich „hat der Nutzer geändert?“ aus Hashes beantworten, ohne den früheren Titel zu kennen. Eine Umbenennung ist ohnehin eine Strukturänderung (M5). Gespeicherte Hashes aus M3–M5 passen einmalig nicht mehr: Stimmen Notiz und Server überein, rückt nur die Basis; sonst gilt der Server (unbekannte Basis `''` übernimmt immer die Serverwerte).
- **Tag-Anlage.** Namen werden case-insensitiv gegen den Tag-Cache des Collectives geprüft (exakter Treffer zuerst), nur fehlende Tags werden mit Farbe `0082c9` angelegt. Lehnt der Server als Duplikat ab (anderer Client war schneller, andere Collation), liest der Lauf die Tags neu und verwendet den vorhandenen. Der Cache im State wird mitgeführt.
- **Entfernen des Emojis** sendet `""`: Der Server ignoriert ein JSON-`null` (Testserver Nextcloud 33; Antwort `emoji: null`, der nächste `GET` liefert das alte Emoji; berichtigt M0). Gelesen wird `""` wie `null`.
- **`tagsProperty = tags`** (auf Wunsch des Nutzers, 2026-10-17): Die Eigenschaft `tags` wird vom Plugin geschrieben (Namen mit `-` statt Leerzeichen, daneben bleibt `nc_tags` mit den Namen des Servers), aber **nicht** aus dem Text entfernt. Sie ist Seiteninhalt und wird hochgeladen, damit Tags auf allen Geräten und im Web sichtbar sind. Folge: Eine Tag-Änderung ist auch eine Inhaltsänderung (zusätzlicher Inhalts-Push, danach konvergiert der Lauf). Das ändert PLAN §6.2 („nur `nc_*` entfernt“) nicht; der Modus ergänzt nur das Schreiben. Gelesen wird `tags` (Listen als `[a, b]`, Blockliste, Skalar); fehlt die Eigenschaft oder ist sie nicht lesbar (Liste über mehrere Zeilen), gilt `nc_tags` (Wechsel der Einstellung löscht so keine Server-Tags). Rückabbildung: `a-b` ↔ Tag `a b`, Vergleich ohne Beachtung der Schreibweise.
- **Neue Notiz mit Tags/Emoji:** Beim Anlegen der Seite gehen die Werte der Notiz zum Server (in `tags` nur im Modus `tags`); sie werden nicht von den `nc_*`-Feldern überschrieben.
- **Collective-übergreifendes Verschieben:** Die Tags gehen serverseitig verloren (api-notes). Nach dem Verschieben weist der Lauf die Tags der Notiz (und der Unterseiten mit Datei) im Zielcollective neu zu und legt fehlende an. Scheitert das bei einer Unterseite, übernimmt der nächste Lauf die Metadaten des Servers.

- **Default `tagsProperty = tags`** (Nachtrag 2026-10-17): Wer in Obsidian die Eigenschaft `tags` setzt, erwartet Collectives-Tags. Mit dem Default `nc_tags` landete sie nur als Text auf der Seite („Block mit tags: …“), ohne dass Tags zugewiesen wurden.
- **`#Tags` im Text (Modus `tags`):** `readLocalFields` ergänzt die Tags der Eigenschaft um die `#Tags` des Textes (ohne Code, Überschriften, Links; `src/mapping/tags.ts`, `inlineTags`). Sie gehen als Tags zum Server und stehen danach in der Eigenschaft. Inline-Tags **fügen nur hinzu**: Entfernst du ein `#Tag` aus dem Text, bleibt es in der Eigenschaft und auf der Seite; wer es loswerden will, löscht es dort. Der Text selbst wird nie umgeschrieben.
- **Anzeige statt Umbenennung (nur Darstellung):** Die Eigenschaften behalten ihre technischen Schlüssel. `styles.css` zeigt in der Eigenschaften-Ansicht statt `nc_page_id` usw. einen lokalisierten Namen (Seiten-ID, Collectives-Tags, …), den das Plugin als CSS-Variable setzt (`src/ui/propertyLabels.ts`); das Eingabefeld des Schlüssels ist für diese Eigenschaften ausgeblendet. Das Emoji der Seite erscheint vor dem Titel in Dateiliste, Notiz-Kopf und Inline-Titel (`src/ui/emojiTitles.ts`, Einstellung `showEmojiInTitles`); der Dateiname bleibt unverändert. Beides stützt sich auf Obsidians DOM-Klassen (nicht öffentliche Schnittstelle) und fällt bei Änderungen auf die normale Anzeige zurück. Tab-Titel werden nicht ergänzt (kein öffentlicher Zugriff).

## Alternativen

- Lokale Metadaten im Scan lesen und im Planner vergleichen: liest bei jedem Lauf jede Datei, widerspricht dem Leerlauf-Ziel (M9).
- `tags` aus dem Seitentext entfernen: kein Plan-Widerspruch, aber Tags wären im Web-Text unsichtbar und Obsidian-Tags auf anderen Geräten nur über das Plugin verfügbar. Vom Nutzer verworfen.

## Folgen

- `SyncResult.metaPushed` zählt gesendete Änderungen; die Notice nennt sie.
- Nach einer lokalen Tag-Änderung im Modus `tags` folgt ein zweiter, inhaltlicher Upload (die Schreibweise der Eigenschaft wird normalisiert).
