# 0011 – Obsidian ≥ 1.11.4, App-Passwort im Secret Storage

- Status: akzeptiert; Eingabe-UI abgelöst durch [0014](0014-app-passwort-eingabe-ohne-secretcomponent.md)
- Datum: 2026-10-16
- Bezug: PLAN.md §3, §10.1, ONC-1

## Kontext

Das App-Passwort darf nicht im Klartext in `data.json` liegen. Obsidian bietet `app.secretStorage` (`@since 1.11.4`) und `SecretComponent` (`@since 1.11.1`); die deklarative Settings-API kommt erst mit 1.13.0 und kennt keinen Secret-Typ.

## Entscheidung

`minAppVersion` = 1.11.4. Das App-Passwort wird über `app.secretStorage` gespeichert, in `data.json` steht nur die Secret-ID. Der Settings-Tab ist ein klassischer `PluginSettingTab` mit `SecretComponent`.

## Betrachtete Alternativen

- **Minimum 1.13.0 wie Nextcloud Sync** – kein Nutzen, solange wir die deklarative API nicht brauchen.
- **Eigene Verschlüsselung mit Schlüssel im `localStorage`** (wie NextDeck) – faktisch Klartext.

## Konsequenzen

- Ältere Obsidian-Versionen werden nicht unterstützt.
