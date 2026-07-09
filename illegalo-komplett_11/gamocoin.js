// MAP — MaxiCoin System 💰
// Shared module used by roulette.js, lobby.js und alle anderen Games die Coins vergeben.
// Coins werden in Firestore gespeichert: users/{uid}.gamocoins + users/{uid}.lastDailyBonus
// Startguthaben: 1000 beim ersten Login (gesetzt in auth.js)
// Daily Bonus: 200 Coins, einmal pro Tag
// Earn: durch Siege in anderen Spielen (matchResults-Hook)

import { app } from "./firebase-config.js";
import {
  getFirestore, doc, getDoc, updateDoc, increment, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const db = getFirestore(app);

export const STARTING_COINS = 1000;
export const DAILY_BONUS    = 1000;  // MAP: von 200 auf 1000 erhöht
export const WIN_BONUS      = 50;    // Coins für Sieg in anderem Spiel
export const MAX_GAME_REWARD = 500;  // Hard-Cap: mehr als 500 Coins gibt's nie auf einmal aus Games

// ── Balance abrufen ──
export async function getBalance(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return 0;
    return snap.data().gamocoins ?? STARTING_COINS;
  } catch(e) { return 0; }
}

// ── Coins hinzufügen/entfernen ──
export async function addCoins(uid, amount, reason) {
  try {
    await updateDoc(doc(db, "users", uid), {
      gamocoins: increment(amount)
    });
    return true;
  } catch(e) { return false; }
}

// ── Daily Bonus claimen ──
export async function claimDailyBonus(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return { claimed: false, reason: "user_not_found" };
    const data = snap.data();
    const lastBonus = data.lastDailyBonus?.toMillis?.() || 0;
    const now = Date.now();
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
    if (now - lastBonus < TWENTY_FOUR_H) {
      const nextBonus = new Date(lastBonus + TWENTY_FOUR_H);
      return { claimed: false, reason: "too_soon", nextBonus };
    }
    await updateDoc(doc(db, "users", uid), {
      gamocoins: increment(DAILY_BONUS),
      lastDailyBonus: serverTimestamp()
    });
    return { claimed: true, amount: DAILY_BONUS };
  } catch(e) { return { claimed: false, reason: "error" }; }
}

// ── Wette platzieren (jetzt WIRKLICH atomic) ──
// MAP FIX: vorher stand hier getDoc + separates updateDoc — der Kommentar sagte
// "atomic", war's aber nicht. Zwei offene Tabs konnten gleichzeitig den gleichen
// Kontostand lesen und beide abbuchen (Double-Spend). Jetzt echte Transaction.
export async function placeBet(uid, amount) {
  const ref = doc(db, "users", uid);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false, reason: "user_not_found" };
      const balance = snap.data().gamocoins ?? 0;
      if (balance < amount) return { ok: false, reason: "insufficient", balance };
      tx.update(ref, { gamocoins: increment(-amount) });
      return { ok: true, balance: balance - amount };
    });
  } catch(e) { return { ok: false, reason: "error" }; }
}

// ── Gewinn auszahlen ──
export async function payout(uid, amount) {
  return await addCoins(uid, amount, "roulette_win");
}

// MAP FIX (Coin-Bug): addCoins() selbst hat KEIN Cap — für Roulette-Gewinne ist das
// korrekt (Wetten können legit groß sein), aber Coin Rush hat den 500er-Run-Cap
// bisher nur CLIENT-seitig gecheckt (MAX_COINS_PER_RUN in coinrush.js). Das hieß:
// jemand könnte mit offenen DevTools addCoins() direkt mit riesigem Betrag aufrufen
// und den Cap komplett umgehen. Diese Funktion hier ist die einzige, die Coin Rush
// ab jetzt benutzen darf — cappt SERVER-seitig via Firestore-Transaction auf einen
// Session-Gesamtbetrag, unabhängig davon was der Client behauptet gesammelt zu haben.
const LIVE_DROP_SESSION_CAP = 500;
export async function addLiveDropCoins(uid, amount, reason) {
  const safeAmount = Math.max(0, Math.round(amount));
  if (safeAmount <= 0) return { credited: 0 };
  const ref = doc(db, "users", uid);
  try {
    const credited = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return 0;
      const sessionTotal = snap.data().liveDropSessionTotal ?? 0;
      const remaining = Math.max(0, LIVE_DROP_SESSION_CAP - sessionTotal);
      const toCredit = Math.min(safeAmount, remaining);
      if (toCredit <= 0) return 0;
      tx.update(ref, {
        gamocoins: increment(toCredit),
        liveDropSessionTotal: sessionTotal + toCredit
      });
      return toCredit;
    });
    return { credited };
  } catch (e) { return { credited: 0 }; }
}
// Session-Cap zurücksetzen (bei Game-Start aufrufen, sonst bleibt er für immer bei 500)
export async function resetLiveDropSession(uid) {
  try { await updateDoc(doc(db, "users", uid), { liveDropSessionTotal: 0 }); } catch (e) {}
}

// ── Gewinn-Coins aus anderen Games (Match-Siege, Highscores etc.) ──
// Hard-gecappt bei MAX_GAME_REWARD (500), egal was reingegeben wird — verhindert
// dass ein Game (jetzt oder in Zukunft) versehentlich/absichtlich mehr auszahlt.
// MAP FIX: zusätzlich Cooldown von 20s zwischen zwei Game-Rewards für den gleichen
// User (users/{uid}.lastGameRewardAt) — verhindert dass wer sich mit 2 Accounts
// gegeneinander Tic-Tac-Toe spammt und sich Coins ohne Ende farmt.
const REWARD_COOLDOWN_MS = 10_000;
const SOLO_GAMES = new Set(["snake_score", "breakout_score", "2048_score", "flappy_score"]);

// MAP FIX: eigener Cooldown-Timestamp je Quelle (solo Highscore vs 1v1 Match-Sieg),
// damit ein Snake-Highscore nicht mehr den Cooldown für dein nächstes 1v1-Match blockt.
export async function awardGameReward(uid, amount, reason) {
  const capped = Math.max(0, Math.min(Math.round(amount), MAX_GAME_REWARD));
  if (capped <= 0) return false;
  const cooldownField = SOLO_GAMES.has(reason) ? "lastSoloRewardAt" : "lastGameRewardAt";
  const ref = doc(db, "users", uid);
  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return "no_user";
      const last = snap.data()[cooldownField]?.toMillis?.() || 0;
      if (Date.now() - last < REWARD_COOLDOWN_MS) return "cooldown";
      tx.update(ref, {
        gamocoins: increment(capped),
        [cooldownField]: serverTimestamp()
      });
      return "ok";
    });
    if (result === "cooldown") {
      console.log(`[gamocoin] Reward-Cooldown aktiv für ${uid} (${cooldownField}), kein Fehler.`);
      return false;
    }
    return result === "ok";
  } catch (e) {
    console.error("[gamocoin] awardGameReward failed:", e);
    return false;
  }
}

// ── Einarmiger Bandit (Daily Spin) ──
// MAP: 1x pro Tag, läuft über den GLEICHEN 24h-Timestamp-Mechanismus wie Daily
// Bonus, aber eigenes Feld (lastSlotSpin) damit sich die beiden Features nicht
// gegenseitig blocken. Jackpot (7-7-7) = "keine Lieferkosten"-Voucher statt Coins,
// sonst zufällige Coins zwischen 50-10.000 (nie mehr, hart gecappt).
const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
const MAX_SLOT_WIN = 10000;

export async function spinSlotMachine(uid) {
  const ref = doc(db, "users", uid);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { spun: false, reason: "user_not_found" };
      const data = snap.data();
      const lastSpin = data.lastSlotSpin?.toMillis?.() || 0;
      const now = Date.now();
      const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
      if (now - lastSpin < TWENTY_FOUR_H) {
        const nextSpin = new Date(lastSpin + TWENTY_FOUR_H);
        return { spun: false, reason: "too_soon", nextSpin };
      }

      // Reels würfeln — 7️⃣7️⃣7️⃣ ist der seltenste Fall (1/216 pro Reel-Kombi ist
      // nicht ganz korrekt gerechnet, aber wir wollen den Jackpot bewusst selten:
      // extra kleine Sonderwahrscheinlichkeit statt reinem 3x-Zufall).
      const isJackpot = Math.random() < 0.01; // 1% fixe Jackpot-Chance
      let reels;
      if (isJackpot) {
        reels = ["7️⃣", "7️⃣", "7️⃣"];
      } else {
        do {
          reels = [0,0,0].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
        } while (reels[0] === "7️⃣" && reels[1] === "7️⃣" && reels[2] === "7️⃣"); // Zufalls-Jackpot ausschließen, läuft nur über isJackpot oben
      }

      const allSame = reels[0] === reels[1] && reels[1] === reels[2];
      let coinsWon = 0, voucherWon = false;

      if (isJackpot) {
        voucherWon = true;
        tx.update(ref, { lastSlotSpin: serverTimestamp(), freeDeliveryVoucher: true });
      } else {
        // Kleiner Basis-Gewinn immer, 3-gleiche = großer Bonus obendrauf, hart gecappt bei MAX_SLOT_WIN
        coinsWon = allSame ? Math.min(2000 + Math.floor(Math.random()*8000), MAX_SLOT_WIN) : 50 + Math.floor(Math.random()*450);
        coinsWon = Math.min(coinsWon, MAX_SLOT_WIN);
        tx.update(ref, { lastSlotSpin: serverTimestamp(), gamocoins: increment(coinsWon) });
      }

      return { spun: true, reels, isJackpot, coinsWon, voucherWon };
    });
  } catch (e) { return { spun: false, reason: "error" }; }
}

// ── Formatierung ──
export function formatCoins(n) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1) + "M 🪙";
  if (n >= 1_000)     return (n/1_000).toFixed(1) + "K 🪙";
  return n + " 🪙";
}
// MAP: Kurzform für UI-Texte wo "MaxiCoins" ausgeschrieben zu lang wär
export const CURRENCY_NAME = "MaxiCoins";
export const CURRENCY_SHORT = "MC";
