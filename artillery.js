// MAP — Artillery-Duell. Winkel+Kraft statt Drag-Schleuder, Terrain verformt sich
// nach Treffern (Krater). 3 Treffer = Sieg. Physik läuft lokal beim Schützen (wie bei
// Katapult), Ergebnis (Trefferposition + Terrain-Delta) wird an Firestore synced,
// Gegner sieht den Schuss deterministisch nachgespielt.
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
const canvas = document.getElementById("art-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const angleSlider = document.getElementById("angle-slider");
const powerSlider = document.getElementById("power-slider");
const angleVal = document.getElementById("angle-val");
const powerVal = document.getElementById("power-val");
const fireBtn = document.getElementById("fire-btn");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const W = canvas.width, H = canvas.height, WIN_HITS = 3, TANK_W = 20;
let myUid, roomRef, currentRoom;

renderShopAd("shop-ad");

function buildTerrain() {
  const points = [];
  for (let x = 0; x <= W; x += 4) {
    points.push(Math.floor(H - 60 - Math.sin(x/60) * 18 - Math.sin(x/23) * 8));
  }
  return points;
}

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.terrain) initIfHost();
    maybeShowReaction(currentRoom);
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return currentRoom.status === "active" && currentRoom.turn === myUid; }
function myTankX() { return currentRoom.players[0] === myUid ? 40 : W - 40; }
function oppTankX() { return currentRoom.players[0] === myUid ? W - 40 : 40; }

async function initIfHost() {
  if (!isHost()) return;
  await updateDoc(roomRef, {
    terrain: buildTerrain(), hits: { [currentRoom.players[0]]: 0, [currentRoom.players[1]]: 0 },
    turn: currentRoom.players[0]
  }).catch(() => {});
}

angleSlider.addEventListener("input", () => angleVal.textContent = angleSlider.value);
powerSlider.addEventListener("input", () => powerVal.textContent = powerSlider.value);

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} (${room.hits?.[myUid]??0}/${WIN_HITS}) vs ${room.playerNames[oppUid]||"Gegner"} (${room.hits?.[oppUid]??0}/${WIN_HITS})`;
  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    fireBtn.disabled = true;
  } else {
    rematchBtn.classList.add("hidden");
    fireBtn.disabled = isSpectator || !isMyTurn();
    statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : isMyTurn() ? "🎯 Du bist dran — Winkel & Kraft einstellen!" : "Warte auf den Gegner...";
  }
  drawScene();
}

function drawScene() {
  if (!currentRoom?.terrain) return;
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = "#3a2e1f";
  ctx.beginPath(); ctx.moveTo(0,H);
  currentRoom.terrain.forEach((y,i) => ctx.lineTo(i*4, y));
  ctx.lineTo(W,H); ctx.closePath(); ctx.fill();

  const myX = myTankX(), oppX = oppTankX();
  const myY = currentRoom.terrain[Math.round(myX/4)];
  const oppY = currentRoom.terrain[Math.round(oppX/4)];
  ctx.fillStyle = "#60a5fa"; ctx.fillRect(myX-TANK_W/2, myY-14, TANK_W, 14);
  ctx.fillStyle = "#dc2626"; ctx.fillRect(oppX-TANK_W/2, oppY-14, TANK_W, 14);

  if (currentRoom.lastShot?.trail) {
    ctx.strokeStyle = "#f59e0b"; ctx.beginPath();
    currentRoom.lastShot.trail.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    ctx.stroke();
  }
}

function computeShot(fromX, fromY, angleDeg, power, targetX) {
  const dirToTarget = targetX > fromX ? 1 : -1;
  const rad = angleDeg * Math.PI / 180;
  let vx = Math.cos(rad) * power * 0.09 * dirToTarget;
  let vy = -Math.sin(rad) * power * 0.09;
  let x = fromX, y = fromY, g = 0.28;
  const trail = [];
  for (let step = 0; step < 400; step++) {
    x += vx; y += vy; vy += g;
    trail.push({ x, y });
    const col = Math.round(x/4);
    if (col < 0 || col >= currentRoom.terrain.length || y >= currentRoom.terrain[col]) {
      return { hitX: x, hitY: y, trail };
    }
  }
  return { hitX: x, hitY: y, trail };
}

async function fire() {
  if (isSpectator || !isMyTurn()) return;
  const angle = parseInt(angleSlider.value), power = parseInt(powerSlider.value);
  const myX = myTankX(), myY = currentRoom.terrain[Math.round(myX/4)];
  const oppX = oppTankX();
  const shot = computeShot(myX, myY-8, angle, power, oppX);
  sfx.move ? sfx.move() : null;

  // Terrain-Krater um Einschlag — MAP FIX: darf nicht in die Tank-Spalten selbst
  // reinragen, sonst könnte ein Tank theoretisch "unter" dem neuen Terrain landen.
  const terrain = [...currentRoom.terrain];
  const craterCol = Math.round(shot.hitX/4);
  const craterR = 10;
  const myTankCol = Math.round(myX/4), oppTankCol = Math.round(oppX/4);
  for (let i = -craterR; i <= craterR; i++) {
    const idx = craterCol + i;
    if (idx < 0 || idx >= terrain.length) continue;
    if (Math.abs(idx - myTankCol) < 3 || Math.abs(idx - oppTankCol) < 3) continue; // Tank-Zonen ausklammern
    const depth = Math.max(0, craterR - Math.abs(i)) * 2.2;
    terrain[idx] = Math.min(H-10, terrain[idx] + depth);
  }

  const oppUid = opponentUid();
  const oppTankTerrainY = currentRoom.terrain[Math.round(oppX/4)];
  const directHit = Math.abs(shot.hitX - oppX) < TANK_W && Math.abs(shot.hitY - oppTankTerrainY) < 20;

  const newHits = { ...(currentRoom.hits || {}) };
  if (directHit) { newHits[myUid] = (newHits[myUid]||0) + 1; sfx.hit ? sfx.hit() : null; }
  const finished = (newHits[myUid]||0) >= WIN_HITS;

  try {
    await updateDoc(roomRef, {
      terrain, hits: newHits, turn: oppUid,
      lastShot: { trail: shot.trail, hit: directHit },
      status: finished ? "finished" : "active",
      winner: finished ? myUid : null
    });
    if (finished) {
      sfx.win ? sfx.win() : null;
      addDoc(collection(db, "matchResults"), { game: "artillery", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: myUid, at: serverTimestamp() }).catch(()=>{});
      awardGameReward(myUid, 100, "artillery_win").catch(()=>{});
    }
  } catch(e) {}
}

fireBtn.addEventListener("click", fire);

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    status: "active", winner: null, terrain: buildTerrain(),
    hits: { [currentRoom.players[0]]: 0, [currentRoom.players[1]]: 0 }, turn: currentRoom.players[0], lastShot: null
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "artillery", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
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
