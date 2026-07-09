// MAP — Tower-Defense-Duell. Beide bauen eigene Türme auf ihrer Spur, schicken
// aber Gegner-Wellen auf die Spur des ANDEREN (nicht die eigene) — wer zuerst 0 HP
// hat verliert. Simples Gold-System, Host simuliert beide Spuren synchron.
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
const canvas = document.getElementById("td-canvas");
const ctx = canvas.getContext("2d");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const myHpEl = document.getElementById("my-hp");
const myGoldEl = document.getElementById("my-gold");
const oppHpEl = document.getElementById("opp-hp");
const shopEl = document.getElementById("tower-shop");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const W = canvas.width, LANE_Y_MY = 45, LANE_Y_OPP = 135, PATH_LEN = W - 40;
const TOWER_COST = 40, WAVE_COST = 25, MAX_HP = 20;
const TOWER_RANGE = 40, TOWER_DMG = 1, TOWER_RATE_MS = 600;

let myUid, roomRef, currentRoom, lastTick = 0;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.lanes) initIfHost();
    render();
    if (isHost() && currentRoom.status === "active") ensureSimLoop();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

async function initIfHost() {
  if (!isHost()) return;
  const lanes = {};
  currentRoom.players.forEach(uid => { lanes[uid] = { hp: MAX_HP, gold: 100, towers: [], enemies: [] }; });
  await updateDoc(roomRef, { lanes }).catch(()=>{});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}`;
  const myLane = room.lanes?.[myUid], oppLane = room.lanes?.[oppUid];
  if (myLane) { myHpEl.textContent = "❤️ " + myLane.hp; myGoldEl.textContent = "💰 " + myLane.gold; }
  if (oppLane) oppHpEl.textContent = "Gegner: ❤️ " + oppLane.hp;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    shopEl.innerHTML = "";
  } else {
    rematchBtn.classList.add("hidden");
    statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : "Bau Türme auf deiner Spur, schick Wellen zum Gegner!";
    renderShop(myLane);
  }
  draw();
}

function renderShop(myLane) {
  if (isSpectator || !myLane) { shopEl.innerHTML = ""; return; }
  shopEl.innerHTML = "";
  const towerBtn = document.createElement("button");
  towerBtn.className = "tower-shop-btn";
  towerBtn.textContent = `🗼 Turm bauen (${TOWER_COST}💰)`;
  towerBtn.disabled = myLane.gold < TOWER_COST;
  towerBtn.addEventListener("click", buildTower);
  shopEl.appendChild(towerBtn);

  const waveBtn = document.createElement("button");
  waveBtn.className = "tower-shop-btn";
  waveBtn.textContent = `👹 Welle schicken (${WAVE_COST}💰)`;
  waveBtn.disabled = myLane.gold < WAVE_COST;
  waveBtn.addEventListener("click", sendWave);
  shopEl.appendChild(waveBtn);
}

async function buildTower() {
  const lane = currentRoom.lanes[myUid];
  if (lane.gold < TOWER_COST) return;
  const newLane = { ...lane, gold: lane.gold - TOWER_COST, towers: [...lane.towers, { x: 30 + Math.random()*(PATH_LEN-30), lastShot: 0 }] };
  sfx.move ? sfx.move() : null;
  await updateDoc(roomRef, { [`lanes.${myUid}`]: newLane }).catch(()=>{});
}

// MAP FIX (Bug 5): Hard-Cap bei 15 gleichzeitigen Enemies pro Lane. Vorher gab's
// keine Grenze — falls wer schneller Wellen schickt als sie sterben (oder ein Bug
// im Killing-Code steckt), hätte lane.enemies unbegrenzt wachsen können, was
// irgendwann den Firestore-Doc größer und langsamer macht.
const MAX_ENEMIES_PER_LANE = 15;

async function sendWave() {
  const oppUid = opponentUid();
  const lane = currentRoom.lanes[myUid];
  if (lane.gold < WAVE_COST) return;
  const oppLane = currentRoom.lanes[oppUid];
  if (oppLane.enemies.length >= MAX_ENEMIES_PER_LANE) {
    statusEl.textContent = "Gegner-Spur ist voll — warte bis welche sterben!";
    return;
  }
  const newOppLane = { ...oppLane, enemies: [...oppLane.enemies, { x: 20, hp: 3, maxHp: 3 }] };
  const newMyLane = { ...lane, gold: lane.gold - WAVE_COST };
  sfx.hit ? sfx.hit() : null;
  await updateDoc(roomRef, { [`lanes.${myUid}`]: newMyLane, [`lanes.${oppUid}`]: newOppLane }).catch(()=>{});
}

let simRunning = false;
function ensureSimLoop() {
  if (simRunning) return;
  simRunning = true;
  simLoop();
}
function simLoop() {
  if (!isHost() || currentRoom?.status !== "active") { simRunning = false; return; }
  stepSim();
  setTimeout(simLoop, 100);
}

async function stepSim() {
  const room = currentRoom;
  const lanes = JSON.parse(JSON.stringify(room.lanes));
  const now = Date.now();
  let finished = false, winnerUid = null;

  Object.entries(lanes).forEach(([uid, lane]) => {
    // Gold-Regeneration passiv
    lane.gold += 1;

    // Enemies bewegen
    lane.enemies.forEach(e => { e.x += 1.2; });

    // Türme schießen
    lane.towers.forEach(t => {
      if (now - t.lastShot < TOWER_RATE_MS) return;
      const target = lane.enemies.find(e => Math.abs(e.x - t.x) < TOWER_RANGE && e.hp > 0);
      if (target) { target.hp -= TOWER_DMG; t.lastShot = now; }
    });

    // Tote Enemies raus, Gold für den Turm-Besitzer (lokal, simpel gehalten)
    const before = lane.enemies.length;
    lane.enemies = lane.enemies.filter(e => e.hp > 0);
    const killed = before - lane.enemies.length;
    if (killed) {
      const goldGain = killed * 5;
      lane.gold += goldGain;
      // MAP FEATURE (Punkt 3): visuelles "+X💰"-Popup statt nur stillem Zahlen-Update
      if (uid === myUid) spawnGoldPopup(goldGain);
    }

    // Enemies die durchkommen (x >= PATH_LEN) schaden dem lane-Besitzer
    const reached = lane.enemies.filter(e => e.x >= PATH_LEN);
    lane.hp -= reached.length;
    lane.enemies = lane.enemies.filter(e => e.x < PATH_LEN);

    if (lane.hp <= 0) { lane.hp = 0; finished = true; winnerUid = Object.keys(lanes).find(u => u !== uid); }
  });

  try {
    await updateDoc(roomRef, {
      lanes, status: finished ? "finished" : "active", winner: finished ? winnerUid : null
    });
    if (finished) {
      addDoc(collection(db,"matchResults"), { game:"towerdefense", players: room.players, playerNames: room.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "towerdefense_win").catch(()=>{});
    }
  } catch(e) {}
}

function spawnGoldPopup(amount) {
  const el = document.createElement("div");
  el.textContent = "+" + amount + "💰";
  // MAP FIX (Bug 4): getBoundingClientRect() liefert Viewport-relative Koordinaten,
  // aber "position:absolute" ist relativ zum DOCUMENT (Page), nicht zum Viewport —
  // beim Scrollen war das Popup dadurch an der falschen Stelle. "position:fixed" ist
  // Viewport-relativ, passt also zu den rect.left/rect.top-Werten von oben.
  el.style.cssText = "position:fixed;font-family:'Press Start 2P',monospace;font-size:12px;color:#f59e0b;pointer-events:none;z-index:20;animation:mapGoldFloat 1s ease-out forwards;";
  const rect = canvas.getBoundingClientRect();
  el.style.left = (rect.left + rect.width/2) + "px";
  el.style.top = (rect.top + 20) + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
if (!document.getElementById("map-gold-float-style")) {
  const style = document.createElement("style");
  style.id = "map-gold-float-style";
  style.textContent = "@keyframes mapGoldFloat { 0%{opacity:1;transform:translateY(0);} 100%{opacity:0;transform:translateY(-30px);} }";
  document.head.appendChild(style);
}

function draw() {
  ctx.fillStyle = "#0c1420"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const room = currentRoom;
  if (!room?.lanes) return;
  [{ uid: myUid, y: LANE_Y_MY }, { uid: opponentUid(), y: LANE_Y_OPP }].forEach(({uid,y}) => {
    const lane = room.lanes[uid];
    if (!lane) return;
    ctx.strokeStyle = "#3a3f58"; ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(20+PATH_LEN,y); ctx.stroke();
    ctx.fillStyle = uid===myUid ? "#60a5fa" : "#dc2626";
    lane.towers.forEach(t => { ctx.fillRect(t.x-4, y-18, 8, 14); });
    ctx.fillStyle = "#f59e0b";
    lane.enemies.forEach(e => { ctx.beginPath(); ctx.arc(20+e.x, y, 6, 0, Math.PI*2); ctx.fill(); });
  });
}

rematchBtn.addEventListener("click", async () => {
  const lanes = {};
  currentRoom.players.forEach(uid => { lanes[uid] = { hp: MAX_HP, gold: 100, towers: [], enemies: [] }; });
  await updateDoc(roomRef, { status:"active", winner:null, lanes });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"towerdefense", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
