// MAP — GamoCoin System 💰
// Shared module used by roulette.js, lobby.js und alle anderen Games die Coins vergeben.
// Coins werden in Firestore gespeichert: users/{uid}.gamocoins + users/{uid}.lastDailyBonus
// Startguthaben: 1000 beim ersten Login (gesetzt in auth.js)
// Daily Bonus: 200 Coins, einmal pro Tag
// Earn: durch Siege in anderen Spielen (matchResults-Hook)

import { app } from "./firebase-config.js";
import {
  getFirestore, doc, getDoc, updateDoc, increment, serverTimestamp
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
      gamocoins: increment(amount),
      [`coinLog_${Date.now()}`]: { amount, reason, at: new Date().toISOString() }
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

// ── Wette platzieren (atomic deduct) ──
export async function placeBet(uid, amount) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return { ok: false, reason: "user_not_found" };
    const balance = snap.data().gamocoins ?? 0;
    if (balance < amount) return { ok: false, reason: "insufficient", balance };
    await updateDoc(doc(db, "users", uid), { gamocoins: increment(-amount) });
    return { ok: true, balance: balance - amount };
  } catch(e) { return { ok: false, reason: "error" }; }
}

// ── Gewinn auszahlen ──
export async function payout(uid, amount) {
  return await addCoins(uid, amount, "roulette_win");
}

// ── Gewinn-Coins aus anderen Games (Match-Siege, Highscores etc.) ──
// Hard-gecappt bei MAX_GAME_REWARD (500), egal was reingegeben wird — verhindert
// dass ein Game (jetzt oder in Zukunft) versehentlich/absichtlich mehr auszahlt.
// MAP FIX: zusätzlich Cooldown von 20s zwischen zwei Game-Rewards für den gleichen
// User (users/{uid}.lastGameRewardAt) — verhindert dass wer sich mit 2 Accounts
// gegeneinander Tic-Tac-Toe spammt und sich Coins ohne Ende farmt.
const REWARD_COOLDOWN_MS = 20_000;

export async function awardGameReward(uid, amount, reason) {
  const capped = Math.max(0, Math.min(Math.round(amount), MAX_GAME_REWARD));
  if (capped <= 0) return false;
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    const last = snap.data().lastGameRewardAt?.toMillis?.() || 0;
    if (Date.now() - last < REWARD_COOLDOWN_MS) return false; // zu früh, kein Reward
    await updateDoc(ref, {
      gamocoins: increment(capped),
      lastGameRewardAt: serverTimestamp(),
      [`coinLog_${Date.now()}`]: { amount: capped, reason: reason || "game_reward", at: new Date().toISOString() }
    });
    return true;
  } catch (e) { return false; }
}

// ── Formatierung ──
export function formatCoins(n) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1) + "M 🪙";
  if (n >= 1_000)     return (n/1_000).toFixed(1) + "K 🪙";
  return n + " 🪙";
}
