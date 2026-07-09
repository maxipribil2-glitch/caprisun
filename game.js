// MAP — Tic-Tac-Toe room, synced live via Firestore so both players see the same board
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import { initMatch } from "./match.js";
import { awardGameReward } from "./gamocoin.js";
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
const isSpectator = params.get("spectate") === "1";

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

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }
  myUid = user.uid;
  const userName = user.displayName || user.email || "Spieler";
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) {
    initMatch({
      roomRef, myUid, myName: userName,
      onRematch: async (room) => {
        await updateDoc(roomRef, {
          board: Array(9).fill(null), status: "active", winner: null,
          rematchRequest: null, chat: [],
          turn: room.players[Math.random() < 0.5 ? 0 : 1]
        });
      }
    });
  }
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Dieser Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    render();
  });
});

function render() {
  const room = currentRoom;
  maybeShowReaction(room);
  const mySymbol = isSpectator ? null : room.symbols[myUid];
  const otherUid = room.players.find(p => p !== myUid);
  const otherName = room.playerNames[otherUid] || "Gegner";
  if (isSpectator) {
    const [p1, p2] = room.players;
    namesEl.textContent = `👁️ Zuschauen: ${room.playerNames[p1]||"?"} (X) vs ${room.playerNames[p2]||"?"} (O)`;
  } else {
    namesEl.textContent = `${room.playerNames[myUid]} (${mySymbol}) vs ${otherName} (${room.symbols[otherUid]})`;
  }

  const fillCount = room.board.filter(c => c).length;
  if (fillCount > lastBoardFill && room.status !== "finished") sfx.move();
  lastBoardFill = fillCount;

  boardEl.innerHTML = "";
  room.board.forEach((cell, i) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.textContent = cell || "";
    btn.disabled = !!cell || room.status !== "active" || room.turn !== myUid || isSpectator;
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
    const replayBtn = document.getElementById("replay-btn");
    if (replayBtn && (room.moveHistory || []).length > 0) replayBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = room.turn === myUid ? "Du bist dran." : `${otherName} ist dran...`;
    rematchBtn.classList.add("hidden");
  }
  lastStatus = room.status;
}

async function playMove(i) {
  const room = currentRoom;
  if (room.board[i] || room.status !== "active" || room.turn !== myUid || isSpectator) return;
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
  // Zug-History für Replay aufzeichnen (max 9 Züge bei TTT)
  const moveHistory = currentRoom.moveHistory || [];
  update.moveHistory = [...moveHistory, { uid: myUid, cell: i, board: [...newBoard], ts: Date.now() }];
  await updateDoc(roomRef, update);
  if (result) {
    const winnerUid = result === "draw" ? "draw" : (result === mySymbol ? myUid : otherUid);
    addDoc(collection(db, "matchResults"), {
      game: "tictactoe", players: room.players, playerNames: room.playerNames,
      winner: winnerUid, at: serverTimestamp()
    }).catch(() => {});
    if (winnerUid === myUid) awardGameReward(myUid, 100, "tictactoe_win").catch(() => {});
  }
}

leaveBtn.addEventListener("click", async () => {
  // MAP FIX (Deep Check): vorher wurde beim Verlassen NUR redirected, ohne dem
  // Gegner den Sieg zu werten. Der Gegner blieb dann für immer in nem "wartenden"
  // Match hängen, ohne matchResults-Eintrag, ohne Sieg-Coins, nix. Jetzt konsistent
  // mit allen anderen 1v1-Games: Verlassen = Aufgabe = Gegner gewinnt automatisch.
  if (currentRoom?.status === "active" && !isSpectator) {
    const oppUid = currentRoom.players.find(p => p !== myUid);
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      await addDoc(collection(db, "matchResults"), {
        game: "tictactoe", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: oppUid, at: serverTimestamp()
      });
    } catch (e) {}
  }
  window.location.href = "lobby.html";
});

// ── Match-Replay ──
window.startReplay = function() {
  const history = currentRoom?.moveHistory;
  if (!history || !history.length) return;
  const boardEl = document.getElementById("board");
  let step = 0;
  // Show empty board
  renderReplayStep(Array(9).fill(null), currentRoom.symbols);
  const interval = setInterval(() => {
    if (step >= history.length) { clearInterval(interval); sfx.win(); return; }
    const { board } = history[step];
    renderReplayStep(board, currentRoom.symbols);
    sfx.move();
    step++;
  }, 700);
};

function renderReplayStep(board, symbols) {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = board.map((cell, i) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.textContent = cell || "";
    btn.disabled = true;
    return `<button class="cell" disabled>${cell || ""}</button>`;
  }).join("");
}

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
