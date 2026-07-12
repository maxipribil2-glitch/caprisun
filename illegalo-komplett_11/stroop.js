// MAP — Farb-Reflex (Stroop-Effekt). Wort zeigt einen Farbnamen, ist aber in
// anderer Farbe gefärbt — klick die TATSÄCHLICHE Farbe. 30s, Coins nach Richtig-Zahl.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const COLORS = [
  { name: "ROT",    css: "#dc2626" },
  { name: "BLAU",   css: "#3b82f6" },
  { name: "GRÜN",   css: "#22c55e" },
  { name: "GELB",   css: "#eab308" },
];

const wordEl = document.getElementById("stroop-word");
const btnsEl = document.getElementById("color-btns");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, score, timeLeft, timerInterval, started, ended, currentColorIdx;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function resetGame() {
  clearInterval(timerInterval);
  score = 0; timeLeft = 30; started = false; ended = false;
  timerEl.textContent = "⏱️ 30s"; scoreEl.textContent = "Richtig: 0";
  statusEl.textContent = "Tippen zum Starten"; restartBtn.classList.add("hidden");
  wordEl.textContent = "—"; wordEl.style.color = "var(--tx)";
  renderButtons();
  wordEl.addEventListener("click", startOnce, { once: true });
}

function startOnce() {
  if (started) return;
  started = true;
  statusEl.textContent = "Los!";
  timerInterval = setInterval(tick, 1000);
  nextWord();
}

function renderButtons() {
  btnsEl.innerHTML = "";
  COLORS.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = "stroop-btn";
    btn.style.background = c.css;
    btn.textContent = c.name;
    btn.addEventListener("click", () => pick(idx));
    btnsEl.appendChild(btn);
  });
}

function nextWord() {
  // Wort-Name und Anzeige-Farbe absichtlich meistens UNTERSCHIEDLICH (Stroop-Falle)
  const wordIdx = Math.floor(Math.random() * COLORS.length);
  let colorIdx = Math.floor(Math.random() * COLORS.length);
  if (Math.random() < 0.75 && colorIdx === wordIdx) colorIdx = (colorIdx + 1) % COLORS.length;
  currentColorIdx = colorIdx;
  wordEl.textContent = COLORS[wordIdx].name;
  wordEl.style.color = COLORS[colorIdx].css;
}

function pick(idx) {
  if (!started || ended) return;
  if (idx === currentColorIdx) {
    score++;
    scoreEl.textContent = "Richtig: " + score;
    sfx.hit ? sfx.hit() : null;
  } else {
    score = Math.max(0, score - 1); // Fehler kostet einen Punkt, hält Random-Spam unattraktiv
    scoreEl.textContent = "Richtig: " + score;
    sfx.lose ? sfx.lose() : null;
  }
  nextWord();
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  if (timeLeft <= 0) endGame();
}

async function endGame() {
  ended = true;
  clearInterval(timerInterval);
  statusEl.textContent = `Zeit um! ${score} richtige Farben.`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "stroop", score, at: serverTimestamp() });
    } catch (e) { console.error("[stroop] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(score * 12, 500), "stroop_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {}
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "stroop"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[stroop] Leaderboard-Query failed — evtl. fehlt ein Firestore Composite-Index:", e);
  }
}
