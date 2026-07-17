// MAP — Mancala 1v1. Standard-Regeln: 6 Mulden pro Spieler + je 1 Store.
// Board-Array (14 Felder): 0-5 = Spieler-A-Mulden, 6 = A-Store, 7-12 = Spieler-
// B-Mulden, 13 = B-Store. Steine wandern gegen den Uhrzeigersinn (Index++, mod 14),
// A's eigener Store zählt für A (Index 6), B's Store übersprungen wenn A dran is
// (Index 13 wird beim Verteilen ausgelassen falls Spieler A zieht, und umgekehrt).
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
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const rowTopEl = document.getElementById("row-top");
const rowBottomEl = document.getElementById("row-bottom");
const storeLeftEl = document.getElementById("store-left");
const storeRightEl = document.getElementById("store-right");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

let myUid, roomRef, currentRoom;
renderShopAd("shop-ad");

const STARTING_BOARD = [4,4,4,4,4,4,0, 4,4,4,4,4,4,0]; // 6 Mulden + Store, zweimal

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.board) initIfHost();
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function amPlayerA() { return currentRoom.players[0] === myUid; } // A = eigene Seite unten
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myUid; }

async function initIfHost() {
  if (!isHost()) return;
  await updateDoc(roomRef, { board: [...STARTING_BOARD], turn: currentRoom.players[0] }).catch(()=>{});
}

// Indizes 0-5 = A-Mulden, 6 = A-Store, 7-12 = B-Mulden, 13 = B-Store
function myPitRange() { return amPlayerA() ? [0,5] : [7,12]; }
function myStoreIdx() { return amPlayerA() ? 6 : 13; }
function oppStoreIdx() { return amPlayerA() ? 13 : 6; }
function oppositePit(idx) { return 12 - idx; } // Standard-Mancala-Spiegelformel für 6er-Reihen

function render() {
  const room = currentRoom;
  if (!room.board) { statusEl.textContent = "Baue Board auf..."; return; }
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames?.[myUid]||"Du"} vs ${room.playerNames?.[oppUid]||"Gegner"}`;

  // A-Mulden (0-5) unten von links nach rechts, B-Mulden (7-12) oben gespiegelt
  const isA = amPlayerA();
  const myPits = isA ? room.board.slice(0,6) : room.board.slice(7,13);
  const oppPits = isA ? room.board.slice(7,13).reverse() : room.board.slice(0,6).reverse();

  rowTopEl.innerHTML = oppPits.map((n, i) => `<div class="mancala-pit">${n}</div>`).join("");
  rowBottomEl.innerHTML = myPits.map((n, i) => {
    const realIdx = isA ? i : 7+i;
    const clickable = isMyTurn() && n > 0;
    return `<div class="mancala-pit${clickable?" mine":" empty-clickable"}" data-idx="${realIdx}" ${clickable?`onclick="window.__mancalaPlay(${realIdx})"`:""}>${n}</div>`;
  }).join("");

  storeLeftEl.textContent = isA ? room.board[6] : room.board[13];
  storeRightEl.textContent = isA ? room.board[13] : room.board[6];

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : room.winner === null ? "Unentschieden!" : "Verloren, GG.";
    return;
  }
  rematchBtn.classList.add("hidden");
  statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : isMyTurn() ? "🎯 Du bist dran!" : "Warte auf den Gegner...";
}

window.__mancalaPlay = async (startIdx) => {
  if (!isMyTurn()) return;
  const board = [...currentRoom.board];
  let stones = board[startIdx];
  if (stones <= 0) return;
  board[startIdx] = 0;
  let idx = startIdx;
  const myStore = myStoreIdx(), oppStore = oppStoreIdx();

  while (stones > 0) {
    idx = (idx + 1) % 14;
    if (idx === oppStore) continue; // gegnerischen Store überspringen
    board[idx]++;
    stones--;
  }

  let extraTurn = false;
  let capture = false;

  // Landete letzter Stein im eigenen Store? -> nochmal ziehen
  if (idx === myStore) {
    extraTurn = true;
  }
  // Landete letzter Stein in einer EIGENEN, vorher leeren Mulde? -> Capture
  const [myLo, myHi] = myPitRange();
  if (idx >= myLo && idx <= myHi && board[idx] === 1) {
    const oppPit = oppositePit(idx);
    if (board[oppPit] > 0) {
      board[myStore] += board[oppPit] + 1;
      board[idx] = 0;
      board[oppPit] = 0;
      capture = true;
    }
  }

  // Spiel-Ende-Check: eine Seite komplett leer?
  const aEmpty = board.slice(0,6).every(n => n === 0);
  const bEmpty = board.slice(7,13).every(n => n === 0);
  let finished = false, winner = null;
  if (aEmpty || bEmpty) {
    finished = true;
    if (aEmpty) { board[13] += board.slice(7,13).reduce((s,n)=>s+n,0); for(let i=7;i<=12;i++) board[i]=0; }
    else { board[6] += board.slice(0,6).reduce((s,n)=>s+n,0); for(let i=0;i<=5;i++) board[i]=0; }
    winner = board[6] === board[13] ? null : (board[6] > board[13] ? currentRoom.players[0] : currentRoom.players[1]);
  }

  sfx.move ? sfx.move() : null;
  if (capture) sfx.hit ? sfx.hit() : null;

  const nextTurn = finished ? currentRoom.turn : (extraTurn ? myUid : opponentUid());
  try {
    await updateDoc(roomRef, {
      board, turn: nextTurn,
      ...(finished ? { status: "finished", winner } : {})
    });
    if (finished) {
      sfx.win ? sfx.win() : null;
      addDoc(collection(db,"matchResults"), { game:"mancala", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winner || currentRoom.players[0], at: serverTimestamp() }).catch(()=>{});
      if (winner === myUid) awardGameReward(myUid, 100, "mancala_win").catch(()=>{});
    }
  } catch(e) {}
};

rematchBtn.addEventListener("click", async () => {
  const starter = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  await updateDoc(roomRef, { status:"active", winner:null, board:[...STARTING_BOARD], turn: starter });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"mancala", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
