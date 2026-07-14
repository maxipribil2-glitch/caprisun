// MAP — Sudoku Solo. Eigener Generator (Backtracking-Solver + zufällige Zellen
// entfernen je nach Schwierigkeit), kein externes API nötig. Coins nach Zeit+Level.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const gridEl = document.getElementById("sudoku-grid");
const padEl = document.getElementById("number-pad");
const timerEl = document.getElementById("timer");
const diffLabelEl = document.getElementById("difficulty-label");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const DIFFICULTIES = { easy: { holes: 30, label: "Leicht", mult: 1 }, medium: { holes: 45, label: "Mittel", mult: 1.6 }, hard: { holes: 55, label: "Schwer", mult: 2.4 } };
let myUid, myName, solution, puzzle, fixedCells, selectedCell, difficulty = "easy", startTime, timerInterval, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function generateSolved() {
  const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
  function valid(r, c, v) {
    for (let i = 0; i < 9; i++) if (grid[r][i] === v || grid[i][c] === v) return false;
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (grid[br+i][bc+j] === v) return false;
    return true;
  }
  function fill(pos) {
    if (pos === 81) return true;
    const r = Math.floor(pos/9), c = pos%9;
    const nums = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
    for (const v of nums) {
      if (valid(r, c, v)) {
        grid[r][c] = v;
        if (fill(pos+1)) return true;
        grid[r][c] = 0;
      }
    }
    return false;
  }
  fill(0);
  return grid;
}

function makePuzzle(solved, holes) {
  const puzzle = solved.map(row => [...row]);
  let removed = 0;
  const cells = [...Array(81).keys()].sort(() => Math.random() - 0.5);
  for (const pos of cells) {
    if (removed >= holes) break;
    const r = Math.floor(pos/9), c = pos%9;
    puzzle[r][c] = 0;
    removed++;
  }
  return puzzle;
}

function startGame() {
  clearInterval(timerInterval);
  solution = generateSolved();
  puzzle = makePuzzle(solution, DIFFICULTIES[difficulty].holes);
  fixedCells = puzzle.map(row => row.map(v => v !== 0));
  selectedCell = null; startTime = null; ended = false;
  timerEl.textContent = "⏱️ 0s"; diffLabelEl.textContent = DIFFICULTIES[difficulty].label;
  statusEl.textContent = ""; restartBtn.classList.add("hidden");
  render(); renderPad();
}

function render() {
  gridEl.innerHTML = "";
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const cell = document.createElement("div");
    cell.className = "sudoku-cell" + (fixedCells[r][c] ? " fixed" : "") + (selectedCell?.r===r && selectedCell?.c===c ? " selected" : "");
    if (r%3===0) cell.style.borderTop = "2px solid #1a1c26";
    if (c%3===0) cell.style.borderLeft = "2px solid #1a1c26";
    if (r===8) cell.style.borderBottom = "2px solid #1a1c26";
    if (c===8) cell.style.borderRight = "2px solid #1a1c26";
    const v = puzzle[r][c];
    if (v) {
      cell.textContent = v;
      if (!fixedCells[r][c] && v !== solution[r][c]) cell.classList.add("wrong");
    }
    if (!fixedCells[r][c]) cell.addEventListener("click", () => { selectedCell = { r, c }; render(); });
    gridEl.appendChild(cell);
  }
}

function renderPad() {
  padEl.innerHTML = "";
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement("button");
    btn.className = "num-btn"; btn.textContent = n;
    btn.addEventListener("click", () => placeNumber(n));
    padEl.appendChild(btn);
  }
}

function placeNumber(n) {
  if (!selectedCell || ended) return;
  if (!startTime) { startTime = Date.now(); timerInterval = setInterval(() => { timerEl.textContent = "⏱️ " + Math.floor((Date.now()-startTime)/1000) + "s"; }, 250); }
  puzzle[selectedCell.r][selectedCell.c] = n;
  sfx.move ? sfx.move() : null;
  render();
  checkComplete();
}

function checkComplete() {
  const isFull = puzzle.every(row => row.every(v => v !== 0));
  if (!isFull) return;
  const isCorrect = puzzle.every((row, r) => row.every((v, c) => v === solution[r][c]));
  if (isCorrect) finishGame();
}

async function finishGame() {
  ended = true;
  clearInterval(timerInterval);
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  statusEl.textContent = `🎉 Gelöst in ${seconds}s (${DIFFICULTIES[difficulty].label})!`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  // MAP FIX (Wiederholungsbug, gleich wie minesweeper.js/memory.js): `base` stand
  // vorher als `const` INNERHALB des ersten try-Blocks — im zweiten try-Block
  // (awardGameReward) war es dadurch außerhalb seines Scopes und JEDER Playthrough
  // warf hier ein ReferenceError, bevor Coins vergeben werden konnten.
  let base = 20;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "sudoku", score: seconds, at: serverTimestamp() });
    base = Math.max(20, 500 - seconds * 2);
  } catch (e) { console.error("[sudoku] Score-Submit fehlgeschlagen:", e); }
  try {
    await awardGameReward(myUid, Math.min(Math.round(base * DIFFICULTIES[difficulty].mult), 500), "sudoku_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {}
}

["easy","medium","hard"].forEach(key => {
  document.getElementById("difficulty-" + key).addEventListener("click", () => { difficulty = key; startGame(); });
});
restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "sudoku"), orderBy("score", "asc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}s</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
