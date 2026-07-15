# Illegalo Gamecenter — Changelog

MAP — Übersicht der größeren Änderungen, damit man beim nächsten Mal nicht den
kompletten Chat-Verlauf durchsuchen muss. Chronologisch, neueste zuerst.

## 🚀 Illegalo Express (Shop)
- Neuer Button im Checkout: "Illegalo Express" — Aufpreis für bevorzugte
  Lieferreihenfolge (warm zuletzt, kalt zuerst)
- Preis konfigurierbar im Dev Panel UND Admin Panel (`siteStatus.expressPrice`,
  Firestore, max. 20€ serverseitig abgesichert)
- Admin sieht Express-Bestellungen mit Badge + Details in der Order-Liste

## 🛑 Kill Switch (Notfall-Ausschalter)
- Ein Button im Dev Panel legt ALLES lahm: Shop, Admin, Lieferant, Home,
  komplettes Gamecenter — nur Dev Panel selbst bleibt erreichbar
- Zeigt echten GitHub-Pages-404-Look (weißer Hintergrund, "File not found"),
  inkl. Favicon-Umschaltung für die volle Illusion
- **Server-seitig durchgesetzt** — nicht nur ein Overlay das man im DevTools
  wegklicken kann. Firestore Rules (`killSwitchActive()`) UND alle Supabase
  Coin-RPC-Functions (`is_killswitch_active()`) blockieren kritische
  Writes unabhängig vom Frontend
- 2h-Reminder falls man vergisst ihn auszuschalten (checkt alle 2 Min)
- Audit-Log bei Aktivierung/Deaktivierung

## 💰 Coinsystem: Firestore → Supabase Migration
- Kompletter Umzug des Coinsystems (Balance, Wetten, Rewards, Daily Bonus,
  Slot Machine) von Firestore auf Supabase (`ocpamumzabezoirkqalk`)
- Firebase-JWT-Bridge: Supabase verifiziert echte Firebase-Tokens
  server-seitig (Third-Party Auth), RLS nutzt `auth.jwt()->>'sub'`
- Alle Coin-kritischen Operationen laufen über SECURITY DEFINER RPC-Functions
  mit eingebauten Cooldowns/Caps: `place_bet`, `award_game_reward`,
  `claim_daily_bonus`, `spin_slot_machine`, `claim_challenge_reward`,
  `buy_bonus_spin`, `use_bonus_spin`, `admin_add_coins`, `migrate_legacy_user`
- Auto-Heal-Migration: alte Firestore-Accounts werden beim ersten Login
  automatisch (mit echten Werten, gedeckelt auf 50k) nach Supabase migriert
- **Was NICHT migriert wurde:** Rooms/Matches/Scores/Invites/Tournaments
  laufen weiterhin über Firestore — bewusste Zwei-Datenbank-Architektur,
  kein "alles auf einmal"-Risiko

## 🎰 Einarmiger Bandit + Bonus-Spins
- Täglicher Gratis-Spin (24h-Cooldown), Jackpot (1%) = Gratis-Lieferung-Voucher
- Bonus-Spins: 1x/Tag gratis über Daily Challenge, oder für Coins kaufbar
  (Preis konfigurierbar im Dev Panel)
- Pixel-Art-Sprites statt Emoji (Kirsche, Zitrone, Glocke, Diamant, Sieben,
  Stern) — `pixelSprites.js`, sehen auf jedem Gerät identisch aus

## 🔒 Security-Härtung
- `staff_uids`-Allowlist (Supabase + Firestore) — Email-Domain-Check allein
  reicht nicht mehr, explizite UID-Liste zusätzlich nötig für Staff-Rechte
- Eskalierendes Login-Lockout (30s → 60s → 120s → ...) im Dev Panel UND
  Gamecenter-Login
- Presence-Updates serverseitig rate-limitiert (min. 15s zwischen Writes)
- `users`-Tabelle in Supabase: Spalten-Rechte eingeschränkt, direkte
  Client-Updates auf Coins/etc. sind blockiert, nur RPC-Functions dürfen
- Health-Check-Dashboard im Dev Panel (Firestore/Supabase-Status,
  Fehler-Zähler, automatisches Re-Checken alle 2 Min)

## 🎮 Neue Games
- Whack-a-Mole, Bubble Shooter, Farb-Reflex, Balloon Pop, Wortkette (1v1),
  Wortsuche
- Timeout-Fallbacks für Nim/RPS/Quiz/Chess/Checkers (Verlassen ohne
  "Verlassen"-Klick wertet automatisch als Niederlage)

## 🎨 Design
- Retro-Pixel-Look verschärft: `image-rendering: pixelated` global auf allen
  Canvas-Elementen
- CRT-Overlay/Glow-Effekte entschärft ("ein Signature-Element statt alles
  leuchtet gleich laut" — Game-Canvas ist jetzt der Fokuspunkt)
- Kill-Switch-404-Screen komplett im GitHub-Stil

## 🐛 Größere Bugfixes (Auszug)
- Firestore Rules: `isAdmin`-Vergleich crashte bei fehlendem Feld → blockte
  JEDES Coin-Update (der ursprüngliche Auslöser der ganzen Debug-Session)
- Roulette: echte Endlosschleife in `buildTable()` (toter Code) → OOM-Crash
  des ganzen Tabs
- Roulette: Phasen-Timer wurde nie gesetzt wenn Zeit schon abgelaufen war →
  Tisch blieb für immer in "result"/"spinning" hängen
- Memory-Leak: Realtime-DB-Listener fürs Invite-Feature stapelten sich
  unbegrenzt ohne Cleanup
- `auth.js`: Race Condition zwischen Redirect und Supabase-Row-Anlage bei
  der Registrierung

---
*Für Details zu einzelnen Änderungen: Firebase Console → Firestore → Regeln
zeigt den aktuellen Stand, Supabase Dashboard → Database → Functions/Tables
für die Coinsystem-Seite.*
