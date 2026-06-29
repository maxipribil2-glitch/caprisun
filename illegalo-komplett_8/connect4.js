// MAP — Vier Gewinnt (1v1 Duell), turn-based wie Tic-Tac-Toe — ein Firestore-Write pro Zug.
// Board ist ein flaches Array, Länge 42 (7 Spalten x 6 Reihen), Index = row*7 + col,
// row 0 = oberste Reihe, row 5 = unterste Reihe (wo Steine zuerst landen).
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

const COLS = 7, ROWS = 6;

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");

const boardEl = document.getElementById("c4-board");
const statusEl = document.getElementById("status");
const namesEl = document.getElementById("names");
const turnLineEl = document.getElementById("turn-line");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) { window.location.href = "lobby.html"; }

function idx(row, col) { return row * COLS + col; }

function lowestEmptyRow(board, col) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (!board[idx(row, col)]) return row;
  }
  return -1; // column full
}

function checkWinner(board) {
  const get = (r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS) ? null : board[idx(r, c)];
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = get(r, c);
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let k = 1; k < 4; k++) { if (get(r + dr*k, c + dc*k) === v) count++; else break; }
        if (count >= 4) return v;
      }
    }
  }
  if (board.every(c => c)) return "draw";
  return null;
}

let myUid = null;
let roomRef = null;
let currentRoom = null;
let lastBoardFill = 0;
let lastStatus = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Dieser Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    render();
  });
});

function buildBoardDom() {
  boardEl.innerHTML = "";
  for (let c = 0; c < COLS; c++) {
    const colEl = document.createElement("div");
    colEl.className = "c4-col";
    colEl.dataset.col = c;
    for (let r = 0; r < ROWS; r++) {
      const cellEl = document.createElement("div");
      cellEl.className = "c4-cell";
      cellEl.dataset.row = r;
      colEl.appendChild(cellEl);
    }
    colEl.addEventListener("click", () => playMove(c));
    boardEl.appendChild(colEl);
  }
}
buildBoardDom();

function render() {
  const room = currentRoom;
  maybeShowReaction(room);
  const mySymbol = room.symbols[myUid];
  const otherUid = room.players.find(p => p !== myUid);
  const otherName = room.playerNames[otherUid] || "Gegner";
  namesEl.textContent = `${room.playerNames[myUid]} (${mySymbol === "p1" ? "🔴" : "🟡"}) vs ${otherName} (${room.symbols[otherUid] === "p1" ? "🔴" : "🟡"})`;

  room.board.forEach((v, i) => {
    const r = Math.floor(i / COLS), c = i % COLS;
    const cellEl = boardEl.querySelector(`.c4-col[data-col="${c}"] .c4-cell[data-row="${r}"]`);
    cellEl.className = "c4-cell" + (v ? " " + v : " empty-top");
  });

  const fillCount = room.board.filter(c => c).length;
  if (fillCount > lastBoardFill && room.status !== "finished") sfx.move();
  lastBoardFill = fillCount;

  if (room.status === "finished") {
    if (room.winner === "draw") {
      statusEl.textContent = "Unentschieden. Nochmal?";
      if (lastStatus !== "finished") sfx.draw();
    } else if (room.winner === mySymbol) {
      statusEl.textContent = "DU HAST GEWONNEN 🔥";
      if (lastStatus !== "finished") sfx.win();
    } else {
      statusEl.textContent = `${otherName} hat gewonnen.`;
      if (lastStatus !== "finished") sfx.lose();
    }
    turnLineEl.textContent = "Runde vorbei";
    rematchBtn.classList.remove("hidden");
  } else {
    turnLineEl.textContent = room.turn === myUid ? "🎯 Du bist dran!" : `${otherName} ist dran...`;
    statusEl.textContent = room.turn === myUid ? "Auf eine Spalte klicken, um einzuwerfen." : "Warte auf den Zug...";
    rematchBtn.classList.add("hidden");
  }
  lastStatus = room.status;
}

async function playMove(col) {
  const room = currentRoom;
  if (room.status !== "active" || room.turn !== myUid) return;
  const row = lowestEmptyRow(room.board, col);
  if (row === -1) return; // Spalte voll
  const mySymbol = room.symbols[myUid];
  const newBoard = [...room.board];
  newBoard[idx(row, col)] = mySymbol;
  const result = checkWinner(newBoard);
  const otherUid = room.players.find(p => p !== myUid);

  const update = { board: newBoard, turn: otherUid };
  if (result) {
    update.status = "finished";
    update.winner = result;
  }
  await updateDoc(roomRef, update);
  if (result) {
    const winnerUid = result === "draw" ? "draw" : (result === mySymbol ? myUid : otherUid);
    addDoc(collection(db, "matchResults"), {
      game: "connect4", players: room.players, playerNames: room.playerNames,
      winner: winnerUid, at: serverTimestamp()
    }).catch(() => {});
  }
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    board: Array(COLS * ROWS).fill(null),
    status: "active",
    winner: null,
    turn: currentRoom.players[Math.random() < 0.5 ? 0 : 1]
  });
});

leaveBtn.addEventListener("click", () => {
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
