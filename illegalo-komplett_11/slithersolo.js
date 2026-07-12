// MAP — Slither Solo. Wie euer Snake.io, aber 3 einfache Bot-Schlangen statt echtem
// 1v1-Gegner, für die die grinden wollen ohne auf ne Invite zu warten.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const canvas = document.getElementById("slither-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const W = canvas.width, H = canvas.height, SEG = 8, SPEED = 2.2, BOT_COUNT = 3;
let myUid, myName, player, bots, pellets, running, rafHandle;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame(); draw();
});

function newSnake(x, y, color) {
  return { segs: [{x,y},{x:x-SEG,y},{x:x-SEG*2,y}], dir: {x:1,y:0}, color, alive: true };
}

function resetGame() {
  player = newSnake(W/2, H/2, "#60a5fa");
  bots = Array.from({length: BOT_COUNT}, (_,i) => newSnake(60+i*80, 60+i*40, ["#dc2626","#f59e0b","#a855f7"][i]));
  pellets = Array.from({length: 20}, () => ({ x: Math.random()*W, y: Math.random()*H }));
  running = false;
  scoreEl.textContent = "Länge: 3";
  statusEl.textContent = "Ziehen zum Steuern — 3 Bot-Schlangen sind im Feld!";
  restartBtn.classList.add("hidden");
  cancelAnimationFrame(rafHandle);
}

function loop() {
  if (!running) return;
  update(); draw();
  rafHandle = requestAnimationFrame(loop);
}

function moveSnake(snake) {
  const head = snake.segs[0];
  const nx = head.x + snake.dir.x*SPEED, ny = head.y + snake.dir.y*SPEED;
  snake.segs.unshift({x:nx,y:ny});
  snake.segs.pop();
}

function update() {
  moveSnake(player);
  bots.forEach(bot => {
    if (!bot.alive) return;
    // simpler Bot: zufällig leicht Richtung ändern, sonst geradeaus
    if (Math.random() < 0.03) {
      const angle = Math.atan2(bot.dir.y, bot.dir.x) + (Math.random()-0.5)*1.2;
      bot.dir = { x: Math.cos(angle), y: Math.sin(angle) };
    }
    moveSnake(bot);
    if (bot.segs[0].x<0||bot.segs[0].x>W||bot.segs[0].y<0||bot.segs[0].y>H) {
      bot.dir.x *= -1; bot.dir.y *= -1;
    }
  });

  // Wand-Kollision für Player
  const h = player.segs[0];
  if (h.x<0||h.x>W||h.y<0||h.y>H) return gameOver();

  // Selbst-Kollision
  for (let i=4;i<player.segs.length;i++) {
    const s = player.segs[i];
    if (Math.hypot(h.x-s.x, h.y-s.y) < SEG*0.8) return gameOver();
  }

  // Bot-Kollision (Player crasht in Bot)
  bots.forEach(bot => {
    if (!bot.alive) return;
    bot.segs.forEach(s => { if (Math.hypot(h.x-s.x,h.y-s.y) < SEG*0.9) gameOverSoon(); });
    // Bot crasht in Player = Bot stirbt, Player kriegt Bonus
    const botHead = bot.segs[0];
    player.segs.forEach((s,i) => { if (i>2 && Math.hypot(botHead.x-s.x,botHead.y-s.y) < SEG*0.9) { bot.alive = false; addBonus(30); } });
  });

  // Pellets
  pellets = pellets.filter(p => {
    if (Math.hypot(h.x-p.x, h.y-p.y) < SEG) {
      growSnake(player); sfx.hit ? sfx.hit() : null;
      return false;
    }
    return true;
  });
  while (pellets.length < 20) pellets.push({ x: Math.random()*W, y: Math.random()*H });

  scoreEl.textContent = "Länge: " + player.segs.length;
}

let pendingGameOver = false;
function gameOverSoon() { pendingGameOver = true; }
function growSnake(snake) {
  const tail = snake.segs[snake.segs.length-1];
  snake.segs.push({...tail});
}
function addBonus(amount) {
  for (let i=0;i<Math.floor(amount/10);i++) growSnake(player);
}

function draw() {
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = "#f59e0b";
  pellets.forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); });

  bots.forEach(bot => {
    if (!bot.alive) return;
    ctx.fillStyle = bot.color;
    bot.segs.forEach(s => { ctx.beginPath(); ctx.arc(s.x,s.y,SEG/2,0,Math.PI*2); ctx.fill(); });
  });

  ctx.fillStyle = player.color;
  player.segs.forEach(s => { ctx.beginPath(); ctx.arc(s.x,s.y,SEG/2,0,Math.PI*2); ctx.fill(); });

  if (pendingGameOver) { pendingGameOver = false; gameOver(); }
}

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = "Game Over — Länge: " + player.segs.length;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "slithersolo", score: player.segs.length, at: serverTimestamp() });
    } catch (e) { console.error("[slithersolo] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(player.segs.length*8, 500), "slithersolo_score");
    loadLeaderboard();
  } catch (e) {}
}

canvas.addEventListener("pointerdown", () => { if (!running) { running = true; loop(); } });
canvas.addEventListener("pointermove", (e) => {
  if (!running) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX-rect.left)*(W/rect.width), my = (e.clientY-rect.top)*(H/rect.height);
  const head = player.segs[0];
  const angle = Math.atan2(my-head.y, mx-head.x);
  player.dir = { x: Math.cos(angle), y: Math.sin(angle) };
});

restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "slithersolo"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1, myBest = 0;
    snap.forEach(d => { const s = d.data(); if (s.uid===myUid) myBest=Math.max(myBest,s.score); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
    if (myBest) bestEl.textContent = "Dein Best: " + myBest;
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
