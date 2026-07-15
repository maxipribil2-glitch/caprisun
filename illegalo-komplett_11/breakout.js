// MAP — classic solo Breakout. Pure local game loop; only the final score gets written
// to Firestore (collection "scores") so there's a shared leaderboard across the group.
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const db = getFirestore(app);

const canvas = document.getElementById("bo-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
const leaderboardEl = document.getElementById("leaderboard");
const padLeftBtn = document.getElementById("pad-left");
const padRightBtn = document.getElementById("pad-right");

const PADDLE_W = 64, PADDLE_H = 10, PADDLE_SPEED = 5.5;
const BALL_R = 6;
const BRICK_ROWS = 6, BRICK_COLS = 8, BRICK_H = 18, BRICK_GAP = 4, BRICK_TOP = 50;
const COLORS = ["#ff3864","#ffd60a","#39ff8c","#00e5ff","#b14aff","#ff2e9a"];

let myUid = null, myName = null;
let paddleX, ball, bricks, score, lives, alive, moveDir, loopHandle;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email;
  loadLeaderboard();
  resetGame();
  startLoop();
});

function buildBricks() {
  const brickW = (canvas.width - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS;
  const arr = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      arr.push({
        x: BRICK_GAP + c * (brickW + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        w: brickW, h: BRICK_H,
        color: COLORS[r % COLORS.length],
        alive: true
      });
    }
  }
  return arr;
}

function resetGame() {
  paddleX = (canvas.width - PADDLE_W) / 2;
  ball = { x: canvas.width/2, y: canvas.height - 60, vx: 2.6, vy: -3.6 };
  bricks = buildBricks();
  score = 0; lives = 3; alive = true; moveDir = 0;
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  updateHud();
  draw();
}

function updateHud() {
  scoreEl.textContent = "Score: " + score;
  livesEl.textContent = "Leben: " + "❤️".repeat(Math.max(0, lives));
}

function startLoop() {
  clearInterval(loopHandle);
  loopHandle = setInterval(tick, 1000 / 60);
}

function tick() {
  if (!alive) return;

  paddleX += moveDir * PADDLE_SPEED;
  paddleX = Math.max(0, Math.min(canvas.width - PADDLE_W, paddleX));

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx *= -1; }
  if (ball.x + BALL_R > canvas.width) { ball.x = canvas.width - BALL_R; ball.vx *= -1; }
  if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy *= -1; }

  // paddle collision
  const paddleY = canvas.height - 24;
  if (ball.vy > 0 && ball.y + BALL_R >= paddleY && ball.y + BALL_R <= paddleY + PADDLE_H + 6
      && ball.x >= paddleX - BALL_R && ball.x <= paddleX + PADDLE_W + BALL_R) {
    ball.vy = -Math.abs(ball.vy);
    const hitPos = (ball.x - (paddleX + PADDLE_W / 2)) / (PADDLE_W / 2);
    ball.vx = hitPos * 4.2;
    sfx.hit();
  }

  // brick collisions
  for (const b of bricks) {
    if (!b.alive) continue;
    if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w &&
        ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h) {
      b.alive = false;
      ball.vy *= -1;
      score += 10;
      updateHud();
      sfx.brick();
      break;
    }
  }

  if (bricks.every(b => !b.alive)) {
    win();
  } else if (ball.y - BALL_R > canvas.height) {
    lives--;
    updateHud();
    if (lives <= 0) {
      gameOver();
    } else {
      ball = { x: canvas.width/2, y: canvas.height - 60, vx: 2.6, vy: -3.6 };
    }
  }

  draw();
}

function setDir(dir) { moveDir = dir; }
window.addEventListener("keydown", e => {
  if (["ArrowLeft","a","A"].includes(e.key)) { e.preventDefault(); setDir(-1); }
  if (["ArrowRight","d","D"].includes(e.key)) { e.preventDefault(); setDir(1); }
});
window.addEventListener("keyup", e => {
  if (["ArrowLeft","ArrowRight","a","A","d","D"].includes(e.key)) setDir(0);
});
["pointerdown"].forEach(ev => {
  padLeftBtn.addEventListener(ev, () => setDir(-1));
  padRightBtn.addEventListener(ev, () => setDir(1));
});
["pointerup","pointerleave"].forEach(ev => {
  padLeftBtn.addEventListener(ev, () => setDir(0));
  padRightBtn.addEventListener(ev, () => setDir(0));
});
canvas.addEventListener("pointermove", e => {
  if (!alive) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  paddleX = Math.max(0, Math.min(canvas.width - PADDLE_W, x - PADDLE_W / 2));
});

function win() {
  alive = false;
  clearInterval(loopHandle);
  statusEl.textContent = "ALLE STEINE WEG! Score: " + score + " 🔥";
  restartBtn.classList.remove("hidden");
  sfx.win();
  submitScore();
}

async function gameOver() {
  alive = false;
  clearInterval(loopHandle);
  statusEl.textContent = "Game Over! Score: " + score;
  restartBtn.classList.remove("hidden");
  sfx.lose();
  submitScore();
}

async function submitScore() {
  // MAP FIX: vorher liefen Score-Submit und Coin-Vergabe im GLEICHEN try-Block,
  // hintereinander — falls der Firestore-Score-Write failte (egal aus welchem
  // Grund), lief die Coin-Vergabe NIE, weil sie danach im selben Block stand,
  // und der äußere catch(e){} hat alles still verschluckt, kein Logging. Jetzt
  // beide komplett unabhängig, mit sichtbarem Error-Logging.
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "breakout", score, createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("[breakout] Score-Submit fehlgeschlagen:", e);
  }
  try {
    const rewarded = await awardGameReward(myUid, Math.floor(score / 2), "breakout_score");
    if (!rewarded) console.warn("[breakout] Keine Coins vergeben (Score zu niedrig, Cooldown aktiv, oder Fehler)");
  } catch (e) {
    console.error("[breakout] Coin-Vergabe fehlgeschlagen:", e);
  }
  loadLeaderboard();
}

// MAP FEATURE (Verbesserungsvorschlag Punkt 7): Highscore-Zeitraum-Filter statt
// nur ewiger Top-5 — "Heute"/"Woche" nutzen createdAt (das Feld heißt hier
// "createdAt", andere Games könnten "at" nutzen, beim Ausrollen auf weitere
// Games checken!). Proof-of-Concept für breakout.js, noch nicht auf alle 20
// Solo-Games ausgerollt (zu viel Scope für einen Rutsch).
let lbFilter = "all";
document.querySelectorAll(".lb-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lb-filter-btn").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    lbFilter = btn.dataset.filter;
    loadLeaderboard();
  });
});

async function loadLeaderboard() {
  try {
    const snap = await getDocs(query(collection(db, "scores"), where("game", "==", "breakout")));
    let all = snap.docs.map(d => d.data());
    const mine = all.filter(s => s.uid === myUid).map(s => s.score);
    bestEl.textContent = "Best: " + (mine.length ? Math.max(...mine) : 0);

    if (lbFilter !== "all") {
      const cutoffMs = lbFilter === "today"
        ? new Date().setHours(0,0,0,0)
        : Date.now() - 7*24*60*60*1000;
      all = all.filter(s => (s.createdAt?.toMillis?.() || 0) >= cutoffMs);
    }

    const top = [...all].sort((a, b) => b.score - a.score).slice(0, 5);
    leaderboardEl.innerHTML = top.length
      ? top.map((s, i) => `<li><span>#${i + 1} ${s.name || "?"}</span><span>${s.score}</span></li>`).join("")
      : `<li class="empty">${lbFilter === "all" ? "Noch keine Scores — sei der Erste!" : "Noch keine Scores in diesem Zeitraum."}</li>`;
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  bricks.forEach(b => {
    if (!b.alive) return;
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color; ctx.shadowBlur = 6;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });
  ctx.shadowBlur = 0;

  const paddleY = canvas.height - 24;
  ctx.fillStyle = "#00e5ff";
  ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 8;
  ctx.fillRect(paddleX, paddleY, PADDLE_W, PADDLE_H);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#ffd60a";
  ctx.shadowColor = "#ffd60a"; ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

restartBtn.addEventListener("click", () => { resetGame(); startLoop(); });
leaveBtn.addEventListener("click", () => {
  clearInterval(loopHandle);
  window.location.href = "lobby.html";
});
