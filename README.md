# KI-Trainingsspiele

- `q-arena/`: **Q-Arena**, eine installierbare PWA. Trainiere einen KI-Kämpfer mit Q-Learning auf einem 5×5-Feld.
- `tic-tac-q.html`: **Tic-Tac-Q Labor**, ein Tic-Tac-Toe-Agent mit Q-Learning (eine einzelne Datei).
- `index.html`: Startseite mit Links auf beide Spiele.

## Veröffentlichen mit GitHub Pages

1. Ein neues Repository auf GitHub anlegen, z. B. `ki-trainingsspiele`.
2. Diesen Ordner hochladen: entweder per Weboberfläche ("Add file → Upload files") oder per Git:
   ```bash
   git init
   git add .
   git commit -m "Q-Arena und Tic-Tac-Q"
   git branch -M main
   git remote add origin https://github.com/<benutzer>/ki-trainingsspiele.git
   git push -u origin main
   ```
3. Im Repository unter **Settings → Pages** als Quelle "Deploy from a branch", Branch `main`, Ordner `/ (root)` wählen.
4. Nach etwa einer Minute ist das Spiel erreichbar unter `https://<benutzer>.github.io/ki-trainingsspiele/q-arena/`.

## Q-Arena aufs Handy

- **Android (Chrome):** Seite öffnen, dann im Menü "App installieren" oder den Button "Installieren" oben in der App.
- **iPhone (Safari):** Seite öffnen, Teilen-Symbol, "Zum Home-Bildschirm".
- Nach dem ersten Öffnen läuft alles offline. Nur Online-Duelle brauchen Internet.
- Der Spielstand liegt nur auf dem Gerät. Sicherung über **Agent → Spielstand → Als Datei sichern**.

## Online-Duell: Einladung per QR-Code oder Link

1. **Duell → Duell erstellen** zeigt einen QR-Code mit dem Einladungslink sowie „Link teilen“ und „Link kopieren“.
2. Der Gegner scannt den Code mit der Handykamera oder tippt den Link an. Q-Arena öffnet sich und tritt automatisch bei.
3. Der Gegner zeigt dir seinen Antwort-QR-Code oder schickt dir seinen Antwortlink:
   - **QR-Code scannen** direkt in der App. Das geht nur in Browsern mit Barcode-Erkennung, vor allem Chrome auf Android.
   - **Antwortlink antippen** auf dem Gerät, auf dem du das Duell erstellt hast. Die Antwort landet automatisch im wartenden Duell. Das gilt für die installierte App (Chrome/Edge) und für ein zweites Browserfenster.
   - Oder Link bzw. Code ins Feld einfügen.

Einschränkung auf dem iPhone: Links öffnen sich immer in Safari, nicht in der installierten App. Safari zeigt dann einen Hinweis mit „Code kopieren“. Den Code fügst du in der App ein.

Der Link ist nur für dieses eine Duell gültig. Er enthält die Verbindungsdaten des Geräts, aber keine Spielstände oder persönlichen Daten.

## Sprachen

Q-Arena gibt es auf Deutsch und Englisch, umschaltbar oben rechts. Beim ersten Start richtet sich die Sprache nach dem Gerät. Die Wahl wird gespeichert und gilt unabhängig vom Spielstand.

Neue Sprache hinzufügen: In `q-arena/js/i18n.js` ein weiteres Wörterbuch nach dem Muster von `en` anlegen, es in `DICT` und `LANGS` eintragen und bei `LOCALE` das Zahlenformat ergänzen. Fehlende Einträge fallen automatisch auf Deutsch zurück.

## Updates ausrollen

Der Service Worker hält alle Dateien offline vor. Nach jeder Änderung an Dateien in `q-arena/` in `q-arena/sw.js` die Konstante `VERSION` erhöhen (z. B. `qarena-v2`). Installierte Apps zeigen dann "Neue Version verfügbar".

## Lokal testen

```bash
python -m http.server 8123 --directory q-arena
```
Dann `http://localhost:8123` öffnen. Ein Doppelklick auf `index.html` reicht nicht, weil ES-Module und Service Worker einen Webserver brauchen.

## Aufbau von Q-Arena

| Datei | Inhalt |
|---|---|
| `js/engine.js` | Kampfregeln, Ausrüstung, deterministische Rundenauflösung |
| `js/brain.js` | Sensoren, Q(λ)-Learning, Taktiken, Liga-Gegner, Kampfkraft-Messung |
| `js/net.js` | Online-Duell über WebRTC mit Code-Austausch, ohne eigenen Server |
| `js/app.js` | Oberfläche, Spielstand, Kampfansicht, Shop |
| `js/i18n.js` | Alle Texte der Oberfläche auf Deutsch und Englisch |
| `js/qr.js` | QR-Code-Erzeugung für Einladungen, ohne externe Bibliothek |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: Offline-Cache, Installation, App-Icons |
