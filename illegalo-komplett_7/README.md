# Illegalo Gamecenter — Setup Guide

Läuft über das **gleiche Firebase-Projekt wie Illegalo** (`illegalo-shopzone`) — kein eigenes
Gamecenter-Projekt mehr. Firestore UND Realtime Database laufen beide innerhalb von
`illegalo-shopzone` nebeneinander (das ist technisch kein Problem, ein Projekt kann beides haben).

## Was sich geändert hat (falls du das alte Setup schon kennst)
- ❌ Kein eigenes Firebase-Projekt (`multiplayer-games-163ee`) mehr — alles läuft über `illegalo-shopzone`
- ❌ Kein Service-Account, kein `isAdmin`-Flag, kein `GC_SERVICE_EMAIL`/`GC_SERVICE_PASSWORD` mehr — der Kill-Switch in `admin.html`/`dev.html` schreibt direkt in die gleiche Firestore, ohne Extra-Login
- ✅ Online-Status läuft weiterhin über **Realtime Database** mit echtem `onDisconnect` (sofort "offline" wenn wer den Tab schließt) — nur jetzt als eigene Realtime Database *innerhalb* von `illegalo-shopzone`, nicht mehr im separaten Projekt
- ✅ Spieler-Accounts (Login/Register fürs Gamecenter selbst) laufen weiterhin über echtes Firebase Auth — das bleibt, nur das Projekt drumherum hat sich geändert

## Dateistruktur — alles flach im selben Repo wie Illegalo
Kommt 1:1 in den gleichen Repo-Root wie `shop.html`, `admin.html`, `dev.html`, `lieferant.html` & Co.
Kein Unterordner. Die paar überlappenden Dateinamen haben `gc-`-Prefix:

| Gamecenter-Datei | Wofür |
|---|---|
| `gc-index.html` | Login/Register fürs Gamecenter |
| `lobby.html`, `lobby.js` | Online-Liste, Invites, Spielauswahl |
| `game.html`, `game.js` | Tic-Tac-Toe (1v1) |
| `snakeio.html`, `snakeio.js` | Snake.io — echtes geteiltes Live-Feld (1v1) |
| `katapult.html`, `katapult.js` | Katapult Tower — Duell mit Hindernissen (1v1) |
| `snake.html`, `snake.js` | Snake — Solo-Arcade mit Leaderboard |
| `auth.js`, `maintenance.js`, `firebase-config.js`, `style.css` | Geteilte Logik/Styles |
| `firestore.rules` | Security Rules für Illegalo **und** Gamecenter zusammen (ein File) |
| `database.rules.json` | Security Rules für die Realtime Database (Online-Status) |

## 1. Email/Password Login aktivieren
Firebase Console → Projekt **`illegalo-shopzone`** → **Authentication** → Tab **Sign-in method** →
**Email/Password** → aktivieren & speichern. Ohne den Schritt funktioniert `gc-index.html` nicht.

## 2. Realtime Database anlegen (falls noch nicht getan)
Firebase Console → Projekt **`illegalo-shopzone`** → **Realtime Database** → **Create Database** →
Standort wählen → **locked mode**. Die URL sieht danach so aus:
`https://illegalo-shopzone-default-rtdb.europe-west1.firebasedatabase.app`
— diese URL muss in `firebase-config.js` bei `databaseURL` stehen (ist schon eingetragen, falls deine
URL anders aussieht musst du sie dort anpassen).

## 3. Rules deployen
**Firestore:** Projekt `illegalo-shopzone` → **Firestore Database** → Tab **Rules** → Inhalt komplett
ersetzen durch `firestore.rules` (deckt Illegalo UND Gamecenter ab) → **Publish**.

**Realtime Database:** gleiches Projekt → **Realtime Database** → Tab **Rules** → Inhalt ersetzen
durch `database.rules.json` → **Publish**.

## 4. Website hosten
Einfach mit den restlichen Illegalo-Dateien zusammen hochladen (GitHub Pages, gleicher Repo-Root).
Läuft dann unter `https://maxipribil2-glitch.github.io/caprisun/gc-index.html`.

## 5. Testen
- Zwei Browserfenster (eins davon Inkognito, sonst teilen sie sich den Login)
- In jedem mit anderem Account registrieren
- Im einen Fenster sollte der andere User unter "Online jetzt" auftauchen — sofort, kein Delay
- Tab schließen → User verschwindet sofort aus der Liste im anderen Fenster (`onDisconnect`)
- Invite schicken → annehmen → beide landen im Spiel

## Kill-Switch (admin.html / dev.html)
Beide haben einen "🎮 Gamecenter"-Bereich mit Online/Offline-Toggle + Live-Anzeige wie viele Spieler
online sind (liest direkt aus der Realtime Database, kein eigenes Auth nötig dafür). Der Toggle selbst
schreibt in `gcConfig/site` auf der gleichen Firestore, die admin.html/dev.html eh schon nutzen —
braucht kein Setup, einfach benutzen.

## Aktueller Stand
- Login/Register — **nur Username + Passwort** ✅ (kein Email-Feld nötig, läuft im Hintergrund auf `username@mpgames.local`)
- Online-Status über Realtime Database mit echtem `onDisconnect` ✅ (sofortige Erkennung, kein Heartbeat-Delay)
- Invite-System (1v1, mit Gegner-Auswahl) ✅
- **4 Spiele:**
  - **Tic-Tac-Toe** — 1v1 per Invite, rundenbasiert, synced über Firestore
  - **Snake.io (1v1)** — 1v1 per Invite, echtes geteiltes Live-Feld (Echtzeit). Einer der beiden Clients (wer eingeladen hat) ist "Authority" und schreibt den vollen State alle 220ms, der andere schreibt nur seine eigene Richtungsänderung
  - **Katapult Tower (1v1)** — 1v1 per Invite, rundenbasiert wie Tic-Tac-Toe. Zwei Katapulte gegenüber, 3 Hindernisse (je 1 Treffer zerstörbar), wer als erstes die Gegner-Figur trifft gewinnt
  - **Snake** — Solo-Arcade, kein Invite nötig, eigener Highscore + globales Leaderboard (`scores`-Collection)
- Kill-Switch + Online-Spielerzahl integriert in Illegalo-`admin.html` **und** `dev.html`, kein eigenständiges Gamecenter-Admin-Panel ✅
- Rebranding auf "Illegalo Gamecenter" durchgezogen + Verlinkung zurück zu Illegalo ✅
- Design: dark theme im Illegalo-Stil (Inter Font, Indigo/Amber/Grün Akzente, Caveat-Signatur unten links, Versionsnummer unten rechts)

## Wieso "Email" in der Firebase Console steht, obwohl es kein Email-Feld gibt
Firebase Auth braucht technisch immer eine Email. Der Username wird deshalb im Hintergrund automatisch zu
`username@mpgames.local` gemacht (sieht man nur in der Firebase Console unter Authentication, nie für den User selbst).
Das heißt auch: Usernamen müssen einzigartig sein — ist einer schon vergeben, bekommt man "Dieser Username ist schon vergeben."

## Neues Spiel hinzufügen

**1v1-Spiel (per Invite, wie Tic-Tac-Toe, Snake.io oder Katapult Tower):**
1. In `lobby.js` das `GAMES` Array erweitern (`{ id: "...", name: "..." }`)
2. In `buildRoomData()` (`lobby.js`) einen Fall für deine neue `inv.game`-ID ergänzen — was für Start-State braucht dein Spiel im `rooms`-Dokument?
3. In `gamePage()` (`lobby.js`) die passende HTML-Datei für deine Game-ID zurückgeben
4. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snakeio.html`/`snakeio.js` (Echtzeit) oder `game.html`/`game.js` (rundenbasiert)
5. `rooms`-Collection-Regel in `firestore.rules` ist generisch genug für die meisten Fälle — meist keine Änderung nötig

**Solo-Arcade-Spiel (wie Snake, kein Invite nötig):**
1. In `lobby.js` das `ARCADE_GAMES` Array erweitern (`{ id: "...", name: "...", icon: "...", page: "gamename.html" }`)
2. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snake.html`/`snake.js` — Score am Ende in die `scores`-Collection schreiben (`game: "deine-id"`) fürs gemeinsame Leaderboard
3. In `firestore.rules` bei der `scores`-Regel deine neue Game-ID zur erlaubten Liste hinzufügen (`request.resource.data.game in [...]`)
