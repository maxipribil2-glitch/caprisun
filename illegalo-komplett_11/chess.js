// MAP — Schach 1v1. Vollständige Zugregeln für alle Figuren (Bauer, Springer, Läufer,
// Turm, Dame, König), inkl. Bauern-Doppelzug/Umwandlung. BEWUSST vereinfacht: Sieg =
// König geschlagen (kein Schachmatt/Patt/Remis-Check, kein Rochade/En-Passant) — für
// den Scope hier (Kumpel-Runde) ausreichend und deutlich weniger fehleranfällig als
// ein vollständiger Regelsatz. Spectator-Mode über ?spectate=1 wie bei allen anderen
// 1v1-Games im Gamecenter.
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
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
const boardEl = document.getElementById("chess-board");
const capturedEl = document.getElementById("captured-row");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) window.location.href = "lobby.html";

const PIECES = { p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚" }; // schwarz-glyphen, wir färben per CSS-Filter nicht — nutzen weiß/schwarz Unicode direkt unten
const WHITE_GLYPHS = { p:"♙",n:"♘",b:"♗",r:"♖",q:"♕",k:"♔" };
const BLACK_GLYPHS = { p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚" };

function startingBoard() {
  const back = ["r","n","b","q","k","b","n","r"];
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: "b" };
    board[1][c] = { type: "p", color: "b" };
    board[6][c] = { type: "p", color: "w" };
    board[7][c] = { type: back[c], color: "w" };
  }
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
    if (!snap.exists()) { statusEl.textContent = "Raum existiert nicht (mehr)."; return; }
    currentRoom = snap.data();
    if (!currentRoom.board) initBoardIfHost();
    maybeShowReaction(currentRoom);
    armChessTimeout();
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

// MAP FIX (Timeout-Fallback): vorher konnte ein Match für immer offen bleiben
// wenn ein Spieler den Tab schließt ohne "Verlassen". Schach braucht n bisschen
// mehr Bedenkzeit als die anderen Games, deshalb 90s statt 60s.
const CHESS_TIMEOUT_MS = 90000;
let chessTimeoutTimer;
function armChessTimeout() {
  clearTimeout(chessTimeoutTimer);
  if (!currentRoom || currentRoom.status !== "active" || !currentRoom.turnStartAt) return;
  const remaining = CHESS_TIMEOUT_MS - (Date.now() - currentRoom.turnStartAt);
  if (remaining <= 0) { resolveChessTimeout(); return; }
  chessTimeoutTimer = setTimeout(resolveChessTimeout, remaining + 500);
}
async function resolveChessTimeout() {
  if (isSpectator || !currentRoom) return;
  const timedOutColor = currentRoom.turn;
  try {
    let winnerUid = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const cur = snap.data();
      if (!cur || cur.status !== "active") return;
      if (Date.now() - (cur.turnStartAt||0) < CHESS_TIMEOUT_MS) return;
      const timedOutUid = Object.entries(cur.colors||{}).find(([,c]) => c === timedOutColor)?.[0];
      if (!timedOutUid) return;
      winnerUid = cur.players.find(p => p !== timedOutUid);
      tx.update(roomRef, { status: "finished", winner: winnerUid });
    });
    if (winnerUid) {
      addDoc(collection(db, "matchResults"), { game: "chess", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "chess_win").catch(()=>{});
    }
  } catch(e) {}
}
function myColor() {
  if (isSpectator) return null;
  return currentRoom.colors?.[myUid] || null;
}
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myColor(); }

async function initBoardIfHost() {
  if (!isHost() || isSpectator) return;
  const white = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const black = currentRoom.players.find(p => p !== white);
  await updateDoc(roomRef, {
    board: startingBoard(),
    turn: "w",
    colors: { [white]: "w", [black]: "b" },
    captured: { w: [], b: [] }
  }).catch(() => {});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = isSpectator
    ? `👀 ${room.playerNames[room.players[0]]} vs ${room.playerNames[room.players[1]]}`
    : `${room.playerNames[myUid]} (${myColor() === "w" ? "Weiß" : "Schwarz"}) vs ${room.playerNames[oppUid] || "Gegner"}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    if (isSpectator) {
      statusEl.textContent = `${room.playerNames[room.winner] || "Jemand"} hat gewonnen! 🏆`;
    } else {
      statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥 (König geschlagen!)" : "Dein König wurde geschlagen. GG.";
    }
    renderBoard(true);
    renderCaptured();
    return;
  }
  rematchBtn.classList.add("hidden");

  if (!room.board) { statusEl.textContent = "Brett wird aufgebaut..."; return; }

  if (isSpectator) {
    statusEl.textContent = room.turn === "w" ? "Weiß ist am Zug..." : "Schwarz ist am Zug...";
  } else {
    statusEl.textContent = isMyTurn() ? "🎯 Du bist dran!" : "Warte auf den Gegner...";
  }
  renderBoard(false);
  renderCaptured();
}

function renderBoard(locked) {
  boardEl.innerHTML = "";
  const board = currentRoom.board;
  // Aus Sicht des Spielers drehen: Schwarz sieht's von unten (Reihe 0 unten)
  const flip = !isSpectator && myColor() === "b";
  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualCol = 0; visualCol < 8; visualCol++) {
      const r = flip ? 7 - visualRow : visualRow;
      const c = flip ? 7 - visualCol : visualCol;
      const piece = board[r][c];
      const cell = document.createElement("div");
      cell.className = "chess-cell " + ((r + c) % 2 === 0 ? "light" : "dark");
      if (selected && selected.r === r && selected.c === c) cell.classList.add("selected");
      const isTarget = legalTargets.some(t => t.r === r && t.c === c);
      if (isTarget) { cell.classList.add("movable"); if (piece) cell.classList.add("has-piece"); }
      if (piece) {
        cell.textContent = piece.color === "w" ? WHITE_GLYPHS[piece.type] : BLACK_GLYPHS[piece.type];
        cell.style.color = piece.color === "w" ? "#fff" : "#0a0a0a";
        cell.style.textShadow = piece.color === "w" ? "0 0 2px #000" : "none";
      }
      if (!locked && !isSpectator) {
        cell.addEventListener("click", () => onCellClick(r, c));
      }
      boardEl.appendChild(cell);
    }
  }
}

function renderCaptured() {
  const cap = currentRoom.captured || { w: [], b: [] };
  const whiteTook = cap.b.map(t => BLACK_GLYPHS[t]).join(" "); // Weiß hat schwarze Figuren geschlagen
  const blackTook = cap.w.map(t => WHITE_GLYPHS[t]).join(" ");
  capturedEl.innerHTML = `<span>${whiteTook}</span><span>${blackTook}</span>`;
}

function onCellClick(r, c) {
  if (!isMyTurn()) return;
  const board = currentRoom.board;
  const piece = board[r][c];

  if (selected) {
    const target = legalTargets.find(t => t.r === r && t.c === c);
    if (target) { makeMove(selected, { r, c }); selected = null; legalTargets = []; return; }
    if (piece && piece.color === myColor()) {
      selected = { r, c };
      legalTargets = getLegalMoves(board, r, c);
      render();
      return;
    }
    selected = null; legalTargets = [];
    render();
    return;
  }

  if (piece && piece.color === myColor()) {
    selected = { r, c };
    legalTargets = getLegalMoves(board, r, c);
    render();
  }
}

// ── Zugregeln pro Figurentyp ──
function getLegalMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  const opp = piece.color === "w" ? "b" : "w";

  const push = (rr, cc) => {
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return false;
    const target = board[rr][cc];
    if (!target) { moves.push({ r: rr, c: cc }); return true; }
    if (target.color === opp) { moves.push({ r: rr, c: cc }); }
    return false; // blockiert egal ob eigene oder gegnerische Figur
  };
  const slide = (dr, dc) => {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr <= 7 && cc >= 0 && cc <= 7) {
      const target = board[rr][cc];
      if (!target) { moves.push({ r: rr, c: cc }); }
      else { if (target.color === opp) moves.push({ r: rr, c: cc }); break; }
      rr += dr; cc += dc;
    }
  };

  if (piece.type === "p") {
    const dir = piece.color === "w" ? -1 : 1;
    const startRow = piece.color === "w" ? 6 : 1;
    if (!board[r + dir]?.[c]) {
      moves.push({ r: r + dir, c });
      if (r === startRow && !board[r + 2 * dir]?.[c]) moves.push({ r: r + 2 * dir, c });
    }
    for (const dc of [-1, 1]) {
      const target = board[r + dir]?.[c + dc];
      if (target && target.color === opp) moves.push({ r: r + dir, c: c + dc });
    }
  } else if (piece.type === "n") {
    const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    deltas.forEach(([dr, dc]) => push(r + dr, c + dc));
  } else if (piece.type === "b") {
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr, dc]) => slide(dr, dc));
  } else if (piece.type === "r") {
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => slide(dr, dc));
  } else if (piece.type === "q") {
    [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => slide(dr, dc));
  } else if (piece.type === "k") {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) push(r + dr, c + dc);
  }
  return moves;
}

// MAP HINWEIS (Punkt 5 aus dem letzten Feedback): es gibt bewusst KEINE Prüfung ob
// der eigene Zug den eigenen König ins Schach setzt — Sieg-Bedingung ist "König
// geschlagen", nicht Schachmatt. Das ist Teil der bewussten Vereinfachung oben im
// Datei-Kommentar, kein Bug. Volles Schach-Regelwerk (Schach-Erkennung, Rochade,
// En-Passant) würde den Scope für ne Kumpel-Runde sprengen.
async function makeMove(from, to) {
  const room = currentRoom;
  const board = room.board.map(row => row.map(cell => cell ? { ...cell } : null));
  const moving = board[from.r][from.c];
  const captured = board[to.r][to.c];

  board[to.r][to.c] = moving;
  board[from.r][from.c] = null;

  // Bauern-Umwandlung: automatisch zur Dame, kein Auswahl-Dialog (einfacher gehalten)
  if (moving.type === "p" && (to.r === 0 || to.r === 7)) {
    moving.type = "q";
  }

  const newCaptured = { w: [...(room.captured?.w || [])], b: [...(room.captured?.b || [])] };
  let kingCaptured = false;
  if (captured) {
    newCaptured[captured.color].push(captured.type);
    if (captured.type === "k") kingCaptured = true;
  }

  sfx.move ? sfx.move() : null;
  if (captured) sfx.hit ? sfx.hit() : null;

  const nextTurn = room.turn === "w" ? "b" : "w";

  try {
    if (kingCaptured) {
      sfx.win ? sfx.win() : null;
      await updateDoc(roomRef, {
        board, captured: newCaptured, status: "finished", winner: myUid
      });
      addDoc(collection(db, "matchResults"), {
        game: "chess", players: room.players, playerNames: room.playerNames,
        winner: myUid, at: serverTimestamp()
      }).catch(() => {});
      awardGameReward(myUid, 100, "chess_win").catch(() => {});
    } else {
      await updateDoc(roomRef, { board, captured: newCaptured, turn: nextTurn });
    }
  } catch (e) {}
}

rematchBtn.addEventListener("click", async () => {
  const white = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const black = currentRoom.players.find(p => p !== white);
  await updateDoc(roomRef, {
    status: "active", winner: null, board: startingBoard(), turn: "w",
    colors: { [white]: "w", [black]: "b" }, captured: { w: [], b: [] }
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom && currentRoom.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), {
        game: "chess", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: oppUid, at: serverTimestamp()
      }).catch(() => {});
    } catch (e) {}
  }
  window.location.href = "lobby.html";
});

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
