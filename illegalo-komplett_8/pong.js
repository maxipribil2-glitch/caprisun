// MAP — Pong (1v1), Echtzeit wie Snake.io: nur der "Authority"-Client (wer eingeladen hat,
// also room.players[0]) rechnet die Ball-Physik & schreibt den vollen State periodisch (80ms).
// Der andere Client schreibt nur seine EIGENE Paddle-Position (kleines Feld-Update), nie den
// ganzen State. Beide Clients bewegen ihr EIGENES Paddle lokal sofort (für direktes Gefühl),
// das Gegner-Paddle + der Ball kommen aus dem synced Firestore-Doc.
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";

const auth = getAuth(app);
const db = getFirestore(app);

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");

const canvas = document.getElementById("pong-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const scoreLineEl = document.getElementById("score-line");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
const padUpBtn = document.getElementById("pad-up");
const padDownBtn = document.getElementById("pad-down");

if (!roomId) { window.location.href = "lobby.html"; }

const PADDLE_W = 10, PADDLE_H = 50, PADDLE_SPEED = 4.2;
const BALL_R = 7;
const WIN_SCORE = 5;
const TICK_MS = 80;
const LEFT_X = 14, RIGHT_X = canvas.width - 14 - PADDLE_W;

let myUid = null;
let roomRef = null;
let currentRoom = null;
let tickHandle = null;
let myPaddleY = (canvas.height - PADDLE_H) / 2;
let moveDir = 0; // -1 up, 1 down, 0 still
let writeThrottle = null;
let lastTotalScore = 0;
let lastStatus = null;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    renderInfo();
  });
  clearInterval(tickHandle);
  tickHandle = setInterval(authorityTick, TICK_MS);
  requestAnimationFrame(localLoop);
});

function isAuthority() { return currentRoom && currentRoom.players && currentRoom.players[0] === myUid; }
function mySlot() { return currentRoom && currentRoom.players[0] === myUid ? "left" : "right"; }
function opponentUid() { return currentRoom ? currentRoom.players.find(p => p !== myUid) : null; }

// ── lokale, sofortige Paddle-Bewegung (für direktes Gefühl, unabhängig vom Sync) ──
function localLoop() {
  if (currentRoom && currentRoom.status === "active") {
    myPaddleY += moveDir * PADDLE_SPEED;
    myPaddleY = Math.max(0, Math.min(canvas.height - PADDLE_H, myPaddleY));
    if (moveDir !== 0) throttledSendPaddle();
  }
  draw();
  requestAnimationFrame(localLoop);
}

function throttledSendPaddle() {
  if (writeThrottle) return;
  writeThrottle = setTimeout(() => { writeThrottle = null; }, 70);
  const field = `paddles.${myUid}.y`;
  updateDoc(roomRef, { [field]: myPaddleY }).catch(() => {});
}

function setMoveDir(dir) { moveDir = dir; }
window.addEventListener("keydown", e => {
  if (["ArrowUp", "w", "W"].includes(e.key)) { e.preventDefault(); setMoveDir(-1); }
  if (["ArrowDown", "s", "S"].includes(e.key)) { e.preventDefault(); setMoveDir(1); }
});
window.addEventListener("keyup", e => {
  if (["ArrowUp","ArrowDown","w","W","s","S"].includes(e.key)) setMoveDir(0);
});
["pointerdown"].forEach(ev => {
  padUpBtn.addEventListener(ev, () => setMoveDir(-1));
  padDownBtn.addEventListener(ev, () => setMoveDir(1));
});
["pointerup","pointerleave"].forEach(ev => {
  padUpBtn.addEventListener(ev, () => setMoveDir(0));
  padDownBtn.addEventListener(ev, () => setMoveDir(0));
});

// ── Authority: rechnet Ball-Physik + Kollisionen, schreibt vollen State ──
function authorityTick() {
  if (!isAuthority() || !currentRoom || currentRoom.status !== "active") return;
  const room = currentRoom;
  const ball = { ...room.ball };
  const oppUid = opponentUid();
  const leftY = room.players[0] === myUid ? myPaddleY : (room.paddles[room.players[0]]?.y ?? myPaddleY);
  const rightY = room.players[1] === myUid ? myPaddleY : (room.paddles[room.players[1]]?.y ?? myPaddleY);

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy *= -1; }
  if (ball.y + BALL_R > canvas.height) { ball.y = canvas.height - BALL_R; ball.vy *= -1; }

  // left paddle collision
  if (ball.vx < 0 && ball.x - BALL_R <= LEFT_X + PADDLE_W && ball.x - BALL_R >= LEFT_X - 6
      && ball.y >= leftY && ball.y <= leftY + PADDLE_H) {
    ball.vx = Math.abs(ball.vx) * 1.04;
    ball.vy += (ball.y - (leftY + PADDLE_H/2)) * 0.08;
  }
  // right paddle collision
  if (ball.vx > 0 && ball.x + BALL_R >= RIGHT_X && ball.x + BALL_R <= RIGHT_X + PADDLE_W + 6
      && ball.y >= rightY && ball.y <= rightY + PADDLE_H) {
    ball.vx = -Math.abs(ball.vx) * 1.04;
    ball.vy += (ball.y - (rightY + PADDLE_H/2)) * 0.08;
  }

  let scores = { ...room.scores };
  let scored = false;
  if (ball.x < -20) { scores[room.players[1]] = (scores[room.players[1]] || 0) + 1; scored = true; }
  if (ball.x > canvas.width + 20) { scores[room.players[0]] = (scores[room.players[0]] || 0) + 1; scored = true; }

  let newBall = ball;
  if (scored) {
    newBall = { x: canvas.width/2, y: canvas.height/2, vx: (Math.random()<0.5?-1:1)*3.2, vy: (Math.random()*2-1)*2.4 };
  }

  const paddles = { ...room.paddles, [myUid]: { y: myPaddleY } };
  let status = room.status, winner = room.winner;
  const wasActive = room.status === "active";
  const p0Score = scores[room.players[0]] || 0, p1Score = scores[room.players[1]] || 0;
  if (p0Score >= WIN_SCORE || p1Score >= WIN_SCORE) {
    status = "finished";
    winner = p0Score >= WIN_SCORE ? room.players[0] : room.players[1];
  }

  updateDoc(roomRef, { ball: newBall, paddles, scores, status, winner, tick: (room.tick || 0) + 1 }).catch(() => {});
  if (wasActive && status === "finished") {
    addDoc(collection(db, "matchResults"), {
      game: "pong", players: room.players, playerNames: room.playerNames,
      winner, at: serverTimestamp()
    }).catch(() => {});
  }
}

function renderInfo() {
  const room = currentRoom;
  maybeShowReaction(room);
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}`;
  const myScore = room.scores?.[myUid] || 0;
  const oppScore = room.scores?.[oppUid] || 0;
  scoreLineEl.innerHTML = `<strong>${myScore}</strong> — <strong>${oppScore}</strong>`;

  const totalScore = myScore + oppScore;
  if (totalScore > lastTotalScore && room.status !== "finished") sfx.score();
  lastTotalScore = totalScore;

  if (room.status === "finished") {
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : `${room.playerNames[oppUid] || "Gegner"} hat gewonnen.`;
    if (lastStatus !== "finished") { room.winner === myUid ? sfx.win() : sfx.lose(); }
    rematchBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = "Los geht's!";
    rematchBtn.classList.add("hidden");
  }
  lastStatus = room.status;
}

function draw() {
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#4a2f7a";
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(canvas.width/2, 0);
  ctx.lineTo(canvas.width/2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!currentRoom) { return; }
  const room = currentRoom;
  const leftIsMe = mySlot() === "left";
  const leftY = leftIsMe ? myPaddleY : (room.paddles?.[room.players[0]]?.y ?? (canvas.height-PADDLE_H)/2);
  const rightY = !leftIsMe ? myPaddleY : (room.paddles?.[room.players[1]]?.y ?? (canvas.height-PADDLE_H)/2);

  ctx.fillStyle = "#ff2e9a";
  ctx.shadowColor = "#ff2e9a"; ctx.shadowBlur = 8;
  ctx.fillRect(LEFT_X, leftY, PADDLE_W, PADDLE_H);
  ctx.fillStyle = "#ffd60a";
  ctx.shadowColor = "#ffd60a";
  ctx.fillRect(RIGHT_X, rightY, PADDLE_W, PADDLE_H);
  ctx.shadowBlur = 0;

  const ball = room.ball || { x: canvas.width/2, y: canvas.height/2 };
  ctx.fillStyle = "#00e5ff";
  ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    ball: { x: canvas.width/2, y: canvas.height/2, vx: (Math.random()<0.5?-1:1)*3.2, vy: (Math.random()*2-1)*2.4 },
    paddles: {
      [currentRoom.players[0]]: { y: (canvas.height-PADDLE_H)/2 },
      [currentRoom.players[1]]: { y: (canvas.height-PADDLE_H)/2 }
    },
    scores: { [currentRoom.players[0]]: 0, [currentRoom.players[1]]: 0 },
    status: "active",
    winner: null,
    tick: 0
  });
  myPaddleY = (canvas.height - PADDLE_H) / 2;
  lastTotalScore = 0;
});

leaveBtn.addEventListener("click", () => {
  clearInterval(tickHandle);
  window.location.href = "lobby.html";
});

// ── Emoji-Reaktionen ──
let lastReactionTs = Date.now();
function maybeShowReaction(room) {
  if (!room.reaction) return;
  if (room.reaction.ts > lastReactionTs) {
    lastReactionTs = room.reaction.ts;
    if (room.reaction.by !== myUid) showReactionPopup(room.reaction.emoji);
  }
}
function showReactionPopup(emoji) {
  const el = document.getElementById("reaction-popup");
  el.textContent = emoji;
  el.classList.remove("show");
  requestAnimationFrame(() => el.classList.add("show"));
}
document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!roomRef) return;
    showReactionPopup(btn.dataset.emoji);
    updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(() => {});
  });
});
