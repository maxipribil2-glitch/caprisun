// MAP — Bomber-Arena (Bomberman-Style). 9x9-Grid, feste Wände + zerstörbare Blöcke,
// letzter Überlebender gewinnt. Host generiert das Grid, danach läuft alles über
// Firestore-Updates wie die anderen 1v1-Games. Bewusst simpel: EINE Bombe pro Spieler
// gleichzeitig, feste Explosions-Reichweite (kein Item-System, kein Scope-Creep).
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const isSpectator = params.get("spectate") === "1";
const gridEl = document.getElementById("bomber-grid");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const bombBtn = document.getElementById("bomb-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const SIZE = 9;
const BOMB_TIMER_MS = 2200, EXPLOSION_RANGE = 2;

let myUid, roomRef, currentRoom;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.grid) initGridIfHost();
    maybeShowReaction(currentRoom);
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function myPos() { return currentRoom.pos?.[myUid]; }

function buildGrid() {
  const grid = Array.from({length: SIZE}, () => Array(SIZE).fill("empty"));
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
    if (r%2===1 && c%2===1) grid[r][c] = "wall";
  }
  // MAP FIX: nicht nur die Spawn-Felder selbst, sondern auch EINEN Schritt weiter
  // freihalten (min. 2 freie Nachbarn), damit kein Spieler komplett eingemauert spawnt.
  const clearZones = [[0,0],[0,1],[0,2],[1,0],[1,1],[2,0],[SIZE-1,SIZE-1],[SIZE-1,SIZE-2],[SIZE-1,SIZE-3],[SIZE-2,SIZE-1],[SIZE-2,SIZE-2],[SIZE-3,SIZE-1]];
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
    if (grid[r][c] === "wall") continue;
    const isClear = clearZones.some(([cr,cc]) => cr===r && cc===c);
    if (!isClear && Math.random() < 0.55) grid[r][c] = "block";
  }
  return grid;
}

async function initGridIfHost() {
  if (!isHost()) return;
  await updateDoc(roomRef, {
    grid: buildGrid(),
    pos: { [currentRoom.players[0]]: {r:0,c:0}, [currentRoom.players[1]]: {r:SIZE-1,c:SIZE-1} },
    bombs: [], alive: { [currentRoom.players[0]]: true, [currentRoom.players[1]]: true }
  }).catch(() => {});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}`;
  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Du bist explodiert. GG.";
  } else {
    rematchBtn.classList.add("hidden");
    statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : "Bewegen + Bombe legen!";
  }
  renderGrid();
}

function renderGrid() {
  if (!currentRoom.grid) { gridEl.innerHTML = "<div class='hint'>Arena wird gebaut...</div>"; return; }
  gridEl.innerHTML = "";
  const bombCells = new Set((currentRoom.bombs||[]).map(b => b.r+","+b.c));
  const explosionCells = new Set();
  (currentRoom.bombs||[]).forEach(b => { if (b.exploding) (b.cells||[]).forEach(([r,c]) => explosionCells.add(r+","+c)); });

  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
    const cell = document.createElement("div");
    const type = currentRoom.grid[r][c];
    let cls = "bomber-cell";
    if (type === "wall") cls += " wall";
    else if (type === "block") cls += " block";
    if (explosionCells.has(r+","+c)) cls += " explosion";
    cell.className = cls;
    if (bombCells.has(r+","+c) && !explosionCells.has(r+","+c)) cell.textContent = "💣";
    Object.entries(currentRoom.pos || {}).forEach(([uid, p]) => {
      if (p.r === r && p.c === c && currentRoom.alive?.[uid]) {
        cell.textContent = uid === myUid ? "🙂" : "😠";
      }
    });
    gridEl.appendChild(cell);
  }
}

async function move(dir) {
  if (isSpectator || currentRoom?.status !== "active" || !currentRoom.alive?.[myUid]) return;
  const pos = myPos(); if (!pos) return;
  let { r, c } = pos;
  if (dir === "up") r--; else if (dir === "down") r++; else if (dir === "left") c--; else if (dir === "right") c++;
  if (r<0||r>=SIZE||c<0||c>=SIZE) return;
  if (currentRoom.grid[r][c] !== "empty") return;
  const otherUid = opponentUid();
  const otherPos = currentRoom.pos?.[otherUid];
  if (otherPos && otherPos.r === r && otherPos.c === c) return; // kein Reinlaufen in Gegner
  try { await updateDoc(roomRef, { [`pos.${myUid}`]: { r, c } }); } catch(e) {}
}

async function placeBomb() {
  if (isSpectator || currentRoom?.status !== "active" || !currentRoom.alive?.[myUid]) return;
  const pos = myPos(); if (!pos) return;
  if ((currentRoom.bombs||[]).some(b => b.owner === myUid)) return; // nur 1 Bombe gleichzeitig
  const bomb = { r: pos.r, c: pos.c, owner: myUid, plantedAt: Date.now(), exploding: false };
  try {
    await updateDoc(roomRef, { bombs: [...(currentRoom.bombs||[]), bomb] });
    sfx.move ? sfx.move() : null;
    setTimeout(() => detonate(bomb), BOMB_TIMER_MS);
  } catch(e) {}
}

async function detonate(bomb) {
  // MAP: nur der ursprüngliche "Besitzer" der Bombe detoniert sie, damit's nicht doppelt passiert
  if (!currentRoom || bomb.owner !== myUid) return;
  const grid = currentRoom.grid.map(row => [...row]);
  const affected = [[bomb.r, bomb.c]];
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
  dirs.forEach(([dr,dc]) => {
    for (let i=1; i<=EXPLOSION_RANGE; i++) {
      const r = bomb.r+dr*i, c = bomb.c+dc*i;
      if (r<0||r>=SIZE||c<0||c>=SIZE) break;
      if (grid[r][c] === "wall") break;
      affected.push([r,c]);
      if (grid[r][c] === "block") { grid[r][c] = "empty"; break; }
    }
  });

  const newAlive = { ...(currentRoom.alive || {}) };
  Object.entries(currentRoom.pos || {}).forEach(([uid, p]) => {
    if (affected.some(([r,c]) => r===p.r && c===p.c)) newAlive[uid] = false;
  });

  const remaining = Object.entries(newAlive).filter(([,alive]) => alive);
  const finished = remaining.length <= 1;
  const winnerUid = finished ? (remaining[0]?.[0] || null) : null;

  sfx.hit ? sfx.hit() : null;
  const newBombs = (currentRoom.bombs||[]).filter(b => !(b.r===bomb.r && b.c===bomb.c && b.owner===bomb.owner));

  try {
    await updateDoc(roomRef, {
      grid, alive: newAlive, bombs: newBombs,
      status: finished ? "finished" : "active",
      winner: finished ? winnerUid : null
    });
    if (finished && winnerUid) {
      addDoc(collection(db, "matchResults"), { game: "bomberman", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "bomberman_win").catch(()=>{});
    }
  } catch(e) {}
}

document.querySelectorAll(".dpad-btn").forEach(btn => btn.addEventListener("click", () => move(btn.dataset.dir)));
window.addEventListener("keydown", (e) => {
  const map = { ArrowLeft:"left", ArrowRight:"right", ArrowUp:"up", ArrowDown:"down", a:"left", d:"right", w:"up", s:"down" };
  if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
  if (e.code === "Space") { e.preventDefault(); placeBomb(); }
});
bombBtn.addEventListener("click", placeBomb);

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    status: "active", winner: null, grid: buildGrid(), bombs: [],
    pos: { [currentRoom.players[0]]: {r:0,c:0}, [currentRoom.players[1]]: {r:SIZE-1,c:SIZE-1} },
    alive: { [currentRoom.players[0]]: true, [currentRoom.players[1]]: true }
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "bomberman", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

let lastReactionTs = Date.now();
function maybeShowReaction(room) {
  if (!room.reaction) return;
  if (room.reaction.ts > lastReactionTs) { lastReactionTs = room.reaction.ts; if (room.reaction.by !== myUid) showReactionPopup(room.reaction.emoji); }
}
function showReactionPopup(emoji) {
  const el = document.getElementById("reaction-popup");
  el.textContent = emoji; el.classList.remove("show"); requestAnimationFrame(() => el.classList.add("show"));
}
document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; showReactionPopup(btn.dataset.emoji); updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
