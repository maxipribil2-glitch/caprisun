// MAP — Zeigt den MaxiCoin-Kontostand live als kleines Badge oben im Header an,
// nicht mehr nur bei Roulette sichtbar. Einfach in jeder Game-HTML einbinden:
//   <div id="coin-badge" class="coin-badge"></div>
//   <script type="module" src="coinBadge.js"></script>
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { toggleMute, getMuted } from "./sfx.js";
import { supabase } from "./supabase-config.js";

function ensureMuteBtn() {
  let btn = document.getElementById("mute-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "mute-btn";
    btn.className = "gc-theme-btn";
    btn.style.marginLeft = "4px";
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.appendChild(btn);
    btn.textContent = getMuted() ? "🔇" : "🔊";
    btn.addEventListener("click", () => { btn.textContent = toggleMute() ? "🔇" : "🔊"; });
  }
  return btn;
}
ensureMuteBtn();

const auth = getAuth(app);

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

// MAP FEATURE (Punkt 5): Coin-Badge zählt animiert hoch/runter statt instant zu
// springen — kleiner Polish-Effekt, macht Coin-Änderungen visuell greifbarer.
let displayedCoins = null;
let animFrame = null;
function animateCoinsTo(target, el) {
  if (displayedCoins === null) { displayedCoins = target; el.textContent = "💰 " + target; return; }
  cancelAnimationFrame(animFrame);
  const start = displayedCoins;
  const diff = target - start;
  if (diff === 0) return;
  const duration = Math.min(800, Math.max(250, Math.abs(diff) * 4));
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out
    displayedCoins = Math.round(start + diff * eased);
    el.textContent = "💰 " + displayedCoins;
    if (progress < 1) animFrame = requestAnimationFrame(step);
    else displayedCoins = target;
  }
  animFrame = requestAnimationFrame(step);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const el = ensureBadge();
  el.textContent = "💰 ...";

  // MAP FIX: initialer Fetch (Realtime-Subscription liefert erst beim NÄCHSTEN
  // Update einen Wert, nicht sofort den aktuellen Stand — ohne das würde die
  // Badge erstmal "..." zeigen bis irgendwas sich ändert)
  const { data: initial, error: initialErr } = await supabase.from("users").select("gamocoins").eq("firebase_uid", user.uid).maybeSingle();
  if (initialErr) {
    // MAP FIX: vorher wurde der Fehler hier komplett verschluckt (nur "data"
    // destrukturiert, "error" nie angeschaut) — deswegen war nie sichtbar WARUM
    // die Badge bei 0/leer hängen blieb.
    console.error("[coinBadge] initial fetch failed:", initialErr, "for uid:", user.uid);
  }
  console.log("[coinBadge] fetched for uid", user.uid, "-> ", initial);
  if (initial) animateCoinsTo(initial.gamocoins ?? 0, el);

  supabase
    .channel(`coin-badge-${user.uid}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "users", filter: `firebase_uid=eq.${user.uid}` },
      (payload) => { animateCoinsTo(payload.new.gamocoins ?? 0, el); }
    )
    .subscribe();
});
