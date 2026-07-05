// MAP — Pixel-Art-Painter. 8x8 Referenz-Bild aus festem Set, 45s zum Nachmalen,
// Score = %-Genauigkeit am Ende.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const PALETTE = ["#1a1c26","#ffffff","#f59e0b","#ef4444","#22c55e","#3b82f6","#a855f7","#78350f"];

// Ein paar simple 8x8-Motive (Index in PALETTE pro Zelle), selbst designed.
const TEMPLATES = [
  // Herz
  [0,0,2,2,0,2,2,0, 0,2,2,2,2,2,2,0, 2,2,2,2,2,2,2,2, 2,2,2,2,2,2,2,2, 0,2,2,2,2,2,2,0, 0,0,2,2,2,2,0,0, 0,0,0,2,2,0,0,0, 0,0,0,0,0,0,0,0],
  // Smiley
  [0,0,2,2,2,2,0,0, 0,2,0,0,0,0,2,0, 2,0,1,0,0,1,0,2, 2,0,0,0,0,0,0,2, 2,0,1,0,0,1,0,2, 2,0,0,1,1,0,0,2, 0,2,0,0,0,0,2,0, 0,0,2,2,2,2,0,0],
  // Haus
  [0,0,0,3,3,0,0,0, 0,0,3,3,3,3,0,0, 0,3,3,3,3,3,3,0, 3,3,3,3,3,3,3,3, 3,6,6,3,3,6,6,3, 3,6,6,3,3,6,6,3, 3,6,6,3,3,6,6,3, 3,3,3,3,3,3,3,3],
];

const refGrid = document.getElementById("reference-grid");
const paintGrid = document.getElementById("paint-grid");
const paletteEl = document.getElementById("palette");
const timerEl = document.getElementById("timer");
const pctEl = document.getElementById("match-pct");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, template, userPixels, activeColor, timeLeft, timerInterval, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  clearInterval(timerInterval);
  template = TEMPLATES[Math.floor(Math.random()*TEMPLATES.length)];
  userPixels = Array(64).fill(0);
  activeColor = 0; timeLeft = 45; ended = false;
  timerEl.textContent = "⏱️ 45s"; pctEl.textContent = "Genauigkeit: 0%"; statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  renderPalette(); renderGrids();
  timerInterval = setInterval(tick, 1000);
}

function renderPalette() {
  paletteEl.innerHTML = "";
  PALETTE.forEach((color, idx) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (idx===activeColor ? " active" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => { activeColor = idx; renderPalette(); });
    paletteEl.appendChild(sw);
  });
}

function renderGrids() {
  refGrid.innerHTML = ""; paintGrid.innerHTML = "";
  template.forEach(colorIdx => {
    const cell = document.createElement("div");
    cell.className = "pixel-cell";
    cell.style.background = PALETTE[colorIdx];
    refGrid.appendChild(cell);
  });
  userPixels.forEach((colorIdx, i) => {
    const cell = document.createElement("div");
    cell.className = "pixel-cell";
    cell.style.background = PALETTE[colorIdx];
    if (!ended) cell.addEventListener("click", () => { userPixels[i] = activeColor; renderGrids(); updatePct(); sfx.move ? sfx.move() : null; });
    paintGrid.appendChild(cell);
  });
}

function updatePct() {
  const matches = userPixels.filter((v,i) => v === template[i]).length;
  pctEl.textContent = "Genauigkeit: " + Math.round((matches/64)*100) + "%";
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  if (timeLeft <= 0) endGame();
}

async function endGame() {
  if (ended) return;
  ended = true;
  clearInterval(timerInterval);
  const matches = userPixels.filter((v,i) => v === template[i]).length;
  const pct = Math.round((matches/64)*100);
  statusEl.textContent = `Fertig! ${pct}% genau nachgemalt.`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "pixelart", score: pct, at: serverTimestamp() });
    await awardGameReward(myUid, Math.min(pct*5, 500), "pixelart_score");
    loadLeaderboard();
  } catch (e) {}
}

restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "pixelart"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}%</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
