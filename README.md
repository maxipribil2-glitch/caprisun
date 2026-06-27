# Illegalo Gamecenter — Setup Guide

Alles was du jetzt im Firebase Console noch klicken musst, damit das live geht. Reihenfolge einhalten, sonst kackt's ab.

## Dateistruktur — alles flach im selben Repo wie Illegalo

Diese Dateien kommen 1:1 in den gleichen Repo-Root wie `shop.html`, `admin.html`, `dev.html`, `lieferant.html` & Co.
**Kein Unterordner** — alles flach. Damit nix mit den Illegalo-Dateien kollidiert (Illegalo hat selbst schon ein
`admin.html` und ein `index.html`), heißen die paar überlappenden Gamecenter-Dateien mit `gc-`-Prefix:

| Gamecenter-Datei | Wofür |
|---|---|
| `gc-index.html` | Login/Register (Gamecenter) — entspricht dem alten `index.html` |
| `gc-admin.html` | Gamecenter-Kill-Switch — entspricht dem alten `admin.html` |
| `gc-firestore.rules` | Security Rules fürs Gamecenter-Firebase-Projekt — entspricht dem alten `firestore.rules` |
| `lobby.html`, `game.html`, `style.css`, `auth.js`, `lobby.js`, `game.js`, `admin.js`, `maintenance.js`, `firebase-config.js` | unverändert, keine Namenskollision mit Illegalo |
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

Der Kill-Switch ist trotzdem ins Illegalo-`admin.html` integriert (Tab "🎮 Gamecenter") — über einen
Service-Account-Login, der sich beim Laden von `admin.html` automatisch mit dem Gamecenter-Firebase
verbindet. `gc-admin.html` bleibt zusätzlich als eigenständiges Panel bestehen, falls mal gebraucht.

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
- Invite-System ✅
- 1 Spiel eingebaut: **Tic-Tac-Toe** (synced live über Firestore)
- Kill-Switch — sowohl eigenständig (`gc-admin.html`) als auch integriert ins Illegalo-`admin.html` ✅
- Rebranding auf "Illegalo Gamecenter" durchgezogen + Verlinkung zurück zu Illegalo ✅
- Design: dark theme im Illegalo-Stil (Inter Font, Indigo/Amber/Grün Akzente, Caveat-Signatur unten links, Versionsnummer unten rechts)

## Wieso "Email" in der Firebase Console steht, obwohl es kein Email-Feld gibt
Firebase Auth braucht technisch immer eine Email. Der Username wird deshalb im Hintergrund automatisch zu
`username@mpgames.local` gemacht (sieht man nur in der Firebase Console unter Authentication, nie für den User selbst).
Das heißt auch: Usernamen müssen einzigartig sein — ist einer schon vergeben, bekommt man "Dieser Username ist schon vergeben."

## Admin-Zugriff einrichten (für den Kill-Switch — eigenständig ODER integriert)
Nur Accounts mit `isAdmin: true` auf ihrem User-Dokument dürfen den Server an-/ausschalten.
Das kann man absichtlich **nicht** über die Website selbst setzen (sonst könnte sich jeder zum Admin machen) — das musst du einmalig manuell im Firebase Console machen:

1. Registrier dich ganz normal über `gc-index.html` mit deinem eigenen Account (oder einem dedizierten Service-Account, z.B. `illegaloadmin`, wenn du den Kill-Switch übers Illegalo-`admin.html` steuern willst)
2. Firebase Console → **Firestore Database** → Collection `users` → dein User-Dokument anklicken (erkennst du an deiner Email)
3. Feld hinzufügen: `isAdmin` → Typ **boolean** → Wert `true` → speichern
4. Fertig — jetzt siehst du in der Lobby unten rechts den `admin` Link (zu `gc-admin.html`), und falls du den Service-Account-Weg gewählt hast: trag die Zugangsdaten in Illegalos `admin.html` bei `GC_SERVICE_EMAIL`/`GC_SERVICE_PASSWORD` ein

Wenn du auf **SERVER AUSSCHALTEN** klickst, sehen alle anderen Besucher (egal ob eingeloggt oder auf der Login-Seite) sofort live "Sorry, die Server sind gerade aus." — du selbst kommst über `gc-admin.html` (oder Illegalos `admin.html`) trotzdem immer rein, um's wieder einzuschalten.

## Neues Spiel hinzufügen
Games sind absichtlich modular gehalten:
1. In `lobby.js` das `GAMES` Array erweitern (`{ id: "...", name: "..." }`)
2. Eigene `gamename.html` + `gamename.js` bauen, ähnlich wie `game.html`/`game.js`
3. In `acceptInvite()` (`lobby.js`) ggf. je nach `inv.game` auf die richtige HTML-Seite routen, falls mehr als ein Spiel zur Auswahl steht
