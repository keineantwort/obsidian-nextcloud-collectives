# 0013 – Benutzer-Texte auf Deutsch und Englisch nach Obsidian-Sprache

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §11, AGENTS.md (Code-Stil), Issue ONC-2

## Kontext

Bisher galt: Benutzer-Texte auf Deutsch. Das Plugin soll aber auch Nutzern mit englischer Obsidian-Oberfläche dienen, und eine spätere Veröffentlichung im Community-Store (PLAN §15 #3) setzt Englisch praktisch voraus. In M1 gibt es erst rund 25 Texte – der Umbau ist jetzt billig, später teuer.

## Entscheidung

Alle Benutzer-Texte (Settings, Notices, Modals, Statusleiste) kommen aus `src/i18n/`: `en.ts` definiert die Schlüssel, `de.ts` muss per Typ `Record<MessageKey, string>` vollständig sein. Die Sprache wird beim Laden des Plugins über `getLanguage()` (Obsidian ≥ 1.8.7) bestimmt: `de*` → Deutsch, alles andere → Englisch. Platzhalter im Format `{name}`. Kein Laufzeit-Wechsel nötig, weil Obsidian nach einem Sprachwechsel ohnehin neu startet.

## Betrachtete Alternativen

- **Nur Deutsch** (bisherige Regel) – schließt englischsprachige Nutzer aus.
- **i18n-Bibliothek (z. B. i18next)** – unnötige Abhängigkeit für zwei Sprachen und einfache Platzhalter (AGENTS Regel 8).

## Konsequenzen

- Jeder neue Benutzer-Text braucht einen Schlüssel in `en.ts` und `de.ts`; der Typecheck erzwingt die Vollständigkeit.
- Reine Module (z. B. `connectionMessages.ts`) bekommen einen `Translator` übergeben statt Texte fest zu kodieren.
- Weitere Sprachen sind möglich, indem `Locale` und `resolveLocale` erweitert werden.
