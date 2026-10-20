# Manuelle Testcheckliste (iOS und Android)

Gilt für M9 (PLAN §14). Jeden Punkt auf **iOS** und **Android** abhaken; Fehler mit Gerät, Obsidian- und Nextcloud-Version festhalten. Verwende einen **neuen, leeren Vault** und einen Testserver bzw. ein Test-Konto – keine produktiven Daten.

Gerät/OS: ______  Obsidian: ______  Nextcloud/Collectives: ______  Datum: ______

## 0. Installation auf dem Handy

Das Plugin ist nicht im Community-Store (PLAN §15 Nr. 3). Zwei Wege:

- **BRAT** (empfohlen): In Obsidian Mobile das Plugin „BRAT“ installieren, „Add beta plugin“ mit dem Repository-URL, danach in „Community plugins“ aktivieren.
- **Manuell**: `main.js`, `manifest.json` und `styles.css` in `<Vault>/.obsidian/plugins/nextcloud-collectives/` legen (z. B. über die Dateien-App/iCloud auf iOS, per USB oder Nextcloud-App auf Android), Obsidian neu starten, Plugin aktivieren. Der Ordner `.obsidian` ist auf dem Handy versteckt: ggf. den Vault von einem Desktop aus mit dem Plugin vorbereiten.

- [ ] iOS: Plugin erscheint unter „Community plugins“ und lässt sich aktivieren
- [ ] Android: dasselbe

## 1. Anmeldung

- [ ] Server-URL eingeben, „Anmelden“ (Login Flow) tippen: Der Browser öffnet die Nextcloud-Anmeldeseite
- [ ] Nach Bestätigung im Browser und Rückkehr zu Obsidian sind Benutzername und App-Passwort-Platzhalter („Gespeichert“) gesetzt – ohne manuelles Kopieren
- [ ] Wird der Browser nicht geöffnet, funktioniert der Link „Anmeldeseite erneut öffnen“
- [ ] „Abbrechen“ beendet das Warten; „Verbindung testen“ meldet danach die Zahl der Collectives
- [ ] Falsche Server-URL: verständliche Fehlermeldung statt Absturz
- [ ] Alternativ: App-Passwort von Hand eingeben, Verbindungstest erfolgreich

## 2. Erster Sync und Automatik

- [ ] „Jetzt synchronisieren“ (Ribbon-Icon) lädt alle Collectives; ein Ergebnis-Notice erscheint
- [ ] Plugin-Start bei laufender Verbindung: Nach wenigen Sekunden läuft ein Sync ohne Notice (Einstellung „Beim Start synchronisieren“)
- [ ] Notiz bearbeiten, Tippen beenden: ca. 10 s später ist die Änderung in Nextcloud (Einstellung „Nach Änderungen synchronisieren“)
- [ ] Änderung in Nextcloud, Obsidian in den Hintergrund und zurück in den Vordergrund holen: Die Änderung erscheint ohne manuelles Auslösen
- [ ] Intervall 1 Minute einstellen: Änderung in Nextcloud kommt innerhalb ca. 1 Minute an, solange Obsidian im Vordergrund ist
- [ ] Intervall 0, „Beim Start“ und „Nach Änderungen“ aus: Es passiert nichts von selbst; „Jetzt synchronisieren“ funktioniert weiter
- [ ] Mehrere schnelle Änderungen hintereinander lösen nur einen Sync aus; während eines Syncs ausgelöste Änderungen laufen danach noch einmal (kein Parallel-Lauf, keine Fehlermeldung)

## 3. Ruhige Läufe und Fehler

- [ ] Flugmodus, Notiz ändern, 10 s warten: keine Fehlermeldung. Flugmodus aus, Foreground-Wechsel: Änderung wird hochgeladen
- [ ] Ungültiges App-Passwort (in Nextcloud widerrufen): Der nächste automatische Lauf zeigt **einmal** eine Fehlermeldung, danach laufen keine automatischen Läufe mehr; nach erneuter Anmeldung (oder Speichern der Einstellungen) wieder
- [ ] Notiz lokal löschen, 10 s warten: Es erscheint kein Dialog mitten im Schreiben, sondern der Hinweis „Einige Änderungen brauchen deine Entscheidung“; „Jetzt synchronisieren“ zeigt dann die Rückfrage

## 4. Sonstiges

- [ ] Umbenennen, Verschieben, Anhang einfügen (Bild per Foto): kommt in Nextcloud an
- [ ] Konflikt (gleiche Seite lokal und in Nextcloud geändert): Konfliktkopie, Hinweis, Konflikt-Dialog bedienbar (Touch-Größen, Scrollen)
- [ ] Deutsche und englische Oberfläche: Texte vollständig (Obsidian-Sprache umstellen, neu starten)
- [ ] Akkuverbrauch/Hitze nach 30 Minuten im Vordergrund unauffällig

## 5. Performance (Desktop, Testserver im LAN)

- [ ] Collective mit ≥ 500 Seiten: Leerlauf-Sync (nichts geändert) dauert < 5 s. Der Integrationstest `tests/integration/performance.test.ts` prüft das automatisiert gegen den Docker-Testserver.

## 6. Diagnose (M10)

- [ ] „Protokoll anzeigen“ (Befehl und Einstellungen) öffnet das Protokoll; „Protokoll kopieren“ legt es in die Zwischenablage; kein Passwort darin
- [ ] Mit „Ausführliches Protokoll“ stehen die Anfragen (Methode, Pfad, Status) im Protokoll
- [ ] Server mit nicht getesteter Nextcloud-Version: eine Warnung, danach läuft der Sync
