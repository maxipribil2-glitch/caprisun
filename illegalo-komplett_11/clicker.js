// MAP — Idle-Clicker. Klicken für Session-Coins, Upgrades erhöhen Klick-Wert und
// Auto-Coins/Sekunde. WICHTIG: die "Session-Coins" sind rein visuell/lokal — echte
// MaxiCoin-Auszahlung passiert alle 5s via awardGameReward mit Cooldown+Cap wie
// überall sonst, damit Idle-Clicker nicht zum unkontrollierten Coin-Farm-Loophole wird.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const bigCoin = document.getElementById("big-coin");
const sessionCountEl = document.getElementById("session-count");
const perClickEl = document.getElementById("per-click");
const perSecEl = document.getElementById("per-sec");
const upgradesEl = document.getElementById("upgrades");
const statusEl = document.getElementById("status");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const UPGRADES = [
  { id: "click1", name: "Besserer Finger", cost: 50, effect: "click", amount: 1 },
  { id: "click2", name: "Turbo-Finger", cost: 300, effect: "click", amount: 3 },
  { id: "auto1", name: "Mini-Roboter", cost: 100, effect: "auto", amount: 1 },
  { id: "auto2", name: "Coin-Fabrik", cost: 500, effect: "auto", amount: 5 },
];

// MAP: Payout-Cap pro Minute, damit Idle-AFK-Farming (Auto-Clicker etc.) trotz
// awardGameReward-Cooldown nicht durch ständiges "gerade so oft genug" auszahlt.
const PAYOUT_INTERVAL_MS = 5000;
const MAX_PAYOUT_PER_TICK = 30;

let myUid, sessionCoins = 0, clickValue = 1, autoPerSec = 0, owned = new Set(), payoutTimer, sinceLastPayout = 0;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  renderUpgrades();
  payoutTimer = setInterval(payoutTick, PAYOUT_INTERVAL_MS);
  setInterval(() => { if (autoPerSec > 0) addSessionCoins(autoPerSec); }, 1000);
});

function addSessionCoins(amount) {
  sessionCoins += amount;
  sinceLastPayout += amount;
  sessionCountEl.textContent = sessionCoins;
}

bigCoin.addEventListener("click", () => {
  addSessionCoins(clickValue);
  sfx.coin ? sfx.coin() : null;
  bigCoin.style.transform = "scale(0.9)";
  setTimeout(() => bigCoin.style.transform = "scale(1)", 90);
});

function renderUpgrades() {
  upgradesEl.innerHTML = "";
  UPGRADES.forEach(u => {
    const owned_ = owned.has(u.id);
    const btn = document.createElement("button");
    btn.className = "upgrade-btn";
    btn.disabled = owned_ || sessionCoins < u.cost;
    btn.textContent = owned_ ? `✅ ${u.name} (gekauft)` : `${u.name} — ${u.cost} Coins (${u.effect==="click"?"+"+u.amount+"/Klick":"+"+u.amount+"/Sek"})`;
    btn.addEventListener("click", () => buyUpgrade(u));
    upgradesEl.appendChild(btn);
  });
}

function buyUpgrade(u) {
  if (owned.has(u.id) || sessionCoins < u.cost) return;
  sessionCoins -= u.cost;
  owned.add(u.id);
  if (u.effect === "click") clickValue += u.amount;
  else autoPerSec += u.amount;
  perClickEl.textContent = clickValue;
  perSecEl.textContent = autoPerSec;
  sessionCountEl.textContent = sessionCoins;
  sfx.win ? sfx.win() : null;
  renderUpgrades();
}

async function payoutTick() {
  if (sinceLastPayout <= 0) return;
  const amount = Math.min(sinceLastPayout, MAX_PAYOUT_PER_TICK);
  sinceLastPayout -= amount;
  const ok = await awardGameReward(myUid, amount, "clicker_idle");
  statusEl.textContent = ok ? `💰 +${amount} echte Coins gutgeschrieben!` : "⏳ Cooldown aktiv, nächste Auszahlung bald.";
}

leaveBtn.addEventListener("click", () => { clearInterval(payoutTimer); window.location.href = "lobby.html"; });
