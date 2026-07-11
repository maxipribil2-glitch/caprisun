// MAP — MaxiCoin System 💰 (Supabase-Version)
// Shared module used by roulette.js, lobby.js und alle anderen Games die Coins vergeben.
// LÄUFT JETZT ÜBER SUPABASE (Postgres) statt Firestore. Auth bleibt Firebase —
// die Firebase-UID wird 1:1 als firebase_uid-Spalte in Supabase genutzt.
// Atomare Operationen (Wetten, Rewards, Daily Bonus, Slot Machine) laufen über
// Postgres RPC-Functions (siehe supabase-schema.sql) statt Firestore-Transactions,
// weil supabase-js kein client-seitiges Transaction-API wie Firestore hat.
import { supabase } from "./supabase-config.js";

export const STARTING_COINS = 1000;
export const DAILY_BONUS    = 1000;
export const WIN_BONUS      = 50;
export const MAX_GAME_REWARD = 500;

const SOLO_GAMES = new Set([
  "wham_score","bubbleshooter_score","stroop_score","balloonpop_score","flappy_score",
  "2048_score","sudoku_score","memory_score","minesweeper_score","wordle_score","typing_score","pixelart_score"
]);

// ── Balance abrufen ──
export async function getBalance(uid) {
  try {
    const { data, error } = await supabase.from("users").select("gamocoins").eq("firebase_uid", uid).maybeSingle();
    if (error || !data) return 0;
    return data.gamocoins ?? STARTING_COINS;
  } catch(e) { console.error("[gamocoin] getBalance failed:", e); return 0; }
}

// ── Coins hinzufügen/entfernen (manueller Dev-Eingriff, kein Cap/Cooldown) ──
export async function addCoins(uid, amount, reason) {
  try {
    const { data: cur, error: readErr } = await supabase.from("users").select("gamocoins").eq("firebase_uid", uid).maybeSingle();
    if (readErr || !cur) return false;
    const { error } = await supabase.from("users").update({ gamocoins: cur.gamocoins + amount }).eq("firebase_uid", uid);
    return !error;
  } catch(e) { console.error("[gamocoin] addCoins failed:", e); return false; }
}

// MAP: für's Dev-Panel-Coin-Management (Staff schreibt Coins für ANDERE Accounts
// gut) — die normale addCoins()-Funktion greift wegen RLS nur bei der EIGENEN
// Zeile. Läuft stattdessen über die admin_add_coins-RPC (prüft is_illegalo_staff()
// server-seitig). Nutzt dev.html sobald das auch migriert ist.
export async function adminAddCoins(targetUid, amount) {
  try {
    const { data, error } = await supabase.rpc("admin_add_coins", { p_target_uid: targetUid, p_amount: amount });
    if (error) { console.error("[gamocoin] adminAddCoins failed:", error); return false; }
    return !!data.ok;
  } catch(e) { console.error("[gamocoin] adminAddCoins failed:", e); return false; }
}

// ── Wette platzieren (atomar über RPC) ──
export async function placeBet(uid, amount) {
  try {
    const { data, error } = await supabase.rpc("place_bet", { p_uid: uid, p_amount: amount });
    if (error) return { ok: false, reason: "error" };
    return { ok: data.ok, reason: data.reason, balance: data.balance };
  } catch(e) { console.error("[gamocoin] placeBet failed:", e); return { ok: false, reason: "error" }; }
}

// ── Auszahlung nach Gewinn (einfaches increment, kein Cap noetig da bewusste Spielmechanik) ──
export async function payout(uid, amount) {
  return addCoins(uid, amount, "payout");
}

// ── Coins nach Spielsieg/Highscore vergeben (gecappt, mit Cooldown über RPC) ──
export async function awardGameReward(uid, amount, reason) {
  const capped = Math.max(0, Math.min(Math.round(amount), MAX_GAME_REWARD));
  if (capped <= 0) return false;
  try {
    const { data, error } = await supabase.rpc("award_game_reward", {
      p_uid: uid, p_amount: capped, p_is_solo: SOLO_GAMES.has(reason)
    });
    if (error) { console.error("[gamocoin] awardGameReward failed:", error); return false; }
    return !!data.ok;
  } catch(e) { console.error("[gamocoin] awardGameReward failed:", e); return false; }
}

// ── Daily Bonus claimen (24h-Cooldown, atomar über RPC) ──
export async function claimDailyBonus(uid) {
  try {
    const { data, error } = await supabase.rpc("claim_daily_bonus", { p_uid: uid, p_bonus_amount: DAILY_BONUS });
    if (error) return { claimed: false };
    return {
      claimed: data.claimed,
      amount: data.amount,
      nextBonus: data.next_bonus ? new Date(data.next_bonus).getTime() : null
    };
  } catch(e) { console.error("[gamocoin] claimDailyBonus failed:", e); return { claimed: false }; }
}

// ── Einarmiger Bandit (24h-Cooldown, Jackpot-Logik, atomar über RPC) ──
export async function spinSlotMachine(uid) {
  try {
    const { data, error } = await supabase.rpc("spin_slot_machine", { p_uid: uid });
    if (error) { console.error("[slots] spinSlotMachine failed:", error); return { spun: false, reason: "error" }; }
    if (!data.spun) return { spun: false, reason: data.reason, nextSpin: data.next_spin ? new Date(data.next_spin) : null };
    return {
      spun: true,
      isJackpot: data.is_jackpot,
      coinsWon: data.coins_won,
      voucherWon: data.voucher_won,
      reels: data.is_jackpot ? ["7️⃣","7️⃣","7️⃣"] : ["🍒","🍋","🔔","⭐","💎"].sort(()=>Math.random()-0.5).slice(0,3)
    };
  } catch(e) {
    console.error("[slots] spinSlotMachine failed:", e);
    return { spun: false, reason: "error" };
  }
}

// MAP FIX (Deep Check Bug — Breaking Import): coinrush.js importiert
// addLiveDropCoins + resetLiveDropSession aus diesem Modul, aber die Supabase-
// Migration hat die beiden Exports komplett vergessen mitzunehmen — das ES-
// Module-Import in coinrush.js hätte deswegen sofort gecrasht ("does not
// provide an export named..."), die GANZE coinrush.html-Seite wäre kaputt
// gewesen (kein einziges Script auf der Seite hätte noch ausgeführt). Hier
// als direkte Supabase-Updates nachgebaut (Coin Rush schreibt nur die EIGENE
// Zeile während des eigenen Spiels — das ist über die "update own user"-RLS-
// Policy erlaubt, deshalb reicht ein simples read-then-write ohne RPC/
// Transaction, genau wie bei addCoins() oben). Braucht die neue Spalte
// "live_drop_session_total" auf der users-Tabelle, siehe supabase-schema.sql
// — die musst du einmalig per ALTER TABLE in Supabase nachziehen.
const LIVE_DROP_SESSION_CAP = 500;
export async function addLiveDropCoins(uid, amount, reason) {
  const safeAmount = Math.max(0, Math.round(amount));
  if (safeAmount <= 0) return { credited: 0 };
  try {
    const { data: cur, error: readErr } = await supabase.from("users").select("gamocoins, live_drop_session_total").eq("firebase_uid", uid).maybeSingle();
    if (readErr || !cur) return { credited: 0 };
    const sessionTotal = cur.live_drop_session_total ?? 0;
    const remaining = Math.max(0, LIVE_DROP_SESSION_CAP - sessionTotal);
    const toCredit = Math.min(safeAmount, remaining);
    if (toCredit <= 0) return { credited: 0 };
    const { error } = await supabase.from("users").update({
      gamocoins: cur.gamocoins + toCredit,
      live_drop_session_total: sessionTotal + toCredit
    }).eq("firebase_uid", uid);
    return { credited: error ? 0 : toCredit };
  } catch(e) { console.error("[gamocoin] addLiveDropCoins failed:", e); return { credited: 0 }; }
}
// Session-Cap zurücksetzen (bei Game-Start aufrufen, sonst bleibt er für immer bei 500)
export async function resetLiveDropSession(uid) {
  try { await supabase.from("users").update({ live_drop_session_total: 0 }).eq("firebase_uid", uid); } catch(e) {}
}

// ── Formatierung ──
export function formatCoins(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,"") + "M";
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,"") + "K";
  return String(n);
}
