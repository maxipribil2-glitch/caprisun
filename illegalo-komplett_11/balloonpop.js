// MAP — Balloon Pop. Ballons steigen von unten hoch, tippen = platzen. 10 entkommene
// Ballons = Game Over. Speed steigt mit dem Score. Coins nach geplatzten Ballons.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const canvas = document.getElementById("balloon-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const missedEl = document.getElementById("missed");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const W = canvas.width, H = canvas.height, MAX_MISSED = 10;
const COLORS = ["#dc2626","#3b82f6","#22c55e","#f59e0b","#a855f7","#ec4899"];
let myUid, myName, balloons, score, missed, running, started, rafHandle, spawnTimer;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame(); draw();
});

function resetGame() {
  balloons = []; score = 0; missed = 0; running = false; started = false; spawnTimer = 0;
  scoreEl.textContent = "Geplatzt: 0";
  missedEl.textContent = "Entkommen: 0/" + MAX_MISSED;
  statusEl.textContent = "Tippen zum Starten";
  restartBtn.classList.add("hidden");
  cancelAnimationFrame(rafHandle);
}

function loop() {
  if (!running) return;
  update(); draw();
  rafHandle = requestAnimationFrame(loop);
}

function update() {
  const speedMult = 1 + score * 0.03;
  spawnTimer -= 1;
  if (spawnTimer <= 0) {
    balloons.push({
      x: 25 + Math.random() * (W - 50),
      y: H + 20,
      r: 16 + Math.random() * 10,
      vy: (1 + Math.random() * 0.8) * speedMult,
      wobble: Math.random() * Math.PI * 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
    spawnTimer = Math.max(18, 55 - score);
  }
  balloons.forEach(b => { b.y -= b.vy; b.wobble += 0.06; b.x += Math.sin(b.wobble) * 0.7; });
  const escaped = balloons.filter(b => b.y < -b.r).length;
  if (escaped) {
    missed += escaped;
    missedEl.textContent = `Entkommen: ${missed}/${MAX_MISSED}`;
    balloons = balloons.filter(b => b.y >= -b.r);
    if (missed >= MAX_MISSED) return gameOver();
  }
}

canvas.addEventListener("pointerdown", (e) => {
  if (!started) { started = true; running = true; statusEl.textContent = "Pop pop pop!"; loop(); return; }
  if (!running) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width), my = (e.clientY - rect.top) * (H / rect.height);
  for (let i = balloons.length - 1; i >= 0; i--) {
    const b = balloons[i];
    if (Math.hypot(mx - b.x, my - b.y) < b.r + 6) {
      balloons.splice(i, 1);
      score++;
      scoreEl.textContent = "Geplatzt: " + score;
      sfx.hit ? sfx.hit() : null;
      break; // ein Tap = max ein Ballon
    }
  }
});

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = "Game Over — " + score + " Ballons geplatzt!";
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "balloonpop", score, at: serverTimestamp() });
    await awardGameReward(myUid, Math.min(score * 6, 500), "balloonpop_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0, 0, W, H);
  balloons.forEach(b => {
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath(); ctx.moveTo(b.x, b.y + b.r); ctx.lineTo(b.x, b.y + b.r + 12); ctx.stroke();
  });
}

restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "balloonpop"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[balloonpop] Leaderboard-Query failed:", e);
  }
}
