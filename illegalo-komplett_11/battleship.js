// MAP — Schiffe versenken (1v1, per Invite). Setup-Phase (Schiffe platzieren) dann
// Kampf-Phase (rundenbasiert, wie Tic-Tac-Toe/Connect4). Jeder Spieler hat sein eigenes
// verstecktes Board (own.ships) und sieht nur die eigenen Treffer aufs Gegner-Board
// (myShots), nicht die Schiffs-Positionen des Gegners — die bleiben in own.ships versteckt
// bis sie versenkt sind (kein Cheating durch DevTools-Blick in Firestore-Daten möglich,
// weil jeder nur seine EIGENEN Schiffe in seinem eigenen Feld sieht + Rules unten).
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
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const db = getFirestore(app);

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const isSpectator = params.get("spectate") === "1";

const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const setupPanel = document.getElementById("setup-panel");
const battlePanel = document.getElementById("battle-panel");
const setupGridEl = document.getElementById("setup-grid");
const ownGridEl = document.getElementById("own-grid");
const enemyGridEl = document.getElementById("enemy-grid");
const randomizeBtn = document.getElementById("randomize-btn");
const readyBtn = document.getElementById("ready-btn");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) { window.location.href = "lobby.html"; }

const SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

let myUid = null;
let roomRef = null;
let currentRoom = null;

// Setup-Phase local state
let placedShips = []; // [{cells:[[r,c],...], length, sunk:false}]
let currentShipIdx = 0;
let orientation = "h"; // h | v
let placementGrid; // SIZE x SIZE, true = occupied

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) {
    initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  }
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Dieser Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    maybeShowReaction(currentRoom);
    render();
  });
  if (!isSpectator) initSetup();
});

function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return currentRoom && currentRoom.status === "active" && currentRoom.turn === myUid; }
function myReady() { return !!(currentRoom?.ready?.[myUid]); }
function oppReady() { return !!(currentRoom?.ready?.[opponentUid()]); }

function emptyBoard() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(0)); }

// ── Setup-Phase ──
function initSetup() {
  placementGrid = emptyBoard();
  placedShips = [];
  currentShipIdx = 0;
  renderSetupGrid();
}

function renderSetupGrid() {
  setupGridEl.innerHTML = "";
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "bs-cell" + (placementGrid[r][c] ? " ship" : "");
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener("click", () => onSetupCellClick(r, c));
      setupGridEl.appendChild(cell);
    }
  }
}

function canPlace(r, c, len, orient) {
  const cells = [];
  for (let i = 0; i < len; i++) {
    const rr = orient === "h" ? r : r + i;
    const cc = orient === "h" ? c + i : c;
    if (rr >= SIZE || cc >= SIZE) return null;
    if (placementGrid[rr][cc]) return null;
    cells.push([rr, cc]);
  }
  return cells;
}

function onSetupCellClick(r, c) {
  if (currentShipIdx >= SHIP_LENGTHS.length) return;
  const len = SHIP_LENGTHS[currentShipIdx];
  const cells = canPlace(r, c, len, orientation);
  if (!cells) { orientation = orientation === "h" ? "v" : "h"; return; } // Klick auf besetzt = drehen
  cells.forEach(([rr, cc]) => { placementGrid[rr][cc] = 1; });
  placedShips.push({ cells, length: len, sunk: false });
  currentShipIdx++;
  renderSetupGrid();
  if (currentShipIdx >= SHIP_LENGTHS.length) {
    statusEl.textContent = "Alle Schiffe platziert! Drück 'Bereit' wenn's passt.";
  } else {
    statusEl.textContent = `Schiff ${currentShipIdx + 1}/${SHIP_LENGTHS.length} (Länge ${SHIP_LENGTHS[currentShipIdx]}) — Klick zum Platzieren, Klick auf besetztes Feld dreht die Ausrichtung.`;
  }
}

function randomizePlacement() {
  placementGrid = emptyBoard();
  placedShips = [];
  for (const len of SHIP_LENGTHS) {
    let placed = false, tries = 0;
    while (!placed && tries < 300) {
      tries++;
      const orient = Math.random() < 0.5 ? "h" : "v";
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const cells = canPlace(r, c, len, orient);
      if (cells) {
        cells.forEach(([rr, cc]) => { placementGrid[rr][cc] = 1; });
        placedShips.push({ cells, length: len, sunk: false });
        placed = true;
      }
    }
  }
  currentShipIdx = SHIP_LENGTHS.length;
  renderSetupGrid();
  statusEl.textContent = "Zufällig platziert! Drück 'Bereit' wenn's passt.";
}

randomizeBtn.addEventListener("click", randomizePlacement);

readyBtn.addEventListener("click", async () => {
  if (placedShips.length < SHIP_LENGTHS.length) { statusEl.textContent = "Erst alle Schiffe platzieren!"; return; }
  try {
    await updateDoc(roomRef, {
      [`ready.${myUid}`]: true,
      [`ships.${myUid}`]: placedShips.map(s => ({ cells: s.cells, length: s.length, sunk: false })),
      [`shots.${myUid}`]: [] // meine abgegebenen Schüsse aufs Gegner-Feld
    });
  } catch (e) {}
});

// ── Render Hauptzustand ──
function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}`;

  if (room.status === "finished") {
    setupPanel.classList.add("hidden");
    battlePanel.classList.remove("hidden");
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥 Alle Gegner-Schiffe versenkt!" : "Alle deine Schiffe wurden versenkt. GG.";
    renderBattleGrids();
    return;
  }

  rematchBtn.classList.add("hidden");

  if (room.status !== "active" || !myReady() || !oppReady()) {
    setupPanel.classList.remove("hidden");
    battlePanel.classList.add("hidden");
    if (myReady() && !oppReady()) statusEl.textContent = "Warte auf den Gegner...";
    return;
  }

  setupPanel.classList.add("hidden");
  battlePanel.classList.remove("hidden");
  statusEl.textContent = isMyTurn() ? "🎯 Du bist dran — schieß aufs Gegner-Feld!" : "Warte auf den Schuss vom Gegner...";
  renderBattleGrids();
}

function renderBattleGrids() {
  const room = currentRoom;
  const oppUid = opponentUid();
  const myShips = room.ships?.[myUid] || [];
  const oppShots = room.shots?.[oppUid] || []; // Schüsse des Gegners auf MEIN Feld
  const myShots = room.shots?.[myUid] || [];   // meine Schüsse aufs Gegner-Feld

  // Eigenes Feld: zeigt eigene Schiffe + Treffer/Fehlschüsse vom Gegner
  ownGridEl.innerHTML = "";
  const myOccupied = new Set();
  myShips.forEach(s => s.cells.forEach(([r, c]) => myOccupied.add(r + "," + c)));
  const oppShotSet = new Set(oppShots.map(s => s.r + "," + s.c));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = r + "," + c;
      const cell = document.createElement("div");
      let cls = "bs-cell";
      if (myOccupied.has(key)) cls += " ship";
      if (oppShotSet.has(key)) cls += myOccupied.has(key) ? " hit" : " miss";
      cell.className = cls;
      cell.textContent = oppShotSet.has(key) ? (myOccupied.has(key) ? "💥" : "•") : "";
      ownGridEl.appendChild(cell);
    }
  }

  // Gegner-Feld: nur meine eigenen Schüsse sichtbar, keine Schiffs-Positionen
  enemyGridEl.innerHTML = "";
  const myShotMap = {};
  myShots.forEach(s => { myShotMap[s.r + "," + s.c] = s.hit; });
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = r + "," + c;
      const cell = document.createElement("div");
      const shot = myShotMap[key];
      let cls = "bs-cell";
      if (shot === true) cls += " hit";
      else if (shot === false) cls += " miss";
      cell.className = cls;
      cell.textContent = shot === true ? "💥" : shot === false ? "•" : "";
      if (shot === undefined && isMyTurn()) {
        cell.style.cursor = "pointer";
        cell.addEventListener("click", () => fireShot(r, c));
      }
      enemyGridEl.appendChild(cell);
    }
  }
}

async function fireShot(r, c) {
  if (!isMyTurn()) return;
  const room = currentRoom;
  const oppUid = opponentUid();
  const myShots = room.shots?.[myUid] || [];
  if (myShots.some(s => s.r === r && s.c === c)) return; // schon geschossen

  const oppShips = room.ships?.[oppUid] || [];
  let hit = false;
  let hitShipIdx = -1;
  oppShips.forEach((s, i) => {
    if (s.cells.some(([sr, sc]) => sr === r && sc === c)) { hit = true; hitShipIdx = i; }
  });

  const newShots = [...myShots, { r, c, hit }];
  let newOppShips = oppShips;
  let sunkThisShot = false;
  if (hit) {
    newOppShips = oppShips.map((s, i) => {
      if (i !== hitShipIdx) return s;
      const hitCells = (s.hitCells || []).concat([[r, c]]);
      const isSunk = hitCells.length >= s.cells.length;
      if (isSunk && !s.sunk) sunkThisShot = true;
      return { ...s, hitCells, sunk: isSunk };
    });
  }

  const allSunk = newOppShips.length === SHIP_LENGTHS.length && newOppShips.every(s => s.sunk);

  try {
    sfx.hit ? sfx.hit() : null;
    if (hit) { sunkThisShot ? (sfx.win ? sfx.win() : null) : null; } else { sfx.move ? sfx.move() : null; }
    await updateDoc(roomRef, {
      [`shots.${myUid}`]: newShots,
      [`ships.${oppUid}`]: newOppShips,
      turn: hit ? myUid : oppUid, // Treffer = nochmal dran (klassische Regel-Variante)
      status: allSunk ? "finished" : "active",
      winner: allSunk ? myUid : null
    });
    if (allSunk) {
      addDoc(collection(db, "matchResults"), {
        game: "battleship", players: room.players, playerNames: room.playerNames,
        winner: myUid, at: serverTimestamp()
      }).catch(() => {});
      awardGameReward(myUid, 100, "battleship_win").catch(() => {});
    }
  } catch (e) {}
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    status: "setup", winner: null, ready: {}, ships: {}, shots: {},
    turn: currentRoom.players[Math.random() < 0.5 ? 0 : 1]
  });
  initSetup();
});

leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });

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
