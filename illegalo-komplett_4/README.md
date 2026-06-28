# Illegalo Gamecenter — Setup Guide

Alles was du jetzt im Firebase Console noch klicken musst, damit das live geht. Reihenfolge einhalten, sonst kackt's ab.

## Dateistruktur — alles flach im selben Repo wie Illegalo

Diese Dateien kommen 1:1 in den gleichen Repo-Root wie `shop.html`, `admin.html`, `dev.html`, `lieferant.html` & Co.
**Kein Unterordner** — alles flach. Damit nix mit den Illegalo-Dateien kollidiert (Illegalo hat selbst schon ein
`admin.html` und ein `index.html`), heißen die paar überlappenden Gamecenter-Dateien mit `gc-`-Prefix:

| Gamecenter-Datei | Wofür |
|---|---|
| `gc-index.html` | Login/Register (Gamecenter) — entspricht dem alten `index.html` |
| `gc-firestore.rules` | Security Rules fürs Gamecenter-Firebase-Projekt — entspricht dem alten `firestore.rules` |
| `lobby.html`, `game.html`, `style.css`, `auth.js`, `lobby.js`, `game.js`, `maintenance.js`, `firebase-config.js`, `snake.html`, `snake.js`, `snakeio.html`, `snakeio.js`, `katapult.html`, `katapult.js` | unverändert, keine Namenskollision mit Illegalo |
| `firebase.json`, `.firebaserc`, `database.rules.json` | Firebase-CLI-Deploy-Konfig, unverändert |

Läuft dann unter `https://maxipribil2-glitch.github.io/caprisun/gc-index.html` — die Links zurück zu Illegalo
(`← Zurück zu Illegalo` auf der Login-Seite, `🏠 illegalo` in der Lobby) und die Verlinkung von der Illegalo-
Homepage aus gehen davon aus, dass alles auf der gleichen Ebene liegt (kein `../`).

## Architektur — wieso eigenes Firebase-Projekt?
Das Gamecenter läuft auf einem **komplett eigenen Firebase-Projekt** (`multiplayer-games-163ee`) mit
echtem Firebase Auth (Email/Passwort im Hintergrund) — nicht auf `illegalo-shopzone` wie Shop/Admin/Dev/
Lieferant. Heißt: zwei getrennte Logins, zwei getrennte Datenbanken. Vorteil: hier gibt's *echte*
Security Rules mit echter Nutzer-Identität (`request.auth.uid`), nicht nur Form-Validierung wie bei
Illegalo ohne Auth.

Der Kill-Switch läuft **ausschließlich** über die Illegalo-Seiten (`admin.html` und `dev.html`, Tab "🎮
Gamecenter") — über einen Service-Account-Login, der sich beim Laden automatisch mit dem Gamecenter-
Firebase verbindet und sowohl den Online/Offline-Status als auch die Anzahl Spieler online live anzeigt.
Es gibt **kein** eigenständiges Gamecenter-Admin-Panel mehr — `gc-admin.html` wurde entfernt, weil
Illegalos `admin.html`/`dev.html` sowieso schon alles davon (und mehr) zeigen.

## 1. Email/Password Login aktivieren
Firebase Console → **Authentication** → Tab **Sign-in method** → **Email/Password** → aktivieren & speichern.
Ohne den Schritt funktioniert `gc-index.html` gar nicht.

## 2. Firestore Database erstellen
Firebase Console → **Firestore Database** → **Create database** → Standort wählen (z.B. `eur3`) → Start im **production mode**.
Die Security Rules sind schon vorbereitet (`gc-firestore.rules`), die deployen wir gleich.

## 3. Realtime Database erstellen
Firebase Console → **Realtime Database** → **Create database** → Standort wählen → **locked mode**.
Danach siehst du oben im Panel die URL, sieht aus wie:
`https://multiplayer-games-163ee-default-rtdb.europe-west1.firebasedatabase.app`

**Wichtig:** Kopier dir diese URL und trag sie in `firebase-config.js` bei `databaseURL` ein — da steht aktuell ein Platzholder-Format drin, der muss zu deiner echten URL passen.

## 4. Firebase CLI installieren (einmalig)
```bash
npm install -g firebase-tools
firebase login
```

## 5. Rules deployen
Im Projektordner (wo `firebase.json` liegt — am besten lokal in nem separaten Ordner arbeiten, nicht direkt im hochgeladenen GitHub-Checkout):
```bash
firebase deploy --only firestore:rules,database
```
Das pusht `gc-firestore.rules` und `database.rules.json` live — ohne das kann niemand login/online status nutzen, weil alles by default gesperrt ist.

## 6. Website hosten — zwei Optionen

**Option A: Firebase Hosting**
```bash
firebase deploy --only hosting
```
Danach ist die Seite live unter `https://multiplayer-games-163ee.web.app/gc-index.html`

**Option B: GitHub Pages**
Diese Dateien kommen einfach mit in den `caprisun`-Repo-Root, zusammen mit den Illegalo-Dateien (siehe oben).
Läuft dann unter `https://maxipribil2-glitch.github.io/caprisun/gc-index.html`

Beide Optionen können parallel laufen, schadet nix.

## 7. Testen
- Zwei Browserfenster (eins davon Inkognito, sonst teilen sie sich den Login)
- In jedem mit anderem Account registrieren
- Im einen Fenster sollte der andere User unter "Online jetzt" auftauchen
- Invite schicken → im anderen Fenster taucht die Einladung auf → annehmen → beide landen automatisch im Game Room

## Aktueller Stand
- Login/Register — **nur Username + Passwort** ✅ (kein Email-Feld nötig)
- Online-Status live ✅
- Invite-System (1v1, mit Gegner-Auswahl) ✅
- **4 Spiele:**
  - **Tic-Tac-Toe** — 1v1 per Invite, rundenbasiert, synced über Firestore
  - **Snake.io (1v1)** — 1v1 per Invite, **echtes geteiltes Live-Feld** (beide Schlangen auf demselben Grid, Echtzeit). Synced über Firestore; einer der beiden Clients (wer eingeladen hat) ist "Authority" und schreibt den vollen State alle 220ms, der andere schreibt nur seine eigene Richtungsänderung — das hält die Schreibzugriffe so gering wie möglich, ganz ausschließen lässt sich das Kontingent-Risiko bei echtem Live-Sync aber nicht (haben wir besprochen).
  - **Snake** — Solo-Arcade, kein Invite nötig, eigener Highscore + globales Leaderboard
  - **Katapult Tower** — Solo-Arcade, Slingshot-Mechanik, 5 Schüsse pro Runde, Turm umschießen, globales Leaderboard
- Solo-Spiele (Snake, Katapult Tower) haben ein gemeinsames Highscore-Leaderboard (`scores`-Collection) — async "Wer ist am besten", kein Echtzeit-Risiko
- Kill-Switch — **ausschließlich** integriert ins Illegalo-`admin.html` **und** ins Illegalo-`dev.html` (Tab "Steuerung"), zeigt zusätzlich Online-Spielerzahl live ✅ (kein eigenständiges Gamecenter-Admin-Panel mehr)
- Rebranding auf "Illegalo Gamecenter" durchgezogen + Verlinkung zurück zu Illegalo ✅
- Design: dark theme im Illegalo-Stil (Inter Font, Indigo/Amber/Grün Akzente, Caveat-Signatur unten links, Versionsnummer unten rechts)

## Wieso "Email" in der Firebase Console steht, obwohl es kein Email-Feld gibt
Firebase Auth braucht technisch immer eine Email. Der Username wird deshalb im Hintergrund automatisch zu
`username@mpgames.local` gemacht (sieht man nur in der Firebase Console unter Authentication, nie für den User selbst).
Das heißt auch: Usernamen müssen einzigartig sein — ist einer schon vergeben, bekommt man "Dieser Username ist schon vergeben."

## Admin-Zugriff einrichten (für den Kill-Switch in admin.html/dev.html)
Nur ein Account mit `isAdmin: true` auf seinem User-Dokument darf den Server an-/ausschalten — und das
ist immer der **Service-Account**, mit dem sich `admin.html`/`dev.html` automatisch verbinden (kein
normaler Spieler-Account braucht oder bekommt das). Das kann man absichtlich **nicht** über die Website
selbst setzen (sonst könnte sich jeder zum Admin machen) — das musst du einmalig manuell im Firebase
Console machen:

1. Registrier einen dedizierten Service-Account über `gc-index.html` (z.B. Username `illegaloadmin`) — normales Registrieren wie jeder andere Spieler
2. Firebase Console → **Firestore Database** → Collection `users` → diesen User anklicken (erkennst du an seiner Email, z.B. `illegaloadmin@mpgames.local`)
3. Feld hinzufügen: `isAdmin` → Typ **boolean** → Wert `true` → speichern
4. Fertig — trag die **gleichen** Zugangsdaten sowohl in Illegalos `admin.html` als auch in `dev.html` bei `GC_SERVICE_EMAIL`/`GC_SERVICE_PASSWORD` ein (zwei separate Stellen, gleicher Account)

Wenn du in `admin.html` oder `dev.html` auf **Gamecenter ausschalten** klickst, sehen alle anderen Besucher (egal ob eingeloggt oder auf der Login-Seite) sofort live "Sorry, die Server sind gerade aus." — du selbst kommst über Illegalos `admin.html`/`dev.html` trotzdem immer rein, um's wieder einzuschalten.

## Neues Spiel hinzufügen

**1v1-Spiel (per Invite, wie Tic-Tac-Toe oder Snake.io):**
1. In `lobby.js` das `GAMES` Array erweitern (`{ id: "...", name: "..." }`)
2. In `buildRoomData()` (`lobby.js`) einen Fall für deine neue `inv.game`-ID ergänzen — was für Start-State braucht dein Spiel im `rooms`-Dokument?
3. In `gamePage()` (`lobby.js`) die passende HTML-Datei für deine Game-ID zurückgeben
4. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snakeio.html`/`snakeio.js` (Echtzeit) oder `game.html`/`game.js` (rundenbasiert)
5. In `gc-firestore.rules` ggf. Anpassungen für dein Game-Datenmodell — die `rooms`-Collection ist generisch genug für die meisten Fälle

**Solo-Arcade-Spiel (wie Snake oder Katapult Tower, kein Invite nötig):**
1. In `lobby.js` das `ARCADE_GAMES` Array erweitern (`{ id: "...", name: "...", icon: "...", page: "gamename.html" }`)
2. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `snake.html`/`snake.js` — Score am Ende in die `scores`-Collection schreiben (`game: "deine-id"`) fürs gemeinsame Leaderboard
3. In `gc-firestore.rules` bei der `scores`-Regel deine neue Game-ID zur erlaubten Liste hinzufügen (`request.resource.data.game in [...]`)
