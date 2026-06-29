// MAP — Tic-Tac-Toe room, synced live via Firestore so both players see the same board
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

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const namesEl = document.getElementById("names");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) {
  window.location.href = "lobby.html";
}

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWinner(board) {
  for (const line of WIN_LINES) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
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
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      statusEl.textContent = "Dieser Raum existiert nicht (mehr).";
      return;
    }
    currentRoom = snap.data();
    render();
  });
});

function render() {
  const room = currentRoom;
  maybeShowReaction(room);
  const mySymbol = room.symbols[myUid];
  const otherUid = room.players.find(p => p !== myUid);
  const otherName = room.playerNames[otherUid] || "Gegner";
  namesEl.textContent = `${room.playerNames[myUid]} (${mySymbol}) vs ${otherName} (${room.symbols[otherUid]})`;

  const fillCount = room.board.filter(c => c).length;
  if (fillCount > lastBoardFill && room.status !== "finished") sfx.move();
  lastBoardFill = fillCount;

  boardEl.innerHTML = "";
  room.board.forEach((cell, i) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.textContent = cell || "";
    btn.disabled = !!cell || room.status !== "active" || room.turn !== myUid;
    btn.addEventListener("click", () => playMove(i));
    boardEl.appendChild(btn);
  });

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
    rematchBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = room.turn === myUid ? "Du bist dran." : `${otherName} ist dran...`;
    rematchBtn.classList.add("hidden");
  }
  lastStatus = room.status;
}

async function playMove(i) {
  const room = currentRoom;
  if (room.board[i] || room.status !== "active" || room.turn !== myUid) return;
  const mySymbol = room.symbols[myUid];
  const newBoard = [...room.board];
  newBoard[i] = mySymbol;
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
      game: "tictactoe", players: room.players, playerNames: room.playerNames,
      winner: winnerUid, at: serverTimestamp()
    }).catch(() => {});
  }
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    board: Array(9).fill(null),
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
