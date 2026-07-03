// MAP — Katapult Tower (1v1 Duell). Turn-based wie Tic-Tac-Toe: nur ein Schuss-Ergebnis
// pro Zug wird nach Firestore geschrieben (kein High-Frequency-Sync nötig, weil immer nur
// EIN Spieler gleichzeitig schießt). Die Flugbahn-Physik läuft komplett lokal im Browser des
// Schützen; sobald der Schuss fertig ist (Treffer/Verfehlt/Hindernis), wird nur das ERGEBNIS
// synced. Der wartende Spieler bekommt die Schuss-Parameter mit (lastShot) und spielt die
// gleiche Flugbahn lokal nach, damit beide das Gleiche sehen.
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
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
const isSpectator = params.get("spectate") === "1";

const canvas = document.getElementById("kat-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const turnLineEl = document.getElementById("turn-line");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) { window.location.href = "lobby.html"; }

const GRAVITY = 0.5;
const FLOOR_Y_OFFSET = 16;
const BALL_R = 11;
const MAX_SHOT_FRAMES = 240; // ~4s failsafe at 60fps
const FLOOR_Y = canvas.height - FLOOR_Y_OFFSET;
const FIGURE_W = 26, FIGURE_H = 36;

const SLING = { left: { x: 42, y: FLOOR_Y - BALL_R }, right: { x: canvas.width - 42, y: FLOOR_Y - BALL_R } };
const FIGURE = {
  left:  { x: 8,                          y: FLOOR_Y - FIGURE_H, w: FIGURE_W, h: FIGURE_H },
  right: { x: canvas.width - 8 - FIGURE_W, y: FLOOR_Y - FIGURE_H, w: FIGURE_W, h: FIGURE_H }
};

function buildObstacles() {
  const xs = [122, 171, 220];
  return xs.map(x => {
    const h = 55 + Math.floor(Math.random() * 70);
    return { x, y: FLOOR_Y - h, w: 18, h, destroyed: false };
  });
}

let myUid = null;
let roomRef = null;
let currentRoom = null;
let lastSeenShotSeq = null;
let ball = null;
let aiming = false;
let aimPos = null;
let shotActive = false;
let shotFrames = 0;
let rafHandle = null;
let workingObstacles = []; // local mutable copy used during an in-flight shot

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) {
    initMatch({
      roomRef, myUid, myName: user.displayName || user.email || "Spieler",
      onRematch: async (room) => {
        // game-specific rematch logic handled by each game file
      }
    });
  }
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Dieser Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    workingObstacles = currentRoom.obstacles.map(o => ({ ...o }));
    if (lastSeenShotSeq === null) {
      lastSeenShotSeq = currentRoom.shotSeq || 0; // don't replay history on first load
    } else if (!shotActive && currentRoom.lastShot && currentRoom.shotSeq > lastSeenShotSeq && currentRoom.lastShot.by !== myUid) {
      lastSeenShotSeq = currentRoom.shotSeq;
      replayShot(currentRoom.lastShot);
    } else {
      lastSeenShotSeq = currentRoom.shotSeq || 0;
    }
    renderInfo();
    if (!shotActive) draw();
  });
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(loop);
});

function mySide() {
  if (!currentRoom) return "left";
  return currentRoom.players[0] === myUid ? "left" : "right";
}
function opponentSide() { return mySide() === "left" ? "right" : "left"; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return currentRoom && currentRoom.status === "active" && currentRoom.turn === myUid; }

function renderInfo() {
  const room = currentRoom;
  maybeShowReaction(room);
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}`;
  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    turnLineEl.textContent = "Runde vorbei";
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : `${room.playerNames[oppUid] || "Gegner"} hat gewonnen.`;
  } else {
    rematchBtn.classList.add("hidden");
    turnLineEl.textContent = isMyTurn() ? "🎯 Du bist dran!" : `${room.playerNames[oppUid] || "Gegner"} zielt grad...`;
    statusEl.textContent = isMyTurn() ? "Zieh den Ball nach hinten und lass los." : "Warte auf den Schuss...";
  }
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches && e.touches.length ? e.touches[0].clientX : e.clientX;
  const cy = e.touches && e.touches.length ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * (canvas.width / rect.width), y: (cy - rect.top) * (canvas.height / rect.height) };
}

canvas.addEventListener("pointerdown", e => {
  if (isSpectator) return;
  if (!isMyTurn() || shotActive) return;
  aiming = true;
  aimPos = getPos(e);
});
window.addEventListener("pointermove", e => { if (aiming) aimPos = getPos(e); });
window.addEventListener("pointerup", () => {
  if (!aiming) return;
  aiming = false;
  if (aimPos) tryLaunch(aimPos);
});

function tryLaunch(pos) {
  const s = SLING[mySide()];
  const dx = s.x - pos.x;
  const dy = s.y - pos.y;
  const dist = Math.min(Math.hypot(dx, dy), 130);
  if (dist < 12) return; // too weak — doesn't cost the turn
  sfx.fire();
  const angle = Math.atan2(dy, dx);
  const speed = 6 + (dist / 130) * 15;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  fireShot(vx, vy, true);
}

// Runs the deterministic flight simulation. If `isLocalShooter` is true, this is the
// player who actually fired — once it resolves, the result gets written to Firestore.
// If false, it's a cosmetic replay on the other client (outcome is already decided).
function fireShot(vx, vy, isLocalShooter, obstaclesOverride) {
  const side = isLocalShooter ? mySide() : opponentSide();
  const s = SLING[side];
  ball = { x: s.x, y: s.y, r: BALL_R, vx, vy };
  shotActive = true;
  shotFrames = 0;
  workingObstacles = (obstaclesOverride || currentRoom.obstacles).map(o => ({ ...o }));
  const targetFigure = FIGURE[isLocalShooter ? opponentSide() : mySide()];
  runPhysics(targetFigure, isLocalShooter, vx, vy);
}

function circleRectOverlap(c, r) {
  const closestX = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const closestY = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - closestX, dy = c.y - closestY;
  return (dx * dx + dy * dy) < (c.r * c.r);
}

function runPhysics(targetFigure, isLocalShooter, initialVx, initialVy) {
  let result = "miss";
  let hitObstacleIndex = -1;

  function step() {
    shotFrames++;
    ball.vy += GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;

    let stop = false;

    for (let i = 0; i < workingObstacles.length; i++) {
      const o = workingObstacles[i];
      if (o.destroyed) continue;
      if (circleRectOverlap(ball, o)) {
        o.destroyed = true;
        hitObstacleIndex = i;
        result = "obstacle";
        stop = true;
        break;
      }
    }

    if (!stop && circleRectOverlap(ball, targetFigure)) {
      result = "hit";
      stop = true;
    }

    const offscreen = ball.x < -60 || ball.x > canvas.width + 60 || ball.y > canvas.height + 80;
    const timedOut = shotFrames > MAX_SHOT_FRAMES;
    if (offscreen || timedOut) stop = true;

    draw();

    if (stop) {
      shotActive = false;
      if (result === "hit") { isLocalShooter ? sfx.win() : sfx.lose(); }
      else if (result === "obstacle") sfx.hit();
      if (isLocalShooter) finalizeShot(result, hitObstacleIndex, initialVx, initialVy);
      else renderInfo();
      return;
    }
    rafHandle = requestAnimationFrame(step);
  }
  step();
}

function replayShot(lastShot) {
  fireShot(lastShot.vx, lastShot.vy, false, lastShot.obstaclesBefore);
}

async function finalizeShot(result, hitObstacleIndex, vx, vy) {
  const room = currentRoom;
  const oppUid = opponentUid();
  const obstaclesBefore = room.obstacles.map(o => ({ ...o }));
  const newObstacles = room.obstacles.map((o, i) => i === hitObstacleIndex ? { ...o, destroyed: true } : o);
  const won = result === "hit";
  try {
    await updateDoc(roomRef, {
      obstacles: newObstacles,
      turn: won ? room.turn : oppUid,
      status: won ? "finished" : "active",
      winner: won ? myUid : null,
      shotSeq: (room.shotSeq || 0) + 1,
      lastShot: { by: myUid, vx, vy, result, obstaclesBefore }
    });
    if (won) {
      addDoc(collection(db, "matchResults"), {
        game: "katapult", players: room.players, playerNames: room.playerNames,
        winner: myUid, at: serverTimestamp()
      }).catch(() => {});
    }
  } catch (e) {}
}

function loop() {
  if (!shotActive) draw();
  rafHandle = requestAnimationFrame(loop);
}

function draw() {
  ctx.fillStyle = "#13151c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#262a35";
  ctx.fillRect(0, FLOOR_Y, canvas.width, FLOOR_Y_OFFSET);

  // obstacles
  const obs = shotActive ? workingObstacles : (currentRoom ? currentRoom.obstacles : []);
  obs.forEach(o => {
    if (o.destroyed) return;
    ctx.fillStyle = "#8b5cf6";
    ctx.fillRect(o.x, o.y, o.w, o.h);
  });

  // figures (both players)
  if (currentRoom) {
    ["left", "right"].forEach(side => {
      const f = FIGURE[side];
      const uid = side === mySide() ? myUid : opponentUid();
      const finished = currentRoom.status === "finished";
      const isLoser = finished && currentRoom.winner && currentRoom.winner !== uid;
      ctx.fillStyle = side === mySide() ? "#6366f1" : "#f59e0b";
      ctx.globalAlpha = isLoser ? 0.3 : 1;
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.globalAlpha = 1;
    });
  }

  // slings
  ["left", "right"].forEach(side => {
    const s = SLING[side];
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x, FLOOR_Y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  });

  // aim line (only my own sling, only my turn)
  if (aiming && aimPos && isMyTurn()) {
    const s = SLING[mySide()];
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(aimPos.x, aimPos.y);
    ctx.stroke();
  }

  // ball
  if (shotActive && ball) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  } else if (aiming && aimPos && isMyTurn()) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(aimPos.x, aimPos.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    obstacles: buildObstacles(),
    turn: currentRoom.players[Math.random() < 0.5 ? 0 : 1],
    status: "active",
    winner: null,
    shotSeq: (currentRoom.shotSeq || 0) + 1,
    lastShot: null
  });
});

leaveBtn.addEventListener("click", () => {
  cancelAnimationFrame(rafHandle);
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
