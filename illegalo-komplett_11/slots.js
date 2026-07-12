// MAP — Einarmiger Bandit. 1x pro Tag gratis, meistens Coins, ganz selten Jackpot
// (7-7-7 = "keine zusätzlichen Lieferkosten"-Voucher statt Coins). Serverseitig
// gecappt & gegated über spinSlotMachine() in gamocoin.js — kein Client-Cheat möglich.
// MAP FEATURE: zusätzlich Bonus-Spins möglich — 1x/Tag GRATIS über die Daily
// Challenge in der Lobby, oder für 1000 Coins jederzeit dazukaufen (kein Limit).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { spinSlotMachine, useBonusSpin, buyBonusSpin, getBalance } from "./gamocoin.js";
import { supabase } from "./supabase-config.js";

const auth = getAuth(app);
const spinBtn = document.getElementById("spin-btn");
const buySpinBtn = document.getElementById("buy-spin-btn");
const statusEl = document.getElementById("status");
const cooldownEl = document.getElementById("cooldown-info");
const bonusInfoEl = document.getElementById("bonus-spin-info");
const leaveBtn = document.getElementById("leave-btn");
const reelEls = [document.getElementById("reel-0"), document.getElementById("reel-1"), document.getElementById("reel-2")];
renderShopAd("shop-ad");

const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
let myUid;
let bonusSpins = 0;
let dailyUsedUp = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  await refreshBonusSpins();
  await refreshSpinPrice();
});

let bonusSpinPrice = 1000;
async function refreshSpinPrice() {
  try {
    const { data } = await supabase.from("gc_config").select("bonus_spin_price").eq("id", "site").maybeSingle();
    bonusSpinPrice = data?.bonus_spin_price ?? 1000;
  } catch (e) { console.error("[slots] refreshSpinPrice failed:", e); }
  const priceEl = document.getElementById("buy-spin-price");
  if (priceEl) priceEl.textContent = bonusSpinPrice >= 1000 ? (bonusSpinPrice/1000).toFixed(bonusSpinPrice % 1000 === 0 ? 0 : 1) + "k" : bonusSpinPrice;
}

async function refreshBonusSpins() {
  try {
    const { data } = await supabase.from("users").select("bonus_spins").eq("firebase_uid", myUid).maybeSingle();
    bonusSpins = data?.bonus_spins ?? 0;
  } catch (e) { console.error("[slots] refreshBonusSpins failed:", e); }
  updateBonusInfo();
}

function updateBonusInfo() {
  bonusInfoEl.textContent = bonusSpins > 0 ? `🎁 Du hast noch ${bonusSpins} Bonus-Spin${bonusSpins > 1 ? "s" : ""}!` : "";
}

async function playSpinAnimation() {
  reelEls.forEach(el => el.classList.add("spinning"));
  const spinAnim = setInterval(() => {
    reelEls.forEach(el => { el.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; });
  }, 80);
  sfx.move ? sfx.move() : null;
  await new Promise(r => setTimeout(r, 1200)); // kurze Spannung aufbauen
  clearInterval(spinAnim);
  reelEls.forEach(el => el.classList.remove("spinning"));
}

function renderResult(res) {
  res.reels.forEach((symbol, i) => { reelEls[i].textContent = symbol; });
  if (res.isJackpot) {
    statusEl.innerHTML = `🎉🎉🎉 JACKPOT! 🎉🎉🎉<br><strong>Keine Lieferkosten für deine nächste Bestellung!</strong>`;
    sfx.win ? sfx.win() : null;
  } else if (res.coinsWon >= 2000) {
    statusEl.textContent = `🔥 3 Gleiche! +${res.coinsWon} 🪙`;
    sfx.win ? sfx.win() : null;
    sfx.coin ? sfx.coin() : null;
  } else {
    statusEl.textContent = `+${res.coinsWon} 🪙`;
    sfx.coin ? sfx.coin() : null;
  }
}

spinBtn.addEventListener("click", async () => {
  spinBtn.disabled = true;
  statusEl.textContent = "";
  cooldownEl.textContent = "";
  await playSpinAnimation();

  // MAP: falls der tägliche Gratis-Spin schon verbraucht is, aber noch Bonus-
  // Spins da sind, nutzt der Klick automatisch nen Bonus-Spin statt zu failen.
  const res = dailyUsedUp && bonusSpins > 0 ? await useBonusSpin(myUid) : await spinSlotMachine(myUid);

  if (!res.spun) {
    if (res.reason === "too_soon" && res.nextSpin) {
      dailyUsedUp = true;
      const hoursLeft = Math.ceil((res.nextSpin - Date.now()) / 3600000);
      if (bonusSpins > 0) {
        statusEl.textContent = "Täglicher Gratis-Spin is weg, aber du hast noch Bonus-Spins — nochmal klicken!";
        spinBtn.disabled = false;
      } else {
        statusEl.textContent = "Heute schon gedreht!";
        cooldownEl.textContent = `Nächster Gratis-Spin in ~${hoursLeft}h ⏳ — oder kauf dir nen Extra-Spin!`;
      }
    } else if (res.reason === "no_bonus_spins") {
      statusEl.textContent = "Keine Bonus-Spins mehr übrig.";
      spinBtn.disabled = false;
    } else {
      statusEl.textContent = "Konnte grad nicht drehen, versuch's nochmal.";
      spinBtn.disabled = false;
    }
    return;
  }

  if (dailyUsedUp) { bonusSpins--; updateBonusInfo(); }
  renderResult(res);
  cooldownEl.textContent = bonusSpins > 0 ? `Noch ${bonusSpins} Bonus-Spin${bonusSpins > 1 ? "s" : ""} übrig!` : "Nächster Gratis-Spin in 24h verfügbar.";
  spinBtn.disabled = false;
});

buySpinBtn.addEventListener("click", async () => {
  buySpinBtn.disabled = true;
  const currentBalance = await getBalance(myUid);
  if (currentBalance < bonusSpinPrice) {
    statusEl.textContent = `Nicht genug Coins — du hast ${currentBalance} 🪙, brauchst ${bonusSpinPrice}.`;
    buySpinBtn.disabled = false;
    return;
  }
  const res = await buyBonusSpin(myUid);
  if (res.ok) {
    bonusSpins++;
    updateBonusInfo();
    statusEl.textContent = "🎁 Bonus Spin gekauft! Klick auf DREHEN.";
    sfx.coin ? sfx.coin() : null;
  } else if (res.reason === "insufficient") {
    statusEl.textContent = `Nicht genug Coins — du hast ${res.balance} 🪙, brauchst ${res.cost || bonusSpinPrice}.`;
  } else {
    statusEl.textContent = "Kauf fehlgeschlagen, versuch's nochmal.";
  }
  buySpinBtn.disabled = false;
});

leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });
