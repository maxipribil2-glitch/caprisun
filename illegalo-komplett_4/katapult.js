// MAP — Katapult Tower. Simplified custom physics (no external library): drag the ball
// back from the sling anchor, release to launch it at the tower. A hit knocks a block into
// a falling state. Each shot ends when the ball leaves the play area OR after a fixed
// frame timeout (failsafe so a shot can never get the game "stuck" if a corner case in
// the collision math doesn't resolve cleanly).
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const canvas = document.getElementById("kat-canvas");
const ctx = canvas.getContext("2d");
const shotsEl = document.getElementById("shots");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
const leaderboardEl = document.getElementById("leaderboard");

const GRAVITY = 0.5;
const FLOOR_Y_OFFSET = 16;
const BALL_R = 11;
const MAX_SHOT_FRAMES = 240; // ~4s failsafe at 60fps
const SLING = { x: 56, y: 0 };

let myUid = null, myName = null;
let blocks = [];
let ball = null;
let shotsLeft = 5;
let shotFrames = 0;
let aiming = false;
let aimPos = null;
let roundOver = false;
let rafHandle = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email;
  loadLeaderboard();
  initRound();
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(physicsStep);
});

function buildTower() {
  blocks = [];
  const floorY = canvas.height - FLOOR_Y_OFFSET;
  const blockW = 86, blockH = 26, count = 7;
  const towerX = canvas.width - blockW - 40;
  for (let i = 0; i < count; i++) {
    blocks.push({
      x: towerX, y: floorY - (i + 1) * blockH,
      w: blockW, h: blockH,
      vx: 0, vy: 0,
      knocked: false
    });
  }
}

function resetBall() {
  ball = { x: SLING.x, y: SLING.y, r: BALL_R, vx: 0, vy: 0, active: false };
}

function initRound() {
  SLING.y = canvas.height - FLOOR_Y_OFFSET - BALL_R;
  buildTower();
  resetBall();
  shotsLeft = 5;
  roundOver = false;
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  updateHud();
}

function circleRectOverlap(c, r) {
  const closestX = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const closestY = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - closestX, dy = c.y - closestY;
  return (dx * dx + dy * dy) < (c.r * c.r);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches && e.touches.length ? e.touches[0].clientX : e.clientX;
  const cy = e.touches && e.touches.length ? e.touches[0].clientY : e.clientY;
  return {
    x: (cx - rect.left) * (canvas.width / rect.width),
    y: (cy - rect.top) * (canvas.height / rect.height)
  };
}

canvas.addEventListener("pointerdown", e => {
  if (roundOver || ball.active || shotsLeft <= 0) return;
  aiming = true;
  aimPos = getPos(e);
});
window.addEventListener("pointermove", e => {
  if (!aiming) return;
  aimPos = getPos(e);
});
window.addEventListener("pointerup", () => {
  if (!aiming) return;
  aiming = false;
  if (aimPos) launch(aimPos);
});

function launch(pos) {
  const dx = SLING.x - pos.x;
  const dy = SLING.y - pos.y;
  const dist = Math.min(Math.hypot(dx, dy), 130);
  if (dist < 12) return; // too weak — doesn't cost a shot
  const angle = Math.atan2(dy, dx);
  const speed = 6 + (dist / 130) * 15;
  ball.vx = Math.cos(angle) * speed;
  ball.vy = Math.sin(angle) * speed;
  ball.active = true;
  shotFrames = 0;
  shotsLeft--;
  updateHud();
}

function physicsStep() {
  if (ball.active) {
    shotFrames++;
    ball.vy += GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;

    blocks.forEach(b => {
      if (b.knocked) {
        b.vy += GRAVITY;
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.98;
      } else if (circleRectOverlap(ball, b)) {
        b.knocked = true;
        b.vx = ball.vx * 0.5 + (Math.random() * 2 - 1);
        b.vy = -Math.abs(ball.vy) * 0.4 - 2;
        ball.vx *= 0.4;
        ball.vy *= -0.25;
      }
    });

    const offscreen = ball.x < -60 || ball.x > canvas.width + 60 || ball.y > canvas.height + 80;
    const timedOut = shotFrames > MAX_SHOT_FRAMES;
    if (offscreen || timedOut) endShot();
  }
  draw();
  rafHandle = requestAnimationFrame(physicsStep);
}

function endShot() {
  ball.active = false;
  resetBall();
  updateHud();
  if (shotsLeft <= 0) finishRound();
}

function currentScore() { return blocks.filter(b => b.knocked).length; }

function updateHud() {
  shotsEl.textContent = "Schüsse übrig: " + shotsLeft;
  scoreEl.textContent = "Blöcke umgehauen: " + currentScore();
}

async function finishRound() {
  roundOver = true;
  const finalScore = currentScore();
  statusEl.textContent = `Runde fertig! ${finalScore} von ${blocks.length} Blöcken umgehauen.`;
  restartBtn.classList.remove("hidden");
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "katapult", score: finalScore, createdAt: serverTimestamp()
    });
  } catch (e) {}
  loadLeaderboard();
}

async function loadLeaderboard() {
  try {
    const snap = await getDocs(query(collection(db, "scores"), where("game", "==", "katapult")));
    const all = snap.docs.map(d => d.data());
    const top = [...all].sort((a, b) => b.score - a.score).slice(0, 5);
    leaderboardEl.innerHTML = top.length
      ? top.map((s, i) => `<li><span>#${i + 1} ${s.name || "?"}</span><span>${s.score}</span></li>`).join("")
      : `<li class="empty">Noch keine Scores — sei der Erste!</li>`;
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#13151c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#262a35";
  ctx.fillRect(0, canvas.height - FLOOR_Y_OFFSET, canvas.width, FLOOR_Y_OFFSET);

  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SLING.x, canvas.height - FLOOR_Y_OFFSET);
  ctx.lineTo(SLING.x, SLING.y);
  ctx.stroke();

  if (aiming && aimPos) {
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SLING.x, SLING.y);
    ctx.lineTo(aimPos.x, aimPos.y);
    ctx.stroke();
  }

  blocks.forEach(b => {
    ctx.fillStyle = b.knocked ? "#6b7280" : "#8b5cf6";
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });

  const drawX = aiming && aimPos ? aimPos.x : ball.x;
  const drawY = aiming && aimPos ? aimPos.y : ball.y;
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(drawX, drawY, ball.r, 0, Math.PI * 2);
  ctx.fill();
}

restartBtn.addEventListener("click", () => { initRound(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });
