// MAP — Whack-a-Mole. 3x3-Grid, 30s Timer, Maulwürfe poppen zufällig hoch für ~800ms.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";
import { spriteCanvas } from "./pixelSprites.js";

const auth = getAuth(app), db = getFirestore(app);
const HOLES = 9;
const gridEl = document.getElementById("mole-grid");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, score, timeLeft, timerInterval, moleTimer, started, ended, activeHole = -1;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function resetGame() {
  clearInterval(timerInterval); clearTimeout(moleTimer);
  score = 0; timeLeft = 30; started = false; ended = false; activeHole = -1;
  timerEl.textContent = "⏱️ 30s"; scoreEl.textContent = "Treffer: 0";
  statusEl.textContent = "Tippen zum Starten"; restartBtn.classList.add("hidden");
  renderGrid();
  gridEl.addEventListener("click", startOnce, { once: true });
}

function startOnce() {
  if (started) return;
  started = true;
  timerInterval = setInterval(tick, 1000);
  popMole();
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (let i = 0; i < HOLES; i++) {
    const hole = document.createElement("div");
    hole.className = "mole-hole" + (i === activeHole ? " up" : "");
    // MAP FEATURE (Verbesserungsvorschlag Punkt 6): Pixel-Sprite statt Emoji —
    // sieht auf jedem Gerät identisch aus statt je nach OS unterschiedlich.
    if (i === activeHole) hole.appendChild(spriteCanvas("mole", 40));
    hole.addEventListener("click", () => hitMole(i));
    gridEl.appendChild(hole);
  }
}

function popMole() {
  if (ended) return;
  activeHole = Math.floor(Math.random() * HOLES);
  renderGrid();
  moleTimer = setTimeout(() => {
    if (!ended) { activeHole = -1; renderGrid(); setTimeout(popMole, 250 + Math.random()*300); }
  }, 700 + Math.random()*300);
}

// MAP FIX (Punkt 3): 80ms Cooldown zwischen zwei Treffern generell, damit Auto-
// Clicker-Scripts nicht unrealistisch viele Treffer in kurzer Zeit farmen können —
// ein Mensch klickt eh nicht schneller als das, kein Nachteil für normale Spieler.
let lastHitAt = 0;
const HIT_COOLDOWN_MS = 80;

function hitMole(i) {
  if (!started || ended || i !== activeHole) return;
  const now = Date.now();
  if (now - lastHitAt < HIT_COOLDOWN_MS) return;
  lastHitAt = now;
  score++;
  scoreEl.textContent = "Treffer: " + score;
  sfx.hit ? sfx.hit() : null;
  clearTimeout(moleTimer);
  activeHole = -1; renderGrid();
  setTimeout(popMole, 150);
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  if (timeLeft <= 0) endGame();
}

async function endGame() {
  ended = true;
  clearInterval(timerInterval); clearTimeout(moleTimer);
  activeHole = -1; renderGrid();
  statusEl.textContent = `Zeit abgelaufen! ${score} Treffer.`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "wham", score, at: serverTimestamp() });
    } catch (e) { console.error("[wham] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(score*15, 500), "wham_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {}
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); clearTimeout(moleTimer); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "wham"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
