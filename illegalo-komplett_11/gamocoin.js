// MAP — MaxiCoin System 💰 (Supabase-Version)
// Shared module used by roulette.js, lobby.js und alle anderen Games die Coins vergeben.
// LÄUFT JETZT ÜBER SUPABASE (Postgres) statt Firestore. Auth bleibt Firebase —
// die Firebase-UID wird 1:1 als firebase_uid-Spalte in Supabase genutzt.
// Atomare Operationen (Wetten, Rewards, Daily Bonus, Slot Machine) laufen über
// Postgres RPC-Functions (siehe supabase-schema.sql) statt Firestore-Transactions,
// weil supabase-js kein client-seitiges Transaction-API wie Firestore hat.
import { supabase } from "./supabase-config.js";
import { app } from "./firebase-config.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const fsDb = getFirestore(app);

export const STARTING_COINS = 1000;
export const DAILY_BONUS    = 1000;
export const WIN_BONUS      = 50;
export const MAX_GAME_REWARD = 500;

const SOLO_GAMES = new Set([
  "wham_score","bubbleshooter_score","stroop_score","balloonpop_score","flappy_score",
  "2048_score","sudoku_score","memory_score","minesweeper_score","wordle_score","typing_score","pixelart_score"
]);

// MAP FEATURE: Auto-Heal-Migration — statt manuell UIDs zu raten/nachzutragen,
// checkt diese Funktion bei JEDEM Login ob der Account schon in Supabase
// existiert. Falls nich (alte Accounts von VOR dem Supabase-Umzug), wird er
// automatisch mit seinen ECHTEN Firestore-Daten (Username + echter Coin-Stand,
// nich einfach auf 1000 zurückgesetzt) nachgetragen. Läuft so für JEDEN
// bestehenden Account beim nächsten Einloggen, ohne dass irgendwer UIDs
// manuell kennen/eintragen muss.
export async function ensureSupabaseUserExists(uid) {
  // MAP FIX (Verbesserungsvorschlag Punkt 2): lief vorher bei JEDEM Login/
  // Seitenaufruf erneut, obwohl's nach der ersten erfolgreichen Migration nie
  // wieder was zu tun gibt. Läuft jetzt nur noch 1x pro Browser-Session
  // (sessionStorage), spart unnötige DB-Roundtrips bei jedem Page-Load.
  const cacheKey = "gc_supabase_user_checked_" + uid;
  if (sessionStorage.getItem(cacheKey) === "1") return;
  try {
    const { data: existing } = await supabase.from("users").select("firebase_uid").eq("firebase_uid", uid).maybeSingle();
    if (existing) { sessionStorage.setItem(cacheKey, "1"); return; } // schon da, nix zu tun

    // Nicht in Supabase -> Firestore-Daten holen und rüberkopieren
    const fsSnap = await getDoc(doc(fsDb, "users", uid));
    if (!fsSnap.exists()) { sessionStorage.setItem(cacheKey, "1"); return; } // auch in Firestore nix da

    const fsData = fsSnap.data();
    // MAP FIX (Verbesserungsvorschlag Punkt 1): läuft jetzt über die
    // migrate_legacy_user-RPC statt direktem Insert — die deckelt den
    // übernommenen Coin-Stand serverseitig auf ein plausibles Maximum, falls
    // wer seinen Firestore-Wert vorher über die Browser-Konsole manipuliert hat.
    const { data, error } = await supabase.rpc("migrate_legacy_user", {
      p_uid: uid,
      p_username: fsData.username || "spieler",
      p_coins: fsData.gamocoins ?? STARTING_COINS
    });
    if (error) {
      console.error("[gamocoin] ensureSupabaseUserExists migration failed:", error);
    } else if (data?.ok) {
      console.log("[gamocoin] Account nachträglich in Supabase angelegt:", uid, fsData.username, "-> Coins:", data.coins);
    }
    sessionStorage.setItem(cacheKey, "1");
  } catch (e) { console.error("[gamocoin] ensureSupabaseUserExists failed:", e); }
}

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
// MAP FEATURE: Daily Challenge claimen -> +1 Bonus-Spin (1x/Tag)
export async function claimChallengeReward(uid) {
  try {
    const { data, error } = await supabase.rpc("claim_challenge_reward", { p_uid: uid });
    if (error) { console.error("[gamocoin] claimChallengeReward failed:", error); return { claimed: false, reason: "error" }; }
    return { claimed: data.claimed, reason: data.reason, nextClaim: data.next_claim ? new Date(data.next_claim) : null };
  } catch(e) { console.error("[gamocoin] claimChallengeReward failed:", e); return { claimed: false, reason: "error" }; }
}

// MAP FEATURE: Bonus-Spin für 1000 Coins kaufen
export async function buyBonusSpin(uid) {
  try {
    const { data, error } = await supabase.rpc("buy_bonus_spin", { p_uid: uid });
    if (error) { console.error("[gamocoin] buyBonusSpin failed:", error); return { ok: false, reason: "error" }; }
    return { ok: data.ok, reason: data.reason, balance: data.balance };
  } catch(e) { console.error("[gamocoin] buyBonusSpin failed:", e); return { ok: false, reason: "error" }; }
}

// MAP FEATURE: Bonus-Spin einlösen (aus Challenge oder gekauft)
export async function useBonusSpin(uid) {
  try {
    const { data, error } = await supabase.rpc("use_bonus_spin", { p_uid: uid });
    if (error) { console.error("[slots] useBonusSpin failed:", error); return { spun: false, reason: "error" }; }
    if (!data.spun) return { spun: false, reason: data.reason };
    return {
      spun: true, isJackpot: data.is_jackpot, coinsWon: data.coins_won, voucherWon: data.voucher_won,
      reels: data.is_jackpot ? ["seven","seven","seven"] : ["cherry","lemon","bell","star","diamond"].sort(()=>Math.random()-0.5).slice(0,3)
    };
  } catch(e) { console.error("[slots] useBonusSpin failed:", e); return { spun: false, reason: "error" }; }
}

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
      reels: data.is_jackpot ? ["seven","seven","seven"] : ["cherry","lemon","bell","star","diamond"].sort(()=>Math.random()-0.5).slice(0,3)
    };
  } catch(e) {
    console.error("[slots] spinSlotMachine failed:", e);
    return { spun: false, reason: "error" };
  }
}

// ── Formatierung ──
export function formatCoins(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,"") + "M";
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,"") + "K";
  return String(n);
}

// ── Coin Rush Live-Drop-Coins (Session-gecappt bei 500) ──
// MAP FIX (Bug 4): fehlte komplett in der ersten Supabase-Version, coinrush.js
// importiert diese Funktionen -> war komplett kaputt ohne die hier.
export async function addLiveDropCoins(uid, amount, reason) {
  const safeAmount = Math.max(0, Math.round(amount));
  if (safeAmount <= 0) return { credited: 0 };
  try {
    const { data, error } = await supabase.rpc("add_live_drop_coins", { p_uid: uid, p_amount: safeAmount });
    if (error) { console.error("[gamocoin] addLiveDropCoins failed:", error); return { credited: 0 }; }
    return { credited: data.credited ?? 0 };
  } catch (e) { console.error("[gamocoin] addLiveDropCoins failed:", e); return { credited: 0 }; }
}

// Session-Cap zurücksetzen (bei Game-Start aufrufen, sonst bleibt er für immer bei 500)
export async function resetLiveDropSession(uid) {
  try {
    await supabase.from("users").update({ live_drop_session_total: 0 }).eq("firebase_uid", uid);
  } catch (e) { console.error("[gamocoin] resetLiveDropSession failed:", e); }
}
