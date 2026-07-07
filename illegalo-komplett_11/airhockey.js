// MAP — Air Hockey. 2D-Bewegung (statt nur Y-Achse wie Pong), Physik mit Reibung
// + Bande-Reflexion. Host simuliert, syncet Ball+Puck-Positionen alle ~50ms
// (gleiches Authority-Pattern wie Snake.io/Pong: einer simuliert, beide steuern
// nur ihren eigenen Schläger).
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
const canvas = document.getElementById("hockey-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const W = canvas.width, H = canvas.height, PUCK_R = 12, MALLET_R = 24, GOAL_W = 100, WIN_SCORE = 7;

let myUid, roomRef, currentRoom, rafHandle;
let localMalletX = W/2, localMalletY = H - 60;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    maybeShowReaction(currentRoom);
    render();
    if (isHost() && currentRoom.status === "active") ensureSimLoop();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function amBottomPlayer() { return currentRoom.players[0] === myUid; } // Host ist immer unten, aus eigener Sicht

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}  |  ${room.scoreTop||0} : ${room.scoreBottom||0}`;
  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
  } else {
    rematchBtn.classList.add("hidden");
    statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : "Zieh deinen Schläger!";
  }
  draw();
}

function draw() {
  const room = currentRoom || {};
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = "#3a3f58"; ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.fillStyle = "#1a1c26";
  ctx.fillRect(W/2-GOAL_W/2, 0, GOAL_W, 6);
  ctx.fillRect(W/2-GOAL_W/2, H-6, GOAL_W, 6);

  const puck = room.puck || { x: W/2, y: H/2 };
  ctx.fillStyle = "#f59e0b"; ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI*2); ctx.fill();

  const malletBottom = room.malletBottom || { x: W/2, y: H-60 };
  const malletTop = room.malletTop || { x: W/2, y: 60 };
  ctx.fillStyle = "#60a5fa"; ctx.beginPath(); ctx.arc(malletBottom.x, malletBottom.y, MALLET_R, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(malletTop.x, malletTop.y, MALLET_R, 0, Math.PI*2); ctx.fill();
}

// ── Eigenen Schläger steuern (untere Hälfte für Spieler 0, obere für Spieler 1 gespiegelt) ──
function handlePointer(clientX, clientY) {
  if (isSpectator || currentRoom?.status !== "active") return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(MALLET_R, Math.min(W-MALLET_R, (clientX - rect.left) * (W/rect.width)));
  const yRaw = Math.max(MALLET_R, Math.min(H-MALLET_R, (clientY - rect.top) * (H/rect.height)));
  const y = amBottomPlayer() ? Math.max(H/2+MALLET_R, yRaw) : Math.min(H/2-MALLET_R, yRaw);
  const field = amBottomPlayer() ? "malletBottom" : "malletTop";
  updateDoc(roomRef, { [field]: { x, y } }).catch(() => {});
}
canvas.addEventListener("pointerdown", e => handlePointer(e.clientX, e.clientY));
canvas.addEventListener("pointermove", e => { if (e.buttons) handlePointer(e.clientX, e.clientY); });

// ── Host-Simulation (Puck-Physik) ──
let simRunning = false;
function ensureSimLoop() {
  if (simRunning) return;
  simRunning = true;
  if (!currentRoom.puck) {
    updateDoc(roomRef, { puck: { x: W/2, y: H/2, vx: (Math.random()<0.5?-1:1)*3, vy: (Math.random()<0.5?-1:1)*3 }, scoreTop: 0, scoreBottom: 0 }).catch(()=>{});
  }
  simLoop();
}
function simLoop() {
  if (!isHost() || currentRoom?.status !== "active") { simRunning = false; return; }
  stepPhysics();
  setTimeout(simLoop, 33);
}

async function stepPhysics() {
  const room = currentRoom;
  const puck = { ...(room.puck || { x: W/2, y: H/2, vx: 3, vy: 3 }) };
  puck.x += puck.vx; puck.y += puck.vy;
  puck.vx *= 0.997; puck.vy *= 0.997; // Reibung

  if (puck.x - PUCK_R < 0) { puck.x = PUCK_R; puck.vx *= -1; }
  if (puck.x + PUCK_R > W) { puck.x = W - PUCK_R; puck.vx *= -1; }

  let scoreTop = room.scoreTop || 0, scoreBottom = room.scoreBottom || 0, scored = false;
  if (puck.y - PUCK_R < 0) {
    if (puck.x > W/2-GOAL_W/2 && puck.x < W/2+GOAL_W/2) { scoreBottom++; scored = true; }
    else { puck.y = PUCK_R; puck.vy *= -1; }
  }
  if (puck.y + PUCK_R > H) {
    if (puck.x > W/2-GOAL_W/2 && puck.x < W/2+GOAL_W/2) { scoreTop++; scored = true; }
    else { puck.y = H - PUCK_R; puck.vy *= -1; }
  }

  // MAP FIX: Mallet-Positionen werden jetzt auch server-/host-seitig geclampt (nicht
  // nur im Client-Handler), damit Lag/schnelles Ziehen die Mittellinie nicht kurz
  // überschreiten kann bevor der clientseitige Clamp greift.
  const malletBottom = room.malletBottom ? { ...room.malletBottom, y: Math.max(H/2+MALLET_R, room.malletBottom.y) } : {x:W/2,y:H-60};
  const malletTop = room.malletTop ? { ...room.malletTop, y: Math.min(H/2-MALLET_R, room.malletTop.y) } : {x:W/2,y:60};
  [malletBottom, malletTop].forEach(mallet => {
    const dx = puck.x - mallet.x, dy = puck.y - mallet.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if (dist < PUCK_R + MALLET_R && dist > 0) {
      const overlap = PUCK_R + MALLET_R - dist;
      puck.x += (dx/dist) * overlap;
      puck.y += (dy/dist) * overlap;
      puck.vx = (dx/dist) * 7;
      puck.vy = (dy/dist) * 7;
    }
  });

  if (scored) {
    const bottomUid = currentRoom.players[0], topUid = currentRoom.players[1];
    const finished = scoreTop >= WIN_SCORE || scoreBottom >= WIN_SCORE;
    const winnerUid = finished ? (scoreTop >= WIN_SCORE ? topUid : bottomUid) : null;
    puck.x = W/2; puck.y = H/2; puck.vx = (Math.random()<0.5?-1:1)*3; puck.vy = (Math.random()<0.5?-1:1)*3;
    await updateDoc(roomRef, {
      puck, scoreTop, scoreBottom,
      status: finished ? "finished" : "active",
      winner: winnerUid
    }).catch(()=>{});
    if (finished) {
      addDoc(collection(db, "matchResults"), {
        game: "airhockey", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: winnerUid, at: serverTimestamp()
      }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "airhockey_win").catch(()=>{});
    }
  } else {
    await updateDoc(roomRef, { puck }).catch(()=>{});
  }
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    status: "active", winner: null, scoreTop: 0, scoreBottom: 0,
    puck: { x: W/2, y: H/2, vx: (Math.random()<0.5?-1:1)*3, vy: (Math.random()<0.5?-1:1)*3 }
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "airhockey", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
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
