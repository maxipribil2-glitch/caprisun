// MAP — Nim (Misère-Variante: wer den letzten Stein nimmt, verliert). Rundenbasiert
// über "rooms" wie Tic-Tac-Toe/Connect4. 3 Haufen mit zufälliger Startgröße (5-9).
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp, runTransaction
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
const pilesEl = document.getElementById("nim-piles");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) window.location.href = "lobby.html";

let myUid, roomRef, currentRoom, selection = null; // {pileIdx, count}

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    if (!currentRoom.piles) initPilesIfHost();
    maybeShowReaction(currentRoom);
    render();
    armTurnTimeout();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
// MAP FIX (Timeout-Fallback): vorher konnte ein Spieler den Tab schließen ohne
// "Verlassen" zu klicken, der Gegner blieb dann für IMMER in nem hängenden Match.
// Jetzt: 60s pro Zug, danach automatischer Verlust — gleicher Transaction-Pattern
// wie in wordchain.js, damit's keine Race Condition gibt falls beide Clients
// gleichzeitig den Timeout auswerten.
const TURN_TIMEOUT_MS = 60000;
let turnTimeoutTimer;
function armTurnTimeout() {
  clearTimeout(turnTimeoutTimer);
  if (!currentRoom || currentRoom.status !== "active" || !currentRoom.turnStartAt) return;
  const elapsed = Date.now() - currentRoom.turnStartAt;
  const remaining = TURN_TIMEOUT_MS - elapsed;
  if (remaining <= 0) { resolveTurnTimeout(currentRoom.turn); return; }
  turnTimeoutTimer = setTimeout(() => resolveTurnTimeout(currentRoom.turn), remaining + 500);
}
async function resolveTurnTimeout(timedOutUid) {
  if (isSpectator || !currentRoom) return;
  try {
    let winnerUid = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const cur = snap.data();
      if (!cur || cur.status !== "active" || cur.turn !== timedOutUid) return;
      if (Date.now() - (cur.turnStartAt||0) < TURN_TIMEOUT_MS) return;
      winnerUid = cur.players.find(p => p !== timedOutUid);
      tx.update(roomRef, { status: "finished", winner: winnerUid });
    });
    if (winnerUid) {
      addDoc(collection(db, "matchResults"), { game: "nim", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "nim_win").catch(()=>{});
    }
  } catch(e) {}
}

function isMyTurn() { return currentRoom.status === "active" && currentRoom.turn === myUid; }

async function initPilesIfHost() {
  if (!isHost()) return;
  const piles = Array.from({ length: 3 }, () => 5 + Math.floor(Math.random() * 5));
  await updateDoc(roomRef, { piles, turn: currentRoom.players[0] }).catch(() => {});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : `${room.playerNames[oppUid] || "Gegner"} hat gewonnen.`;
    renderPiles(true);
    return;
  }
  rematchBtn.classList.add("hidden");
  statusEl.textContent = isMyTurn() ? "🎯 Du bist dran — 1-3 Steine aus EINEM Haufen wählen, dann bestätigen." : "Warte auf den Gegner...";
  renderPiles(false);
}

function renderPiles(locked) {
  if (!currentRoom.piles) { pilesEl.innerHTML = "<div class='hint'>Setup läuft...</div>"; return; }
  pilesEl.innerHTML = "";
  currentRoom.piles.forEach((count, pileIdx) => {
    const row = document.createElement("div");
    row.className = "nim-pile-row";
    const label = document.createElement("span");
    label.style.cssText = "min-width:70px;font-size:14px;";
    label.textContent = `Haufen ${pileIdx + 1}:`;
    row.appendChild(label);
    for (let i = 0; i < count; i++) {
      const stone = document.createElement("span");
      const isSelected = selection && selection.pileIdx === pileIdx && i >= count - selection.count;
      stone.className = "nim-stone" + (isSelected ? " selected" : "");
      if (!locked && isMyTurn()) {
        stone.addEventListener("click", () => selectStones(pileIdx, count - i));
      }
      row.appendChild(stone);
    }
    pilesEl.appendChild(row);
  });

  if (selection && !locked) {
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = `${selection.count} Stein(e) aus Haufen ${selection.pileIdx + 1} nehmen ✅`;
    confirmBtn.addEventListener("click", confirmMove);
    pilesEl.appendChild(confirmBtn);
  }
}

function selectStones(pileIdx, countFromEnd) {
  if (!isMyTurn()) return;
  // Klick auf N-ten Stein von rechts wählt 1..N Steine (gecappt bei 3) aus diesem Haufen
  const count = Math.min(countFromEnd, 3);
  if (selection && selection.pileIdx === pileIdx && selection.count === count) {
    selection = null; // nochmal klicken = deselect
  } else {
    selection = { pileIdx, count };
  }
  render();
}

async function confirmMove() {
  if (!selection || !isMyTurn()) return;
  const room = currentRoom;
  const newPiles = [...room.piles];
  newPiles[selection.pileIdx] -= selection.count;
  const oppUid = opponentUid();
  const allEmpty = newPiles.every(p => p === 0);

  sfx.move ? sfx.move() : null;
  selection = null;

  try {
    if (allEmpty) {
      // Misère-Regel: wer den letzten Stein nimmt (also gerade gezogen hat), VERLIERT
      const winnerUid = oppUid;
      await updateDoc(roomRef, { piles: newPiles, status: "finished", winner: winnerUid });
      addDoc(collection(db, "matchResults"), {
        game: "nim", players: room.players, playerNames: room.playerNames,
        winner: winnerUid, at: serverTimestamp()
      }).catch(() => {});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "nim_win").catch(() => {});
      sfx.lose ? sfx.lose() : null;
    } else {
      await updateDoc(roomRef, { piles: newPiles, turn: oppUid });
    }
  } catch (e) {}
}

rematchBtn.addEventListener("click", async () => {
  const piles = Array.from({ length: 3 }, () => 5 + Math.floor(Math.random() * 5));
  await updateDoc(roomRef, { status: "active", winner: null, piles, turn: currentRoom.players[Math.random()<0.5?0:1] });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom && currentRoom.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), {
        game: "nim", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: oppUid, at: serverTimestamp()
      }).catch(() => {});
    } catch (e) {}
  }
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
