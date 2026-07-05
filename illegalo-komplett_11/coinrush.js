// MAP — Coin Rush. Wie ein Endless-Runner (Dino-Game-Style), aber Coins droppen
// LIVE während des Runs und werden bei Kollision direkt eingesammelt + sofort per
// awardGameReward gutgeschrieben — man sieht den Kontostand quasi live steigen,
// statt nur am Ende nen Bonus zu kriegen. Bei Game Over gibt's KEINEN nachträglichen
// Bonus mehr (die Coins wurden ja schon während des Runs einzeln vergeben).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { addLiveDropCoins, resetLiveDropSession } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const canvas = document.getElementById("rush-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const coinsLiveEl = document.getElementById("coins-live");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const GROUND_Y = 340, GRAVITY = 0.7, JUMP_VY = -13;
let myUid, myName, player, obstacles, coins, distance, coinsCollected, speed, running, started, rafHandle, spawnTimer, coinSpawnTimer;

// MAP FIX: Coin-Sammlung wird pro Run hard-gecappt bei 500, EXAKT gleiches Limit wie
// überall sonst über awardGameReward — hier aber inkrementell statt einmalig, weil
// die Coins ja live während des Laufs gesammelt werden.
const MAX_COINS_PER_RUN = 500;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetLiveDropSession(myUid); resetGame(); draw();
});

function resetGame() {
  player = { x: 50, y: GROUND_Y, vy: 0, w: 26, h: 30, onGround: true };
  obstacles = []; coins = [];
  distance = 0; coinsCollected = 0; speed = 4; running = false; started = false;
  scoreEl.textContent = "Distanz: 0m";
  coinsLiveEl.textContent = "💰 +0";
  statusEl.textContent = "Tippen/Leertaste zum Springen — Coins live einsammeln!";
  restartBtn.classList.add("hidden");
  cancelAnimationFrame(rafHandle);
  spawnTimer = 0; coinSpawnTimer = 0;
}

function jump() {
  if (!started) { started = true; running = true; loop(); return; }
  if (!running) return;
  if (player.onGround) { player.vy = JUMP_VY; player.onGround = false; sfx.move ? sfx.move() : null; }
}

function loop() {
  if (!running) return;
  update(); draw();
  rafHandle = requestAnimationFrame(loop);
}

function update() {
  distance += speed * 0.08;
  speed = Math.min(4 + distance / 60, 10);
  scoreEl.textContent = "Distanz: " + Math.floor(distance) + "m";

  player.vy += GRAVITY;
  player.y += player.vy;
  if (player.y >= GROUND_Y) { player.y = GROUND_Y; player.vy = 0; player.onGround = true; }

  spawnTimer -= 1;
  if (spawnTimer <= 0) {
    obstacles.push({ x: canvas.width, w: 20, h: 30 + Math.random() * 20 });
    spawnTimer = 60 + Math.random() * 50 - speed * 3;
  }
  coinSpawnTimer -= 1;
  if (coinSpawnTimer <= 0) {
    coins.push({ x: canvas.width, y: GROUND_Y - 20 - Math.random() * 90, r: 9 });
    coinSpawnTimer = 35 + Math.random() * 40;
  }

  obstacles.forEach(o => o.x -= speed);
  coins.forEach(c => c.x -= speed);
  obstacles = obstacles.filter(o => o.x > -40);

  // Coin-Kollision
  coins = coins.filter(c => {
    const dx = (player.x + player.w/2) - c.x, dy = (player.y - 10) - c.y;
    if (Math.sqrt(dx*dx + dy*dy) < 22) {
      // MAP FIX: Hard-Cap bei 500 pro Run, egal wie lang der Run künstlich gezogen wird
      // (Auto-Clicker etc.) — vorher gab's kein Gesamt-Limit, nur pro Münze 5 Coins.
      if (coinsCollected < MAX_COINS_PER_RUN) {
        const amount = Math.min(5, MAX_COINS_PER_RUN - coinsCollected);
        coinsCollected += amount;
        coinsLiveEl.textContent = "💰 +" + coinsCollected;
        addLiveDropCoins(myUid, amount, "coinrush_live").catch(() => {});
        sfx.coin ? sfx.coin() : null;
      }
      return false;
    }
    return c.x > -20;
  });

  // Hindernis-Kollision
  for (const o of obstacles) {
    const px1 = player.x, px2 = player.x + player.w;
    const oy1 = GROUND_Y + 30 - o.h;
    if (px2 > o.x && px1 < o.x + o.w && player.y + player.h > oy1) {
      return gameOver();
    }
  }
}

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = `Gecrasht bei ${Math.floor(distance)}m — ${coinsCollected} Coins gesammelt!`;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "coinrush", score: Math.floor(distance), at: serverTimestamp() });
    loadLeaderboard();
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#0c1420";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#3a3f58";
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y + 30); ctx.lineTo(canvas.width, GROUND_Y + 30); ctx.stroke();

  ctx.fillStyle = "#f59e0b";
  coins.forEach(c => { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI*2); ctx.fill(); });

  ctx.fillStyle = "#dc2626";
  obstacles.forEach(o => ctx.fillRect(o.x, GROUND_Y + 30 - o.h, o.w, o.h));

  ctx.fillStyle = "#60a5fa";
  ctx.fillRect(player.x, player.y - player.h + 30, player.w, player.h);
}

canvas.addEventListener("pointerdown", jump);
window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); jump(); } });
restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "coinrush"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}m</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
