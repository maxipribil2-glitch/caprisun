// MAP — Tic-Tac-Toe room, synced live via Firestore so both players see the same board
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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
  const mySymbol = room.symbols[myUid];
  const otherUid = room.players.find(p => p !== myUid);
  const otherName = room.playerNames[otherUid] || "Gegner";
  namesEl.textContent = `${room.playerNames[myUid]} (${mySymbol}) vs ${otherName} (${room.symbols[otherUid]})`;

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
    } else if (room.winner === mySymbol) {
      statusEl.textContent = "DU HAST GEWONNEN 🔥";
    } else {
      statusEl.textContent = `${otherName} hat gewonnen.`;
    }
    rematchBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = room.turn === myUid ? "Du bist dran." : `${otherName} ist dran...`;
    rematchBtn.classList.add("hidden");
  }
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
}

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    board: Array(9).fill(null),
    status: "active",
    winner: null,
    turn: currentRoom.players[0]
  });
});

leaveBtn.addEventListener("click", () => {
  window.location.href = "lobby.html";
});
