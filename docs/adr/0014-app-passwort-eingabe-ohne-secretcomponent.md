# 0014 – App-Passwort über ein Passwortfeld, Secret-ID vergibt das Plugin

- Status: akzeptiert
- Datum: 2026-10-16
- Bezug: PLAN.md §10.1, ADR [0011](0011-mindestversion-und-secret-storage.md), Issue ONC-2

## Kontext

ADR 0011 sah für die Eingabe des App-Passworts Obsidians `SecretComponent` vor. Im manuellen Test von M1 zeigte sich: Die Komponente öffnet einen Dialog, in dem der Nutzer selbst eine Geheimnis-ID vergeben oder auswählen muss. Das ist für eine einmalige Passworteingabe unnötig kompliziert. Die Möglichkeit, ein Secret zwischen Plugins zu teilen, brauchen wir nicht. Mit dem Login Flow (M9) legt das Plugin das Passwort ohnehin selbst ab.

## Entscheidung

Der Settings-Tab zeigt ein normales Passwortfeld. Beim Bestätigen (Verlassen des Felds bzw. Enter) speichert das Plugin den Wert per `app.secretStorage.setSecret(id, …)`. Die ID erzeugt das Plugin beim ersten Speichern zufällig (`nextcloud-collectives-` + 16 Hex-Zeichen) und legt sie in `data.json` ab. Eine bereits vorhandene gültige ID wird weiterverwendet. Das Feld zeigt das gespeicherte Passwort nie an, nur einen Platzhalter „Gespeichert – zum Ersetzen neu eingeben“. Ein leeres Feld ändert nichts.

Weiterhin gilt aus ADR 0011: Obsidian ≥ 1.11.4, Passwort nur im Secret Storage, nie im Klartext in `data.json`.

## Betrachtete Alternativen

- **`SecretComponent` behalten** – Obsidian-Standard, aber unnötiger Dialog mit ID-Vergabe für den Nutzer.
- **Feste Secret-ID** (z. B. `nextcloud-collectives-app-password`) – einfacher, aber zwei Vaults mit unterschiedlichen Servern könnten sich das Secret teilen, falls der Secret Storage vault-übergreifend ist.

## Konsequenzen

- Einfachere Einrichtung; die Secret-ID ist für Nutzer unsichtbar.
- Ein gespeichertes Passwort lässt sich im Feld nicht ansehen, nur ersetzen.
- Löschen des Passworts ist in M1 nicht vorgesehen; ggf. mit dem Login Flow (M9) nachziehen.
