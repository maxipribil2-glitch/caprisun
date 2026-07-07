# Illegalo Gamecenter — Setup Guide

Läuft über das **gleiche Firebase-Projekt wie Illegalo** (`illegalo-shopzone`) — kein eigenes
Gamecenter-Projekt mehr. Firestore UND Realtime Database laufen beide innerhalb von
`illegalo-shopzone` nebeneinander (das ist technisch kein Problem, ein Projekt kann beides haben).

**Design:** komplett eigener Retro-Arcade-Look (Pixel-Font "Press Start 2P", Terminal-Font "VT323",
Neon-Glow, CRT-Scanline-Overlay) — eigenständig vom normalen Illegalo-Dark-Theme, das bei Shop/Admin/
Dev/Lieferant bleibt wie's war. Alles über `style.css`, eine Datei für alle Gamecenter-Seiten.

## ⚠️ KRITISCH — DAS HIER ZUERST MACHEN, SONST KOMMST DU NICHT MEHR INS ADMIN/DEV/LIEFERANT PANEL

`admin.html`, `dev.html` und `lieferant.html` loggen sich jetzt über **echtes Firebase Auth** ein
(statt dem alten Passwort-Hash-Vergleich im Browser). Das heißt: die 4 Accounts müssen **manuell in
der Firebase Console angelegt werden, BEVOR du die neuen Files hochlädst** — sonst kann sich niemand
mehr einloggen, auch du nicht.

**Firebase Console → Projekt `illegalo-shopzone` → Authentication → Users → "Add user"** — 4x:

| Email | Passwort | Für |
|---|---|---|
| `maxipribil@illegalo.local` | `Caprjsw9` | Admin Panel + Dev Panel |
| `henrikstelzner@illegalo.local` | `admin01` | Admin Panel |
| `philippstangl@illegalo.local` | `Elmau2026!` | Lieferant |
| `giannihay@illegalo.local` | `service01` | Lieferant |

Das sind exakt die gleichen Usernamen/Passwörter wie vorher — ihr loggt euch weiterhin nur mit dem
**Username** ein (z.B. `maxipribil`, nicht die Email), die Email ist nur ein interner Firebase-Trick
im Hintergrund (gleiches Prinzip wie beim Gamecenter, `@illegalo.local` statt `@mpgames.local`).

**Außerdem:** `firestore.rules` neu deployen (Inhalt komplett ersetzt, neue Regeln brauchen die Auth-
Accounts oben, um zu greifen) — Firebase Console → Firestore Database → Rules → Inhalt von
`firestore.rules` reinpasten → Publish.

Email/Password-Login sollte in `illegalo-shopzone` schon aktiviert sein (falls du das Gamecenter
schon eingerichtet hast) — falls nicht: Authentication → Sign-in method → Email/Password aktivieren.

**Was sich für euch im Alltag ändert:** nichts! Gleicher Login-Bildschirm, gleicher Username, gleiches
Passwort. Nur dahinter steckt jetzt echtes Firebase Auth statt einem reinen Hash-Vergleich — Bots mit
dem öffentlichen API-Key können jetzt nicht mehr einfach Bestellungen löschen oder den Kill-Switch
umlegen, weil sie keine echten Zugangsdaten haben.

## Was sich geändert hat (falls du das alte Setup schon kennst)
- ❌ Kein eigenes Firebase-Projekt (`multiplayer-games-163ee`) mehr — alles läuft über `illegalo-shopzone`
- ❌ Kein Service-Account, kein `isAdmin`-Flag, kein `GC_SERVICE_EMAIL`/`GC_SERVICE_PASSWORD` mehr — der Kill-Switch in `admin.html`/`dev.html` schreibt direkt in die gleiche Firestore, ohne Extra-Login
- ✅ Online-Status läuft weiterhin über **Realtime Database** mit echtem `onDisconnect` (sofort "offline" wenn wer den Tab schließt) — nur jetzt als eigene Realtime Database *innerhalb* von `illegalo-shopzone`, nicht mehr im separaten Projekt
- ✅ Spieler-Accounts (Login/Register fürs Gamecenter selbst) laufen weiterhin über echtes Firebase Auth — das bleibt, nur das Projekt drumherum hat sich geändert
- ✅ **NEU:** Illegalo-Personal (Admin/Dev/Lieferant) loggt sich jetzt auch über echtes Firebase Auth ein (siehe ⚠️ oben) — keine Passwort-Hashes mehr im Quellcode sichtbar

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
| `connect4.html`, `connect4.js` | Vier Gewinnt (1v1) |
| `pong.html`, `pong.js` | Pong — Echtzeit-Duell (1v1) |
| `snake.html`, `snake.js` | Snake — Solo-Arcade mit Leaderboard |
| `breakout.html`, `breakout.js` | Breakout — Solo-Arcade mit Leaderboard |
| `stats.html`, `stats.js` | Bilanz-Seite (Gesamtwertung, pro Spiel, letzte Matches) |
| `sfx.js` | Geteiltes Sound-Modul (Web Audio Beeps, kein Audiofile nötig) |
| `ads.js` | Cross-Promo-Banner zurück zum Illegalo Shop (zufälliger Spruch) |
| `tests/`, `package.json`, `playwright.config.js` | Lokale Smoke-Tests (Playwright) — siehe `tests/README.md`, läuft NICHT auf GitHub Pages |
| `auth.js`, `maintenance.js`, `firebase-config.js`, `style.css` | Geteilte Logik/Styles (Retro-Arcade-Look) |
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
- **5 Spiele im 1v1-Modus (per Invite):**
  - **Tic-Tac-Toe** — rundenbasiert, synced über Firestore
  - **Snake.io** — echtes geteiltes Live-Feld (Echtzeit). Einer der beiden Clients (wer eingeladen hat) ist "Authority" und schreibt den vollen State alle 220ms, der andere schreibt nur seine eigene Richtungsänderung
  - **Katapult Tower** — rundenbasiert wie Tic-Tac-Toe. Zwei Katapulte gegenüber, 3 Hindernisse (je 1 Treffer zerstörbar), wer als erstes die Gegner-Figur trifft gewinnt
  - **Vier Gewinnt** — rundenbasiert, klassisches 7x6-Feld, 4 in eine Reihe (horizontal/vertikal/diagonal) gewinnt
  - **Pong** — Echtzeit wie Snake.io (Authority-Pattern), eigenes Paddle per Pfeiltasten/WASD/Touch-Buttons, erster bis 5 Punkte gewinnt
- **2 Solo-Arcade-Spiele (kein Invite nötig):**
  - **Snake** — eigener Highscore + globales Leaderboard (`scores`-Collection)
  - **Breakout** — klassischer Brick-Breaker, 3 Leben, eigenes Leaderboard
- Kill-Switch + Online-Spielerzahl integriert in Illegalo-`admin.html` **und** `dev.html`, kein eigenständiges Gamecenter-Admin-Panel ✅
- Rebranding auf "Illegalo Gamecenter" durchgezogen + Verlinkung zurück zu Illegalo ✅
- Design: eigener Retro-Arcade-Look (Pixel-Font, Neon-Glow, CRT-Scanlines) — siehe oben
- **Sound-Effekte** ✅ — Web-Audio-Beeps (keine Audiodateien), Zug/Treffer/Sieg/Niederlage/Unentschieden, in allen 7 Spielen
- **Faires Rematch** ✅ — Startspieler bei Rematch/neuer Ball-Richtung wird zufällig bestimmt, nicht mehr immer der gleiche
- **Emoji-Reaktionen** ✅ — 4 Buttons (🔥😂😡👏) in allen 5 1v1-Spielen, Gegner sieht's als kurzes Popup
- **Bilanz-Seite** (`stats.html`) ✅ — Gesamtwertung, Siege pro Spiel, letzte 10 Matches. Basiert auf einer neuen `matchResults`-Collection (append-only Log, jedes Spiel schreibt automatisch sein Ergebnis rein)
- **Shop:** "Nochmal wie letztes Mal"-Button (übernimmt Artikel/Kategorie/Notiz aus dem letzten Post), geschätzte Lieferzeit-Anzeige (gleiche Berechnung wie Admin-Dashboard, aus den letzten ~15 Lieferungen), 10-Sekunden-Cooldown zwischen Bestellungen (clientseitig, verhindert Versehen/Spam — kein Ersatz für echten Server-Schutz, aber besser als nix)
- **Firebase Auth für Illegalo-Personal** ✅ — siehe ⚠️ Setup-Hinweis oben, das ist der wichtige Teil
- **Smoke-Tests** (Playwright, `tests/`) ✅ — lädt jede Seite, checkt auf JS-Fehler. Läuft lokal, nicht auf GitHub Pages, siehe `tests/README.md`
- **Cross-Promo-Banner zum Illegalo Shop** ✅ (`ads.js`) — auf Lobby, Login, Bilanz und allen 7 Spiel-Seiten, zufälliger Spruch pro Pageload, verlinkt zu `shop.html`. Rein kosmetisch, kein Tracking

## Wieso "Email" in der Firebase Console steht, obwohl es kein Email-Feld gibt
Firebase Auth braucht technisch immer eine Email. Der Username wird deshalb im Hintergrund automatisch zu
`username@mpgames.local` (Gamecenter) bzw. `username@illegalo.local` (Admin/Dev/Lieferant) gemacht (sieht
man nur in der Firebase Console unter Authentication, nie für den User selbst).
Das heißt auch: Usernamen müssen einzigartig sein — ist einer schon vergeben, bekommt man "Dieser Username ist schon vergeben."

## Neues Spiel hinzufügen

**1v1-Spiel (per Invite, wie Tic-Tac-Toe, Snake.io oder Katapult Tower):**
1. In `lobby.js` das `GAMES` Array erweitern (`{ id: "...", name: "..." }`)
2. In `buildRoomData()` (`lobby.js`) einen Fall für deine neue `inv.game`-ID ergänzen — was für Start-State braucht dein Spiel im `rooms`-Dokument?
3. In `gamePage()` (`lobby.js`) die passende HTML-Datei für deine Game-ID zurückgeben
4. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snakeio.html`/`snakeio.js` (Echtzeit) oder `game.html`/`game.js` (rundenbasiert)
5. `rooms`-Collection-Regel in `firestore.rules` ist generisch genug für die meisten Fälle — meist keine Änderung nötig
6. Für die Bilanz-Seite: beim Match-Ende `addDoc(collection(db,"matchResults"), {game, players, playerNames, winner, at: serverTimestamp()})` schreiben (siehe wie's in `game.js`/`connect4.js`/`katapult.js`/`snakeio.js`/`pong.js` gemacht wird) + deine Game-ID zur erlaubten Liste in der `matchResults`-Regel in `firestore.rules` hinzufügen
7. Optional, aber macht Spaß: `import { sfx } from "./sfx.js";` für Sound-Effekte, und die Reaction-Buttons (HTML-Snippet aus z.B. `game.html` kopieren) für Emoji-Reaktionen

**Solo-Arcade-Spiel (wie Snake, kein Invite nötig):**
1. In `lobby.js` das `ARCADE_GAMES` Array erweitern (`{ id: "...", name: "...", icon: "...", page: "gamename.html" }`)
2. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snake.html`/`snake.js` — Score am Ende in die `scores`-Collection schreiben (`game: "deine-id"`) fürs gemeinsame Leaderboard
3. In `firestore.rules` bei der `scores`-Regel deine neue Game-ID zur erlaubten Liste hinzufügen (`request.resource.data.game in [...]`)

## Mehr Werbesprüche hinzufügen
Einfach in `ads.js` das `SLOGANS`-Array erweitern — neue Zeile dazu, fertig. Wird zufällig
auf jedem Pageload aus der Liste gezogen, kein Tracking welcher Spruch wann wo lief.
