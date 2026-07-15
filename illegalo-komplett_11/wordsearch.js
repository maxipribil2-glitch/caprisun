// MAP — Wortsuche. 10x10-Grid, 8 versteckte Wörter (horizontal/vertikal/diagonal),
// 90s Zeit, Coins nach gefundenen Wörtern.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const GRID_SIZE = 10;
const WORD_POOL = ["ILLEGALO","PIZZA","BURGER","ZOCKEN","COINS","SPIN","ROULETTE","SCHACH","SNAKE","BONUS","LEVEL","SCORE","TIMER","DEALER","BANDIT","MAXI"];

const gridEl = document.getElementById("letter-grid");
const wordListEl = document.getElementById("word-list");
const timerEl = document.getElementById("timer");
const foundCountEl = document.getElementById("found-count");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, grid, words, foundWords, timeLeft, timerInterval, started, ended;
let isDragging = false, dragStart = null, dragCells = [];

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function pickWords() {
  const shuffled = [...WORD_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 8).filter(w => w.length <= GRID_SIZE);
}

const DIRECTIONS = [
  { dr: 0, dc: 1 },   // horizontal
  { dr: 1, dc: 0 },   // vertikal
  { dr: 1, dc: 1 },   // diagonal runter-rechts
  { dr: 1, dc: -1 },  // diagonal runter-links
];

function buildGrid() {
  grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  words = [];
  const placedWords = pickWords();

  for (const word of placedWords) {
    let placed = false;
    for (let attempt = 0; attempt < 60 && !placed; attempt++) {
      const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      const maxRow = dir.dr >= 0 ? GRID_SIZE - (dir.dr ? word.length : 1) : GRID_SIZE - 1;
      const minRow = dir.dr < 0 ? word.length - 1 : 0;
      const row = minRow + Math.floor(Math.random() * (maxRow - minRow + 1));
      const maxCol = dir.dc >= 0 ? GRID_SIZE - (dir.dc ? word.length : 1) : GRID_SIZE - 1;
      const minCol = dir.dc < 0 ? word.length - 1 : 0;
      const col = minCol + Math.floor(Math.random() * (maxCol - minCol + 1));

      let fits = true;
      const cells = [];
      for (let i = 0; i < word.length; i++) {
        const r = row + dir.dr * i, c = col + dir.dc * i;
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) { fits = false; break; }
        if (grid[r][c] && grid[r][c] !== word[i]) { fits = false; break; }
        cells.push([r, c]);
      }
      if (fits) {
        cells.forEach(([r, c], i) => { grid[r][c] = word[i]; });
        words.push({ word, cells, found: false });
        placed = true;
      }
    }
  }

  // Restliche Zellen mit zufälligen Buchstaben auffüllen
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c]) grid[r][c] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }
}

function resetGame() {
  clearInterval(timerInterval);
  buildGrid();
  foundWords = new Set();
  timeLeft = 90; started = false; ended = false;
  timerEl.textContent = "⏱️ 90s";
  foundCountEl.textContent = `Gefunden: 0/${words.length}`;
  statusEl.textContent = "Wörter horizontal, vertikal oder diagonal verstecken sich im Grid — zieh mit der Maus/dem Finger drüber!";
  restartBtn.classList.add("hidden");
  renderGrid();
  renderWordList();
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "ws-cell";
      cell.textContent = grid[r][c];
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener("pointerdown", () => startDrag(r, c));
      cell.addEventListener("pointerenter", () => continueDrag(r, c));
      gridEl.appendChild(cell);
    }
  }
  document.addEventListener("pointerup", endDrag);
  markFoundCells();
}

function renderWordList() {
  wordListEl.innerHTML = words.map(w =>
    `<span class="ws-word${w.found ? " done" : ""}" data-word="${w.word}">${w.word}</span>`
  ).join("");
}

function cellEl(r, c) { return gridEl.children[r * GRID_SIZE + c]; }

function startDrag(r, c) {
  if (!started) { started = true; timerInterval = setInterval(tick, 1000); }
  if (ended) return;
  isDragging = true;
  dragStart = { r, c };
  dragCells = [{ r, c }];
  highlightDrag();
}

function continueDrag(r, c) {
  if (!isDragging || ended) return;
  const { r: sr, c: sc } = dragStart;
  const dr = Math.sign(r - sr), dc = Math.sign(c - sc);
  // Nur gerade Linien (horizontal/vertikal/diagonal) erlauben
  if (dr !== 0 && dc !== 0 && Math.abs(r - sr) !== Math.abs(c - sc)) return;
  const cells = [];
  const len = Math.max(Math.abs(r - sr), Math.abs(c - sc)) + 1;
  for (let i = 0; i < len; i++) cells.push({ r: sr + dr * i, c: sc + dc * i });
  dragCells = cells;
  highlightDrag();
}

function highlightDrag() {
  document.querySelectorAll(".ws-cell.selected").forEach(el => el.classList.remove("selected"));
  dragCells.forEach(({ r, c }) => cellEl(r, c)?.classList.add("selected"));
}

function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  checkSelection();
  document.querySelectorAll(".ws-cell.selected").forEach(el => el.classList.remove("selected"));
  dragCells = [];
}

function checkSelection() {
  if (dragCells.length < 2) return;
  const selectedStr = dragCells.map(({ r, c }) => grid[r][c]).join("");
  const selectedRev = selectedStr.split("").reverse().join("");
  for (const w of words) {
    if (w.found) continue;
    if (w.word === selectedStr || w.word === selectedRev) {
      // Prüfen ob die Zellen wirklich übereinstimmen (nicht nur der Text zufällig passt)
      const wordCellsSet = new Set(w.cells.map(([r, c]) => `${r},${c}`));
      const dragCellsSet = new Set(dragCells.map(({ r, c }) => `${r},${c}`));
      if (wordCellsSet.size === dragCellsSet.size && [...wordCellsSet].every(k => dragCellsSet.has(k))) {
        w.found = true;
        foundWords.add(w.word);
        sfx.hit ? sfx.hit() : null;
        foundCountEl.textContent = `Gefunden: ${foundWords.size}/${words.length}`;
        renderWordList();
        markFoundCells();
        if (foundWords.size === words.length) endGame(true);
        return;
      }
    }
  }
}

function markFoundCells() {
  words.filter(w => w.found).forEach(w => {
    w.cells.forEach(([r, c]) => cellEl(r, c)?.classList.add("found"));
  });
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  if (timeLeft <= 0) endGame(false);
}

async function endGame(allFound) {
  ended = true;
  clearInterval(timerInterval);
  const score = foundWords.size;
  statusEl.textContent = allFound ? `🎉 Alle ${words.length} Wörter gefunden!` : `Zeit um! ${score}/${words.length} gefunden.`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "wordsearch", score, at: serverTimestamp() });
  } catch (e) { console.error("[wordsearch] Score-Submit fehlgeschlagen:", e); }
  try {
    await awardGameReward(myUid, score * 60, "wordsearch_score");
    sfx.coin ? sfx.coin() : null;
  } catch (e) { console.error("[wordsearch] Coin-Vergabe fehlgeschlagen:", e); }
  loadLeaderboard();
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "wordsearch"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[wordsearch] Leaderboard-Query failed:", e);
  }
}
