// MAP — UNO-Light. Vereinfachte Version: 4 Farben (rot/gelb/grün/blau),
// Zahlen 0-9, Skip + Draw2 pro Farbe, 4 Wild-Karten (kein Wild-Draw4, das is
// der "Light"-Teil). Deck/Hände liegen im rooms/{id}.board-Feld, Host baut
// initial auf (gleiches Prinzip wie chess.js/checkers.js).
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
const drawPileEl = document.getElementById("draw-pile");
const discardTopEl = document.getElementById("discard-top");
const oppHandCountEl = document.getElementById("opp-hand-count");
const myHandEl = document.getElementById("my-hand");
const colorPickerEl = document.getElementById("color-picker");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

let myUid, roomRef, currentRoom, pendingWildCardIdx = null;
renderShopAd("shop-ad");

const COLORS = ["red","yellow","green","blue"];

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ color, value: "0" });
    for (let n = 1; n <= 9; n++) { deck.push({ color, value: String(n) }); deck.push({ color, value: String(n) }); }
    deck.push({ color, value: "skip" }); deck.push({ color, value: "skip" });
    deck.push({ color, value: "draw2" }); deck.push({ color, value: "draw2" });
  }
  for (let i = 0; i < 4; i++) deck.push({ color: "wild", value: "wild" });
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

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
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myUid; }

async function initIfHost() {
  if (!isHost()) return;
  const deck = buildDeck();
  const p0 = currentRoom.players[0], p1 = currentRoom.players[1];
  const hands = { [p0]: deck.splice(0,7), [p1]: deck.splice(0,7) };
  let firstDiscard = deck.pop();
  while (firstDiscard.color === "wild") { deck.unshift(firstDiscard); firstDiscard = deck.pop(); } // keine Wild-Karte als Startkarte
  await updateDoc(roomRef, {
    board: { deck, discard: [firstDiscard], hands, currentColor: firstDiscard.color, drawStack: 0 },
    turn: p0
  }).catch(()=>{});
}

function cardMatches(card, top, currentColor) {
  if (card.color === "wild") return true;
  return card.color === currentColor || card.value === top.value;
}

function renderCard(card, extraClass = "") {
  const label = card.value === "skip" ? "🚫" : card.value === "draw2" ? "+2" : card.value === "wild" ? "🌈" : card.value;
  return `<div class="uno-card ${card.color} ${extraClass}">${label}</div>`;
}

function render() {
  const room = currentRoom;
  if (!room.board) { statusEl.textContent = "Baue Deck auf..."; return; }
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames?.[myUid]||"Du"} vs ${room.playerNames?.[oppUid]||"Gegner"}`;

  const top = room.board.discard[room.board.discard.length - 1];
  discardTopEl.outerHTML = `<div id="discard-top" class="uno-card ${room.board.currentColor}">${top.value === "skip" ? "🚫" : top.value === "draw2" ? "+2" : top.value === "wild" ? "🌈" : top.value}</div>`;

  oppHandCountEl.textContent = `Gegner hat noch ${room.board.hands[oppUid]?.length ?? 0} Karten`;

  const myHand = room.board.hands[myUid] || [];
  myHandEl.innerHTML = myHand.map((card, i) => {
    const playable = isMyTurn() && cardMatches(card, top, room.board.currentColor);
    return `<div onclick="${playable ? `window.__unoPlay(${i})` : ""}">${renderCard(card, playable ? "" : "unplayable")}</div>`;
  }).join("");

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    return;
  }
  rematchBtn.classList.add("hidden");
  statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : isMyTurn() ? "🎯 Du bist dran!" : "Warte auf den Gegner...";
}

window.__unoDraw = async () => {
  if (!isMyTurn() || pendingWildCardIdx !== null) return;
  const board = JSON.parse(JSON.stringify(currentRoom.board));
  if (!board.deck.length) { board.deck = board.discard.splice(0, board.discard.length - 1); }
  const drawn = board.deck.pop();
  board.hands[myUid].push(drawn);
  sfx.move ? sfx.move() : null;
  await updateDoc(roomRef, { board, turn: opponentUid() }).catch(()=>{});
};

window.__unoPlay = async (idx) => {
  if (!isMyTurn()) return;
  const board = JSON.parse(JSON.stringify(currentRoom.board));
  const card = board.hands[myUid][idx];
  const top = board.discard[board.discard.length - 1];
  if (!cardMatches(card, top, board.currentColor)) return;

  if (card.color === "wild") {
    pendingWildCardIdx = idx;
    colorPickerEl.classList.remove("hidden");
    return;
  }
  await playCard(idx, card.color);
};

window.__unoPickColor = async (chosenColor) => {
  if (pendingWildCardIdx === null) return;
  colorPickerEl.classList.add("hidden");
  await playCard(pendingWildCardIdx, chosenColor);
  pendingWildCardIdx = null;
};

async function playCard(idx, resultColor) {
  const board = JSON.parse(JSON.stringify(currentRoom.board));
  const card = board.hands[myUid].splice(idx, 1)[0];
  board.discard.push(card);
  board.currentColor = resultColor;
  sfx.hit ? sfx.hit() : null;

  const oppUid = opponentUid();
  let nextTurn = oppUid;

  if (card.value === "skip") {
    nextTurn = myUid; // Gegner übersprungen, ich bin nochmal dran
  } else if (card.value === "draw2") {
    for (let i = 0; i < 2; i++) {
      if (!board.deck.length) board.deck = board.discard.splice(0, board.discard.length - 1);
      board.hands[oppUid].push(board.deck.pop());
    }
    nextTurn = myUid; // Gegner zieht + wird übersprungen
  }

  const finished = board.hands[myUid].length === 0;
  try {
    await updateDoc(roomRef, {
      board, turn: finished ? currentRoom.turn : nextTurn,
      ...(finished ? { status: "finished", winner: myUid } : {})
    });
    if (finished) {
      sfx.win ? sfx.win() : null;
      addDoc(collection(db,"matchResults"), { game:"uno", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: myUid, at: serverTimestamp() }).catch(()=>{});
      awardGameReward(myUid, 100, "uno_win").catch(()=>{});
    }
  } catch(e) {}
}

rematchBtn.addEventListener("click", async () => {
  const deck = buildDeck();
  const p0 = currentRoom.players[0], p1 = currentRoom.players[1];
  const hands = { [p0]: deck.splice(0,7), [p1]: deck.splice(0,7) };
  let firstDiscard = deck.pop();
  while (firstDiscard.color === "wild") { deck.unshift(firstDiscard); firstDiscard = deck.pop(); }
  const starter = Math.random() < 0.5 ? p0 : p1;
  await updateDoc(roomRef, {
    status:"active", winner:null,
    board: { deck, discard: [firstDiscard], hands, currentColor: firstDiscard.color, drawStack: 0 },
    turn: starter
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"uno", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});
