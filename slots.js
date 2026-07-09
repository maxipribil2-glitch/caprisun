// MAP — Einarmiger Bandit. 1x pro Tag, meistens Coins, ganz selten Jackpot
// (7-7-7 = "keine zusätzlichen Lieferkosten"-Voucher statt Coins). Serverseitig
// gecappt & gegated über spinSlotMachine() in gamocoin.js — kein Client-Cheat möglich.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { spinSlotMachine } from "./gamocoin.js";

const auth = getAuth(app);
const spinBtn = document.getElementById("spin-btn");
const statusEl = document.getElementById("status");
const cooldownEl = document.getElementById("cooldown-info");
const leaveBtn = document.getElementById("leave-btn");
const reelEls = [document.getElementById("reel-0"), document.getElementById("reel-1"), document.getElementById("reel-2")];
renderShopAd("shop-ad");

const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
let myUid;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
});

spinBtn.addEventListener("click", async () => {
  spinBtn.disabled = true;
  statusEl.textContent = "";
  cooldownEl.textContent = "";

  // Visuelle Spin-Animation (rein kosmetisch, das ECHTE Ergebnis kommt vom Server)
  reelEls.forEach(el => el.classList.add("spinning"));
  const spinAnim = setInterval(() => {
    reelEls.forEach(el => { el.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; });
  }, 80);
  sfx.move ? sfx.move() : null;

  const res = await spinSlotMachine(myUid);

  await new Promise(r => setTimeout(r, 1200)); // kurze Spannung aufbauen
  clearInterval(spinAnim);
  reelEls.forEach(el => el.classList.remove("spinning"));

  if (!res.spun) {
    if (res.reason === "too_soon" && res.nextSpin) {
      const hoursLeft = Math.ceil((res.nextSpin - Date.now()) / 3600000);
      statusEl.textContent = "Heute schon gedreht!";
      cooldownEl.textContent = `Nächster Spin in ~${hoursLeft}h ⏳`;
    } else {
      statusEl.textContent = "Konnte grad nicht drehen, versuch's nochmal.";
      spinBtn.disabled = false;
    }
    return;
  }

  res.reels.forEach((symbol, i) => { reelEls[i].textContent = symbol; });

  if (res.isJackpot) {
    statusEl.innerHTML = `🎉🎉🎉 JACKPOT! 🎉🎉🎉<br><strong>Keine Lieferkosten für deine nächste Bestellung!</strong>`;
    sfx.win ? sfx.win() : null;
  } else if (res.coinsWon >= 2000) {
    statusEl.textContent = `🔥 3 Gleiche! +${res.coinsWon} 🪙`;
    sfx.win ? sfx.win() : null;
    sfx.coin ? sfx.coin() : null;
  } else {
    statusEl.textContent = `+${res.coinsWon} 🪙 — morgen nochmal versuchen!`;
    sfx.coin ? sfx.coin() : null;
  }
  cooldownEl.textContent = "Nächster Spin in 24h verfügbar.";
});

leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });
