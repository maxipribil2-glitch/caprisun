// MAP — Dame (Checkers). 8x8, diagonale Züge, Pflicht-Schlagen wenn möglich, Dame
// (King) bei Erreichen der Grundlinie. Sieg = Gegner hat 0 Steine mehr ODER kann
// nicht mehr ziehen (vereinfacht: wir checken nur "0 Steine übrig" für den Scope hier).
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
const boardEl = document.getElementById("checkers-board");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

function startingBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r+c)%2===1) board[r][c] = { color: "b", king: false };
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r+c)%2===1) board[r][c] = { color: "w", king: false };
  return board;
}

let myUid, roomRef, currentRoom, selected = null, legalTargets = [];

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.board) initIfHost();
    maybeShowReaction(currentRoom);
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function myColor() { return isSpectator ? null : currentRoom.colors?.[myUid]; }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myColor(); }

async function initIfHost() {
  if (!isHost() || isSpectator) return;
  const white = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const black = currentRoom.players.find(p => p !== white);
  await updateDoc(roomRef, { board: startingBoard(), turn: "w", colors: { [white]:"w", [black]:"b" } }).catch(()=>{});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = isSpectator
    ? `👀 ${room.playerNames[room.players[0]]} vs ${room.playerNames[room.players[1]]}`
    : `${room.playerNames[myUid]} (${myColor()==="w"?"Weiß":"Schwarz"}) vs ${room.playerNames[oppUid]||"Gegner"}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = isSpectator ? `${room.playerNames[room.winner]||"Jemand"} hat gewonnen!` : (room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.");
    renderBoard(true);
    return;
  }
  rematchBtn.classList.add("hidden");
  if (!room.board) { statusEl.textContent = "Brett wird aufgebaut..."; return; }
  statusEl.textContent = isSpectator ? (room.turn==="w"?"Weiß ist am Zug...":"Schwarz ist am Zug...") : (isMyTurn() ? "🎯 Du bist dran!" : "Warte auf den Gegner...");
  renderBoard(false);
}

function renderBoard(locked) {
  boardEl.innerHTML = "";
  const board = currentRoom.board;
  const flip = !isSpectator && myColor() === "b";
  for (let vr=0; vr<8; vr++) for (let vc=0; vc<8; vc++) {
    const r = flip ? 7-vr : vr, c = flip ? 7-vc : vc;
    const piece = board[r][c];
    const cell = document.createElement("div");
    cell.className = "checkers-cell " + ((r+c)%2===0 ? "light" : "dark");
    if (selected && selected.r===r && selected.c===c) cell.classList.add("selected");
    if (legalTargets.some(t => t.r===r && t.c===c)) cell.classList.add("movable");
    if (piece) {
      const p = document.createElement("div");
      p.className = "checkers-piece " + piece.color + (piece.king ? " king" : "");
      cell.appendChild(p);
    }
    if (!locked && !isSpectator) cell.addEventListener("click", () => onCellClick(r, c));
    boardEl.appendChild(cell);
  }
}

function getJumps(board, r, c) {
  const piece = board[r][c];
  const dirs = piece.king ? [[-1,-1],[-1,1],[1,-1],[1,1]] : (piece.color==="w" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);
  const jumps = [];
  dirs.forEach(([dr,dc]) => {
    const mr=r+dr, mc=c+dc, jr=r+dr*2, jc=c+dc*2;
    if (jr<0||jr>7||jc<0||jc>7) return;
    const mid = board[mr]?.[mc];
    if (mid && mid.color !== piece.color && !board[jr][jc]) jumps.push({ r:jr, c:jc, capture:{r:mr,c:mc} });
  });
  return jumps;
}
function getSimpleMoves(board, r, c) {
  const piece = board[r][c];
  const dirs = piece.king ? [[-1,-1],[-1,1],[1,-1],[1,1]] : (piece.color==="w" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);
  const moves = [];
  dirs.forEach(([dr,dc]) => {
    const nr=r+dr, nc=c+dc;
    if (nr>=0&&nr<8&&nc>=0&&nc<8&&!board[nr][nc]) moves.push({ r:nr, c:nc });
  });
  return moves;
}
function boardHasAnyJump(board, color) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (board[r][c]?.color===color && getJumps(board,r,c).length) return true;
  return false;
}

function onCellClick(r, c) {
  if (!isMyTurn()) return;
  const board = currentRoom.board;
  const piece = board[r][c];
  if (selected) {
    const target = legalTargets.find(t => t.r===r && t.c===c);
    if (target) { makeMove(selected, target); selected=null; legalTargets=[]; return; }
    selected=null; legalTargets=[];
  }
  if (piece && piece.color === myColor()) {
    const mustJump = boardHasAnyJump(board, myColor());
    const jumps = getJumps(board, r, c);
    if (mustJump && !jumps.length) { render(); return; } // Pflicht-Schlagen, dieser Stein kann nicht schlagen
    selected = { r, c };
    legalTargets = jumps.length ? jumps : getSimpleMoves(board, r, c);
  }
  render();
}

async function makeMove(from, to) {
  const room = currentRoom;
  const board = room.board.map(row => row.map(cell => cell ? {...cell} : null));
  const piece = board[from.r][from.c];
  board[to.r][to.c] = piece;
  board[from.r][from.c] = null;
  if (to.capture) board[to.capture.r][to.capture.c] = null;
  if ((piece.color==="w" && to.r===0) || (piece.color==="b" && to.r===7)) piece.king = true;

  sfx.move ? sfx.move() : null;
  if (to.capture) sfx.hit ? sfx.hit() : null;

  // Mehrfach-Schlagen: falls von der neuen Position noch ein Schlag möglich ist, gleicher Spieler bleibt dran
  const furtherJumps = to.capture ? getJumps(board, to.r, to.c) : [];
  const oppColor = piece.color === "w" ? "b" : "w";
  const oppCount = board.flat().filter(p => p?.color === oppColor).length;
  const finished = oppCount === 0;

  try {
    if (finished) {
      sfx.win ? sfx.win() : null;
      await updateDoc(roomRef, { board, status: "finished", winner: myUid });
      addDoc(collection(db, "matchResults"), { game: "checkers", players: room.players, playerNames: room.playerNames, winner: myUid, at: serverTimestamp() }).catch(()=>{});
      awardGameReward(myUid, 100, "checkers_win").catch(()=>{});
    } else if (furtherJumps.length) {
      await updateDoc(roomRef, { board }); // gleicher turn bleibt, Client muss weiterschlagen
    } else {
      await updateDoc(roomRef, { board, turn: oppColor });
    }
  } catch(e) {}
}

rematchBtn.addEventListener("click", async () => {
  const white = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const black = currentRoom.players.find(p => p !== white);
  await updateDoc(roomRef, { status: "active", winner: null, board: startingBoard(), turn: "w", colors: { [white]:"w", [black]:"b" } });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "checkers", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
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
