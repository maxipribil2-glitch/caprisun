// MAP — Snake.io (1v1), synced via Firestore. To avoid write-conflicts between two
// clients both trying to advance the same game state, only ONE client ("the authority" —
// whoever's uid is room.players[0], i.e. whoever sent the original invite) runs the tick
// loop and writes the full game state. The other client only writes its OWN direction
// changes (a small nested-field update), never the whole document. Both clients render
// from the live onSnapshot data, so what you see is always in sync regardless of who's
// the authority.
import { app } from "./firebase-config.js";
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

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const scoreLineEl = document.getElementById("score-line");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) { window.location.href = "lobby.html"; }

const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
function isOpposite(a, b) {
  return (a === "up" && b === "down") || (a === "down" && b === "up") ||
         (a === "left" && b === "right") || (a === "right" && b === "left");
}
function randomFoodCell(grid, occupied) {
  const occSet = new Set(occupied.map(p => p.x + "," + p.y));
  let x, y, tries = 0;
  do {
    x = Math.floor(Math.random() * grid.w);
    y = Math.floor(Math.random() * grid.h);
    tries++;
  } while (occSet.has(x + "," + y) && tries < 200);
  return { x, y };
}
function initialBodies() {
  return [
    [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }],
    [{ x: 15, y: 10 }, { x: 16, y: 10 }, { x: 17, y: 10 }]
  ];
}

let myUid = null;
let roomRef = null;
let currentRoom = null;
let tickHandle = null;
let lastMyScore = 0;
let lastStatus = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      statusEl.textContent = "Dieser Raum existiert nicht (mehr).";
      return;
    }
    currentRoom = snap.data();
    render();
  });
  clearInterval(tickHandle);
  tickHandle = setInterval(tick, 220);
});

function isAuthority() {
  return currentRoom && currentRoom.players && currentRoom.players[0] === myUid;
}

function tick() {
  if (!isAuthority() || !currentRoom || currentRoom.status !== "active") return;
  const room = currentRoom;
  const grid = room.grid;
  const ids = room.players;
  const snakes = {};
  ids.forEach(uid => { snakes[uid] = JSON.parse(JSON.stringify(room.snakes[uid])); });
  let food = room.food;

  const newHeads = {};
  ids.forEach(uid => {
    const s = snakes[uid];
    if (!s.alive) return;
    const dir = isOpposite(s.dir, s.nextDir) ? s.dir : s.nextDir;
    s.dir = dir;
    const head = s.body[0];
    const d = DIRS[dir];
    newHeads[uid] = { x: head.x + d.x, y: head.y + d.y };
  });

  const eating = {};
  ids.forEach(uid => {
    const s = snakes[uid];
    if (!s.alive) return;
    const nh = newHeads[uid];
    eating[uid] = !!(food && nh.x === food.x && nh.y === food.y);
  });

  // wall + self collision
  ids.forEach(uid => {
    const s = snakes[uid];
    if (!s.alive) return;
    const nh = newHeads[uid];
    if (nh.x < 0 || nh.x >= grid.w || nh.y < 0 || nh.y >= grid.h) { s.alive = false; return; }
    const selfBody = eating[uid] ? s.body : s.body.slice(0, -1);
    if (selfBody.some(seg => seg.x === nh.x && seg.y === nh.y)) { s.alive = false; }
  });

  // collision with other snake (body or head-on)
  ids.forEach(uid => {
    const s = snakes[uid];
    if (!s.alive) return;
    const nh = newHeads[uid];
    ids.forEach(otherUid => {
      if (otherUid === uid) return;
      const other = snakes[otherUid];
      if (other.body.some(seg => seg.x === nh.x && seg.y === nh.y)) { s.alive = false; }
      if (newHeads[otherUid] && newHeads[otherUid].x === nh.x && newHeads[otherUid].y === nh.y) { s.alive = false; }
    });
  });

  // move alive snakes
  ids.forEach(uid => {
    const s = snakes[uid];
    if (!s.alive) return;
    const nh = newHeads[uid];
    s.body.unshift(nh);
    if (eating[uid]) { s.score = (s.score || 0) + 1; }
    else { s.body.pop(); }
  });

  if (Object.values(eating).some(Boolean)) {
    const occupied = ids.flatMap(uid => snakes[uid].body);
    food = randomFoodCell(grid, occupied);
  }

  const aliveIds = ids.filter(uid => snakes[uid].alive);
  let status = room.status, winner = room.winner;
  const wasActive = room.status === "active";
  if (aliveIds.length <= 1) {
    status = "finished";
    winner = aliveIds.length === 1 ? aliveIds[0] : "draw";
  }

  updateDoc(roomRef, { snakes, food, status, winner, tick: (room.tick || 0) + 1 }).catch(() => {});
  if (wasActive && status === "finished") {
    addDoc(collection(db, "matchResults"), {
      game: "snakeio", players: room.players, playerNames: room.playerNames,
      winner, at: serverTimestamp()
    }).catch(() => {});
  }
}

function render() {
  const room = currentRoom;
  if (!room) return;
  maybeShowReaction(room);
  const grid = room.grid;
  const cell = canvas.width / grid.w;

  ctx.fillStyle = "#13151c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (room.food) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc((room.food.x + 0.5) * cell, (room.food.y + 0.5) * cell, cell * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  const colors = { [room.players[0]]: "#6366f1", [room.players[1]]: "#8b5cf6" };
  room.players.forEach(uid => {
    const s = room.snakes[uid];
    if (!s) return;
    s.body.forEach((seg, i) => {
      ctx.globalAlpha = s.alive ? (i === 0 ? 1 : 0.78) : 0.25;
      ctx.fillStyle = colors[uid] || "#888";
      ctx.fillRect(seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2);
    });
  });
  ctx.globalAlpha = 1;

  const otherUid = room.players.find(p => p !== myUid);
  const me = room.snakes[myUid];
  const other = room.snakes[otherUid];
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[otherUid] || "Gegner"}`;
  if (me && other) {
    scoreLineEl.innerHTML = `<strong>${room.playerNames[myUid]}</strong>: ${me.score} &nbsp;—&nbsp; <strong>${room.playerNames[otherUid]}</strong>: ${other.score}`;
    if (me.score > lastMyScore) sfx.eat();
    lastMyScore = me.score;
  }

  if (room.status === "finished") {
    if (room.winner === "draw") statusEl.textContent = "Unentschieden! Beide gleichzeitig crashed.";
    else if (room.winner === myUid) statusEl.textContent = "DU HAST GEWONNEN 🔥";
    else statusEl.textContent = `${room.playerNames[otherUid] || "Gegner"} hat gewonnen.`;
    if (lastStatus !== "finished") {
      if (room.winner === "draw") sfx.draw();
      else if (room.winner === myUid) sfx.win();
      else sfx.lose();
    }
    rematchBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = me && !me.alive ? "Du bist raus — schau zu wie's ausgeht." : "Los geht's...";
    if (me && !me.alive && lastStatus !== "active-dead") sfx.hit();
    rematchBtn.classList.add("hidden");
  }
  lastStatus = room.status === "active" && me && !me.alive ? "active-dead" : room.status;
}

function setDir(dir) {
  const room = currentRoom;
  if (!room || room.status !== "active") return;
  const me = room.snakes[myUid];
  if (!me || !me.alive) return;
  if (isOpposite(me.dir, dir)) return;
  updateDoc(roomRef, { [`snakes.${myUid}.nextDir`]: dir }).catch(() => {});
}

window.addEventListener("keydown", e => {
  const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
                w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };
  if (map[e.key]) { e.preventDefault(); setDir(map[e.key]); }
});
document.querySelectorAll(".dpad-btn").forEach(btn => {
  btn.addEventListener("click", () => setDir(btn.dataset.dir));
});

rematchBtn.addEventListener("click", async () => {
  const room = currentRoom;
  const ids = room.players;
  const [bodyA, bodyB] = initialBodies();
  const snakes = {
    [ids[0]]: { body: bodyA, dir: "right", nextDir: "right", alive: true, score: 0 },
    [ids[1]]: { body: bodyB, dir: "left", nextDir: "left", alive: true, score: 0 }
  };
  await updateDoc(roomRef, {
    snakes,
    food: randomFoodCell(room.grid, [...bodyA, ...bodyB]),
    status: "active",
    winner: null,
    tick: 0
  });
  lastMyScore = 0;
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
