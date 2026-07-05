// MAP — Bubble Shooter. Klassisches Match-3-Bubble-Prinzip, Hex-Grid, 3+ gleiche
// Farben verbunden = platzen. Bubbles rutschen alle paar Schüsse eine Reihe tiefer.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const canvas = document.getElementById("bubble-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const W = canvas.width, H = canvas.height, R = 16, COLS = 10, ROWS = 10;
const COLORS = ["#dc2626","#3b82f6","#22c55e","#f59e0b","#a855f7"];
const SHOOTER_Y = H - 30;

let myUid, myName, grid, current, shots, score, running, started, rafHandle, aimAngle = -Math.PI/2, projectile;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame(); draw();
});

function cellPos(row, col) {
  const offset = row % 2 === 1 ? R : 0;
  return { x: R + offset + col * R * 2, y: R + row * R * 1.7 };
}

function resetGame() {
  grid = Array.from({length: ROWS}, (_,r) => Array.from({length: COLS}, () => Math.random() < 0.7 ? COLORS[Math.floor(Math.random()*COLORS.length)] : null));
  for (let r = 5; r < ROWS; r++) grid[r] = Array(COLS).fill(null);
  current = COLORS[Math.floor(Math.random()*COLORS.length)];
  shots = 0; score = 0; running = false; started = false; projectile = null;
  scoreEl.textContent = "Score: 0";
  statusEl.textContent = "Tippen/Klicken zum Zielen & Schießen";
  restartBtn.classList.add("hidden");
  cancelAnimationFrame(rafHandle);
}

function loop() {
  if (!running) return;
  update(); draw();
  rafHandle = requestAnimationFrame(loop);
}

function update() {
  if (!projectile) return;
  projectile.x += projectile.vx; projectile.y += projectile.vy;
  if (projectile.x < R || projectile.x > W-R) projectile.vx *= -1;
  if (projectile.y < R) return landProjectile(0, findClosestCol(projectile.x, 0));

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!grid[r][c]) continue;
    const p = cellPos(r,c);
    if (Math.hypot(projectile.x-p.x, projectile.y-p.y) < R*1.8) {
      return landProjectile(Math.max(0,r-1), c);
    }
  }
}

function findClosestCol(x, row) {
  let best = 0, bestDist = Infinity;
  for (let c = 0; c < COLS; c++) {
    const p = cellPos(row, c);
    const d = Math.abs(p.x - x);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function landProjectile(row, col) {
  // Nächste freie Zelle in der Nähe finden
  let targetR = row, targetC = col;
  while (grid[targetR]?.[targetC]) targetR++;
  if (targetR >= ROWS) { projectile = null; return gameOver(); }
  if (!grid[targetR]) grid[targetR] = Array(COLS).fill(null);
  grid[targetR][targetC] = projectile.color;
  sfx.hit ? sfx.hit() : null;
  projectile = null;

  const cluster = findCluster(targetR, targetC, grid[targetR][targetC]);
  if (cluster.length >= 3) {
    cluster.forEach(([r,c]) => grid[r][c] = null);
    score += cluster.length * 10;
    scoreEl.textContent = "Score: " + score;
    sfx.win ? sfx.win() : null;
    dropFloating();
  }

  shots++;
  if (shots % 6 === 0) shiftDown();
  current = COLORS[Math.floor(Math.random()*COLORS.length)];

  // Game-Over-Check: unterste sichtbare Reihe erreicht Shooter
  for (let c=0;c<COLS;c++) if (grid[ROWS-2]?.[c]) return gameOver();
}

function findCluster(r, c, color) {
  const visited = new Set(), stack = [[r,c]], result = [];
  while (stack.length) {
    const [cr,cc] = stack.pop();
    const key = cr+","+cc;
    if (visited.has(key)) continue;
    visited.add(key);
    if (grid[cr]?.[cc] !== color) continue;
    result.push([cr,cc]);
    const offset = cr % 2 === 1 ? 1 : -1;
    [[cr,cc-1],[cr,cc+1],[cr-1,cc],[cr-1,cc+offset],[cr+1,cc],[cr+1,cc+offset]].forEach(([nr,nc]) => {
      if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS) stack.push([nr,nc]);
    });
  }
  return result;
}

function dropFloating() {
  // simple: Bubbles ohne Verbindung zur Decke fallen raus (vereinfachte Version)
  const connected = new Set();
  for (let c=0;c<COLS;c++) if (grid[0][c]) floodConnected(0,c,connected);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    if (grid[r][c] && !connected.has(r+","+c)) { grid[r][c] = null; score += 5; }
  }
  scoreEl.textContent = "Score: " + score;
}
function floodConnected(r,c,visited) {
  const key = r+","+c;
  if (visited.has(key) || !grid[r]?.[c]) return;
  visited.add(key);
  const offset = r % 2 === 1 ? 1 : -1;
  [[r,c-1],[r,c+1],[r-1,c],[r-1,c+offset],[r+1,c],[r+1,c+offset]].forEach(([nr,nc]) => {
    if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS) floodConnected(nr,nc,visited);
  });
}

function shiftDown() {
  for (let r = ROWS-1; r > 0; r--) grid[r] = grid[r-1];
  grid[0] = Array.from({length: COLS}, () => Math.random() < 0.5 ? COLORS[Math.floor(Math.random()*COLORS.length)] : null);
}

function shoot() {
  if (!started) { started = true; running = true; loop(); }
  if (projectile) return;
  projectile = { x: W/2, y: SHOOTER_Y, vx: Math.cos(aimAngle)*5, vy: Math.sin(aimAngle)*5, color: current };
}

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX-rect.left)*(W/rect.width), my = (e.clientY-rect.top)*(H/rect.height);
  aimAngle = Math.atan2(my-SHOOTER_Y, mx-W/2);
  if (aimAngle > -0.15) aimAngle = -0.15; // nicht nach unten schießen können
});
canvas.addEventListener("pointerdown", shoot);

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = "Game Over — Score: " + score;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "bubbleshooter", score, at: serverTimestamp() });
    await awardGameReward(myUid, Math.min(score, 500), "bubbleshooter_score");
    loadLeaderboard();
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0,0,W,H);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    if (!grid[r]?.[c]) continue;
    const p = cellPos(r,c);
    ctx.fillStyle = grid[r][c]; ctx.beginPath(); ctx.arc(p.x,p.y,R-1,0,Math.PI*2); ctx.fill();
  }
  if (projectile) { ctx.fillStyle = projectile.color; ctx.beginPath(); ctx.arc(projectile.x,projectile.y,R-1,0,Math.PI*2); ctx.fill(); }

  // Shooter + Aim-Linie
  ctx.fillStyle = current; ctx.beginPath(); ctx.arc(W/2, SHOOTER_Y, R-1, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(W/2,SHOOTER_Y); ctx.lineTo(W/2+Math.cos(aimAngle)*200, SHOOTER_Y+Math.sin(aimAngle)*200); ctx.stroke();
  ctx.setLineDash([]);
}

restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "bubbleshooter"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1, myBest = 0;
    snap.forEach(d => { const s = d.data(); if (s.uid===myUid) myBest=Math.max(myBest,s.score); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
    if (myBest) bestEl.textContent = "Dein Best: " + myBest;
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
