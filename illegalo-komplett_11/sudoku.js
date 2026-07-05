// MAP — Sudoku. Feste Puzzle-Basis (selbst generiert per Digit-Shuffle), 45 Zellen
// entfernt für mittleren Schwierigkeitsgrad. Max 3 Fehler, Coins nach Zeit+Fehlern.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);

const SOLVED_BASE = [
  [5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
  [8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
  [9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,9]
];

function shuffleDigits(grid) {
  const perm = [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5);
  return grid.map(row => row.map(v => perm[v-1]));
}

function makePuzzle(removeCount) {
  const solution = shuffleDigits(SOLVED_BASE);
  const puzzle = solution.map(row => [...row]);
  let removed = 0;
  while (removed < removeCount) {
    const r = Math.floor(Math.random()*9), c = Math.floor(Math.random()*9);
    if (puzzle[r][c] !== 0) { puzzle[r][c] = 0; removed++; }
  }
  return { puzzle, solution };
}

const gridEl = document.getElementById("sudoku-grid");
const padEl = document.getElementById("number-pad");
const timerEl = document.getElementById("timer");
const mistakesEl = document.getElementById("mistakes");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, puzzle, solution, given, userGrid, selected, mistakes, startTime, timerInterval, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  clearInterval(timerInterval);
  const { puzzle: p, solution: s } = makePuzzle(45);
  puzzle = p; solution = s;
  given = p.map(row => row.map(v => v !== 0));
  userGrid = p.map(row => [...row]);
  selected = null; mistakes = 0; startTime = null; ended = false;
  mistakesEl.textContent = "❌ 0/3"; timerEl.textContent = "⏱️ 0s"; statusEl.textContent = "Zahl im Grid wählen, dann Ziffer eingeben";
  restartBtn.classList.add("hidden");
  renderGrid(); renderPad();
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
    const cell = document.createElement("div");
    let cls = "sudoku-cell";
    if (given[r][c]) cls += " given";
    if (selected && selected.r===r && selected.c===c) cls += " selected";
    if (!given[r][c] && userGrid[r][c] !== 0 && userGrid[r][c] !== solution[r][c]) cls += " wrong";
    cell.className = cls;
    cell.style.borderRight = (c+1)%3===0 && c<8 ? "2px solid #1a1c26" : "";
    cell.style.borderBottom = (r+1)%3===0 && r<8 ? "2px solid #1a1c26" : "";
    cell.textContent = userGrid[r][c] || "";
    if (!given[r][c]) cell.addEventListener("click", () => { selected = {r,c}; renderGrid(); });
    gridEl.appendChild(cell);
  }
}

function renderPad() {
  padEl.innerHTML = "";
  for (let n=1;n<=9;n++) {
    const btn = document.createElement("button");
    btn.className = "num-btn"; btn.textContent = n;
    btn.addEventListener("click", () => placeNumber(n));
    padEl.appendChild(btn);
  }
}

function placeNumber(n) {
  if (!selected || ended) return;
  if (!startTime) { startTime = Date.now(); timerInterval = setInterval(tick, 1000); }
  const { r, c } = selected;
  userGrid[r][c] = n;
  sfx.move ? sfx.move() : null;
  if (n !== solution[r][c]) {
    mistakes++;
    mistakesEl.textContent = "❌ " + mistakes + "/3";
    sfx.hit ? sfx.hit() : null;
    if (mistakes >= 3) return failGame();
  }
  renderGrid();
  checkWin();
}

function checkWin() {
  const solved = userGrid.every((row,r) => row.every((v,c) => v === solution[r][c]));
  if (solved) finishGame();
}

function tick() {
  if (!startTime) return;
  timerEl.textContent = "⏱️ " + Math.floor((Date.now()-startTime)/1000) + "s";
}

async function finishGame() {
  ended = true;
  clearInterval(timerInterval);
  const seconds = Math.floor((Date.now()-startTime)/1000);
  statusEl.textContent = `🎉 Gelöst in ${seconds}s mit ${mistakes} Fehlern!`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "sudoku", score: seconds, at: serverTimestamp() });
    await awardGameReward(myUid, Math.max(50, 500 - Math.floor(seconds/2) - mistakes*40), "sudoku_score");
    loadLeaderboard();
  } catch (e) {}
}

function failGame() {
  ended = true;
  clearInterval(timerInterval);
  statusEl.textContent = "3 Fehler erreicht — Game Over!";
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  renderGrid();
}

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
