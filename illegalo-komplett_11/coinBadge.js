// MAP — Zeigt den GamoCoin-Kontostand live als kleines Badge oben im Header an,
// nicht mehr nur bei Roulette sichtbar. Einfach in jeder Game-HTML einbinden:
//   <div id="coin-badge" class="coin-badge"></div>
//   <script type="module" src="coinBadge.js"></script>
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

function ensureBadge() {
  let el = document.getElementById("coin-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "coin-badge";
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      topbar.style.flexWrap = "wrap"; // MAP FIX: verhindert Abschneiden bei langen Titeln
      topbar.appendChild(el);
    }
  }
  el.className = "coin-badge";
  if (!el.style.cssText) {
    el.style.cssText = "font-family:'Press Start 2P',monospace;font-size:11px;color:#f59e0b;padding:4px 10px;background:#1a1c26;border-radius:12px;white-space:nowrap;flex-shrink:0;margin-left:auto;";
  }
  return el;
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  const el = ensureBadge();
  el.textContent = "💰 ...";
  onSnapshot(doc(db, "users", user.uid), (snap) => {
    const coins = snap.exists() ? (snap.data().gamocoins ?? 0) : 0;
    el.textContent = "💰 " + coins;
  });
});
