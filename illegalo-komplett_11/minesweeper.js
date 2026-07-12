// MAP — Minesweeper Solo-Arcade. Klassisches 9x9/10-Minen. Score = Zeit bis geräumt,
// Coin-Reward umgekehrt proportional zur Zeit (schneller = mehr Coins, hard-gecappt
// bei 500 durch awardGameReward selbst).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const db = getFirestore(app);

const SIZE = 9, MINES = 10;
const gridEl = document.getElementById("ms-grid");
const timerEl = document.getElementById("timer");
const minesLeftEl = document.getElementById("mines-left");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
// MAP FIX (Wiederholungsbug, gleich wie flappy.js/game2048.js): lbEl war nur INNERHALB
// von loadLeaderboard() deklariert — submitResult()'s catch-Block referenzierte lbEl
// obwohl es dort gar nicht existierte -> ReferenceError sobald awardGameReward() failte.
const lbEl = document.getElementById("leaderboard");

renderShopAd("shop-ad");

let myUid, myName, board, started, ended, startTime, timerInterval, flagsUsed;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email || "Spieler";
  loadLeaderboard();
  startGame();
});

function startGame() {
  clearInterval(timerInterval);
  started = false; ended = false; flagsUsed = 0; startTime = null;
  timerEl.textContent = "⏱️ 0s";
  minesLeftEl.textContent = "💣 " + MINES;
  statusEl.textContent = "Linksklick/Tap = aufdecken, Rechtsklick/Long-Press = Flagge";

  board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({
    mine: false, revealed: false, flagged: false, count: 0
  })));

  let placed = 0;
  while (placed < MINES) {
    const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
    if (!board[r][c].mine) { board[r][c].mine = true; placed++; }
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c].mine) continue;
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r+dr, cc = c+dc;
      if (rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && board[rr][cc].mine) count++;
    }
    board[r][c].count = count;
  }
  render();
}

function render() {
  gridEl.innerHTML = "";
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const cell = board[r][c];
    const div = document.createElement("div");
    div.className = "ms-cell" + (cell.revealed ? " revealed" : "") + (cell.flagged ? " flag" : "") + (cell.revealed && cell.mine ? " mine" : "");
    if (cell.revealed && !cell.mine && cell.count > 0) {
      div.textContent = cell.count;
      div.style.color = ["", "#60a5fa","#4ade80","#f87171","#c084fc","#fb923c","#22d3ee","#fff","#94a3b8"][cell.count];
    } else if (cell.revealed && cell.mine) {
      div.textContent = "💣";
    } else if (cell.flagged) {
      div.textContent = "🚩";
    }
    div.addEventListener("click", () => reveal(r, c));
    div.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleFlag(r, c); });
    let pressTimer;
    div.addEventListener("touchstart", () => { pressTimer = setTimeout(() => toggleFlag(r, c), 450); });
    div.addEventListener("touchend", () => clearTimeout(pressTimer));
    gridEl.appendChild(div);
  }
}

function toggleFlag(r, c) {
  if (ended || board[r][c].revealed) return;
  board[r][c].flagged = !board[r][c].flagged;
  flagsUsed += board[r][c].flagged ? 1 : -1;
  minesLeftEl.textContent = "💣 " + (MINES - flagsUsed);
  render();
}

function reveal(r, c) {
  if (ended || board[r][c].flagged || board[r][c].revealed) return;
  if (!started) {
    started = true;
    startTime = Date.now();
    timerInterval = setInterval(() => {
      timerEl.textContent = "⏱️ " + Math.floor((Date.now() - startTime) / 1000) + "s";
    }, 250);
  }
  floodReveal(r, c);
  render();
  checkWinLoss();
}

function floodReveal(r, c) {
  if (r<0||r>=SIZE||c<0||c>=SIZE) return;
  const cell = board[r][c];
  if (cell.revealed || cell.flagged) return;
  cell.revealed = true;
  if (cell.mine) { triggerLoss(); return; }
  if (cell.count === 0) {
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (dr||dc) floodReveal(r+dr, c+dc);
  }
}

function triggerLoss() {
  ended = true;
  clearInterval(timerInterval);
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (board[r][c].mine) board[r][c].revealed = true;
  statusEl.textContent = "💥 BOOM! Mine getroffen — nochmal!";
  sfx.lose ? sfx.lose() : null;
}

function checkWinLoss() {
  if (ended) return;
  const allSafeRevealed = board.every(row => row.every(cell => cell.mine || cell.revealed));
  if (allSafeRevealed) {
    ended = true;
    clearInterval(timerInterval);
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    statusEl.textContent = `🎉 Geräumt in ${seconds}s!`;
    sfx.win ? sfx.win() : null;
    submitResult(seconds);
  }
}

async function submitResult(seconds) {
  // MAP FIX (Bug): coinAmount stand vorher als `const` INNERHALB des ersten try-Blocks —
  // im zweiten try-Block (awardGameReward-Call) war es dadurch außerhalb seines Scopes
  // und JEDER Spieldurchlauf (nicht nur Fehlerfälle!) warf hier ein ReferenceError, bevor
  // Coins vergeben oder das Leaderboard neu geladen werden konnten. Jetzt vor beiden
  // try-Blöcken mit `let` deklariert, damit beide Zugriff drauf haben.
  let coinAmount = 20;
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "minesweeper", score: seconds, at: serverTimestamp()
    });
    // Coins: je schneller desto mehr. 500 Coins bei <=30s, linear runter, min 20 Coins.
    coinAmount = Math.max(20, Math.round(500 - (seconds - 30) * 4));
  } catch (e) { console.error("[minesweeper] Score-Submit fehlgeschlagen:", e); }
  try {
    await awardGameReward(myUid, coinAmount, "minesweeper_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[minesweeper] Leaderboard-Query failed — evtl. fehlt ein Firestore Composite-Index:", e);
  }
}

async function loadLeaderboard() {
  try {
    const q = query(collection(db, "scores"), where("game", "==", "minesweeper"), orderBy("score", "asc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = "";
    let rank = 1;
    snap.forEach(d => {
      const s = d.data();
      const li = document.createElement("li");
      li.innerHTML = `<span>#${rank++} ${s.name || "Spieler"}</span><span>${s.score}s</span>`;
      lbEl.appendChild(li);
    });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
  }
}

restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });
