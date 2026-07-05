// MAP — Pool/Billard-Duell. Ziehen vom weißen Ball weg = Zielen+Kraft, loslassen =
// Stoßen. Host simuliert Physik (Reibung, Bande-Reflexion, Ball-Kollisionen), synct
// alle Ball-Positionen an Firestore. 3 eigene Bälle versenkt = Sieg (vereinfacht,
// kein 8-Ball-Regelwerk mit Foul-Erkennung).
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
const canvas = document.getElementById("pool-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const W = canvas.width, H = canvas.height, R = 7, POCKET_R = 12;
const POCKETS = [{x:0,y:0},{x:W/2,y:0},{x:W,y:0},{x:0,y:H},{x:W/2,y:H},{x:W,y:H}];

let myUid, roomRef, currentRoom;
let aiming = false, aimStart = null, aimCurrent = null;

renderShopAd("shop-ad");

function initialBalls() {
  const balls = [{ id: "cue", x: W*0.25, y: H/2, vx:0, vy:0, color: "#fff", pocketed:false }];
  let id = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i <= row; i++) {
    balls.push({ id: "a"+(id++), x: W*0.7 + row*16, y: H/2 - row*8 + i*16, vx:0, vy:0, color: "#dc2626", pocketed:false });
  }
  id = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i <= row; i++) {
    balls.push({ id: "b"+(id++), x: W*0.85 + row*16, y: H/2 - row*8 + i*16, vx:0, vy:0, color: "#3b82f6", pocketed:false });
  }
  return balls;
}

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.balls) initIfHost();
    maybeShowReaction(currentRoom);
    render();
    if (isHost() && currentRoom.status === "active" && currentRoom.simulating) ensureSimLoop();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myUid && !currentRoom.simulating; }

async function initIfHost() {
  if (!isHost()) return;
  const first = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const second = currentRoom.players.find(p => p !== first);
  await updateDoc(roomRef, {
    balls: initialBalls(), groups: { [first]: "a", [second]: "b" },
    turn: currentRoom.players[0], simulating: false, pocketedCount: { [first]:0, [second]:0 }
  }).catch(()=>{});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} (${room.pocketedCount?.[myUid]??0}/3) vs ${room.playerNames[oppUid]||"Gegner"} (${room.pocketedCount?.[oppUid]??0}/3)`;
  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
  } else {
    rematchBtn.classList.add("hidden");
    statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : currentRoom.simulating ? "Bälle rollen..." : isMyTurn() ? "🎯 Zieh vom weißen Ball weg zum Zielen!" : "Warte auf den Gegner...";
  }
  draw();
}

function draw() {
  ctx.fillStyle = "#14532d"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = "#78350f"; ctx.lineWidth = 8; ctx.strokeRect(4,4,W-8,H-8);
  POCKETS.forEach(p => { ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(p.x,p.y,POCKET_R,0,Math.PI*2); ctx.fill(); });

  (currentRoom?.balls || []).forEach(b => {
    if (b.pocketed) return;
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI*2); ctx.fill();
  });

  if (aiming && aimStart && aimCurrent) {
    const cue = currentRoom.balls.find(b => b.id === "cue");
    if (cue) {
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cue.x, cue.y);
      const dx = cue.x - aimCurrent.x, dy = cue.y - aimCurrent.y;
      ctx.lineTo(cue.x + dx*3, cue.y + dy*3);
      ctx.stroke();
    }
  }
}

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (W/rect.width), y: (e.clientY - rect.top) * (H/rect.height) };
}

canvas.addEventListener("pointerdown", (e) => {
  if (isSpectator || !isMyTurn()) return;
  aiming = true; aimStart = canvasPos(e); aimCurrent = aimStart;
});
canvas.addEventListener("pointermove", (e) => { if (aiming) { aimCurrent = canvasPos(e); draw(); } });
canvas.addEventListener("pointerup", () => {
  if (!aiming) return;
  aiming = false;
  const cue = currentRoom.balls.find(b => b.id === "cue");
  if (cue && aimCurrent) {
    const dx = cue.x - aimCurrent.x, dy = cue.y - aimCurrent.y;
    const dist = Math.min(Math.sqrt(dx*dx+dy*dy), 90);
    if (dist > 8) shoot(dx/Math.sqrt(dx*dx+dy*dy) * dist * 0.12, dy/Math.sqrt(dx*dx+dy*dy) * dist * 0.12);
  }
  aimStart = null; aimCurrent = null;
});

async function shoot(vx, vy) {
  const balls = currentRoom.balls.map(b => ({ ...b }));
  const cue = balls.find(b => b.id === "cue");
  cue.vx = vx; cue.vy = vy;
  sfx.move ? sfx.move() : null;
  try { await updateDoc(roomRef, { balls, simulating: true }); } catch(e) {}
}

let simRunning = false;
function ensureSimLoop() { if (!simRunning) { simRunning = true; simLoop(); } }
function simLoop() {
  if (!isHost() || !currentRoom?.simulating) { simRunning = false; return; }
  stepPhysics();
  setTimeout(simLoop, 33);
}

async function stepPhysics() {
  const balls = currentRoom.balls.map(b => ({ ...b }));
  let anyMoving = false;

  balls.forEach(b => {
    if (b.pocketed) return;
    b.x += b.vx; b.y += b.vy;
    b.vx *= 0.985; b.vy *= 0.985;
    if (Math.abs(b.vx) < 0.05) b.vx = 0;
    if (Math.abs(b.vy) < 0.05) b.vy = 0;
    if (b.vx || b.vy) anyMoving = true;
  });

  // MAP FIX (Bug 3): Ball-Kollision läuft jetzt VOR der Wand-Kollision (statt danach),
  // damit ein Ball der gleichzeitig in ner Ecke gegen Wand UND anderen Ball trifft
  // nicht zuerst "falsch" von der Wand abprallt bevor der Ball-Kontakt berücksichtigt wird.
  for (let i = 0; i < balls.length; i++) for (let j = i+1; j < balls.length; j++) {
    const a = balls[i], b = balls[j];
    if (a.pocketed || b.pocketed) continue;
    let dx = b.x-a.x, dy = b.y-a.y, dist = Math.sqrt(dx*dx+dy*dy);
    // MAP FIX (Bug 2): falls zwei Bälle EXAKT übereinander liegen (dist===0), gäb's
    // vorher ne Division-durch-0 und die Kollision wurde stillschweigend übersprungen
    // -> Bälle blieben für immer "verklebt". Jetzt: winziger Zufalls-Nudge falls dist=0.
    if (dist === 0) { dx = (Math.random()-0.5)*0.1; dy = (Math.random()-0.5)*0.1; dist = 0.1; }
    if (dist < R*2) {
      const overlap = R*2 - dist;
      const nx = dx/dist, ny = dy/dist;
      a.x -= nx*overlap/2; a.y -= ny*overlap/2;
      b.x += nx*overlap/2; b.y += ny*overlap/2;
      // MAP FIX (Bug 1): vorher wurden die KOMPLETTEN Velocity-Vektoren getauscht
      // (physikalisch nur korrekt bei perfekt zentralem Stoß). Jetzt: richtige
      // elastische Kollision — nur die Geschwindigkeitskomponente ENTLANG der
      // Kollisionsnormalen wird ausgetauscht, die Tangential-Komponente bleibt erhalten.
      const relVelNormal = (b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
      if (relVelNormal < 0) {
        a.vx += nx*relVelNormal; a.vy += ny*relVelNormal;
        b.vx -= nx*relVelNormal; b.vy -= ny*relVelNormal;
      }
      sfx.hit ? sfx.hit() : null;
    }
  }

  balls.forEach(b => {
    if (b.pocketed) return;
    if (b.x - R < 10 || b.x + R > W-10) { b.vx *= -1; b.x = Math.max(10+R, Math.min(W-10-R, b.x)); }
    if (b.y - R < 10 || b.y + R > H-10) { b.vy *= -1; b.y = Math.max(10+R, Math.min(H-10-R, b.y)); }
  });

  let sunkCue = false;
  const newlyPocketed = [];
  balls.forEach(b => {
    if (b.pocketed) return;
    POCKETS.forEach(p => {
      const dx = b.x-p.x, dy = b.y-p.y;
      if (Math.sqrt(dx*dx+dy*dy) < POCKET_R) {
        b.pocketed = true;
        if (b.id === "cue") sunkCue = true;
        else newlyPocketed.push(b.id);
      }
    });
  });

  if (!anyMoving) {
    const pocketedCount = { ...(currentRoom.pocketedCount || {}) };
    const oppUid = opponentUid();
    let winnerUid = null, finished = false;

    if (sunkCue) {
      const cue = balls.find(b => b.id === "cue");
      cue.pocketed = false;
      // MAP FIX (Punkt 4): Respawn-Position leicht variieren falls sie mit nem
      // anderen Ball überlappt, statt immer stur den exakt gleichen Fixpunkt zu
      // nehmen — verhindert dass der weiße Ball direkt "in" nem anderen spawnt.
      let rx = W*0.25, ry = H/2, tries = 0;
      while (tries < 10 && balls.some(b => b.id !== "cue" && !b.pocketed && Math.hypot(b.x-rx, b.y-ry) < R*2.2)) {
        ry = H/2 + (Math.random()-0.5) * 40; tries++;
      }
      cue.x = rx; cue.y = ry; cue.vx = 0; cue.vy = 0;
      sfx.lose ? sfx.lose() : null;
    }
    newlyPocketed.forEach(id => {
      const isGroupA = id.startsWith("a");
      const ownerUid = currentRoom.groups[currentRoom.players[0]] === (isGroupA?"a":"b") ? currentRoom.players[0] : currentRoom.players[1];
      pocketedCount[ownerUid] = (pocketedCount[ownerUid]||0) + 1;
    });
    if (newlyPocketed.length) sfx.win ? sfx.win() : null;

    Object.entries(pocketedCount).forEach(([uid, count]) => { if (count >= 3) { finished = true; winnerUid = uid; } });

    const nextTurn = (newlyPocketed.length && !sunkCue) ? currentRoom.turn : oppUid;

    try {
      await updateDoc(roomRef, {
        balls, simulating: false, pocketedCount,
        turn: finished ? currentRoom.turn : nextTurn,
        status: finished ? "finished" : "active",
        winner: finished ? winnerUid : null
      });
      if (finished) {
        addDoc(collection(db, "matchResults"), { game: "pool", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
        if (winnerUid === myUid) awardGameReward(myUid, 100, "pool_win").catch(()=>{});
      }
    } catch(e) {}
  } else {
    try { await updateDoc(roomRef, { balls }); } catch(e) {}
  }
}

rematchBtn.addEventListener("click", async () => {
  const first = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const second = currentRoom.players.find(p => p !== first);
  await updateDoc(roomRef, {
    status: "active", winner: null, balls: initialBalls(),
    groups: { [first]: "a", [second]: "b" }, turn: currentRoom.players[0],
    simulating: false, pocketedCount: { [first]:0, [second]:0 }
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "pool", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
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
