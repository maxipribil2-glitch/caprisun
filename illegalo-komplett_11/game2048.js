// MAP — 2048 Solo-Arcade. 4x4 Grid, klassische Merge-Regeln, Highscore ins
// gemeinsame `scores`-Leaderboard (gleiches Schema wie snake.js/breakout.js).
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

const SIZE = 4;
const TILE_COLORS = {
  2:   ["#2d3142", "#eef1f7"], 4:    ["#3a3f58", "#eef1f7"],
  8:   ["#f59e0b", "#1a0a00"], 16:   ["#f97316", "#1a0a00"],
  32:  ["#ef4444", "#fff"],    64:   ["#dc2626", "#fff"],
  128: ["#8b5cf6", "#fff"],    256:  ["#7c3aed", "#fff"],
  512: ["#6366f1", "#fff"],    1024: ["#06b6d4", "#1a0a00"],
  2048: ["#10b981", "#0a1f14"]
};

let grid, score, myUid, myName, gameOver;

const boardEl = document.getElementById("board-2048");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
// MAP FIX (Wiederholungsbug, gleich wie flappy.js/minesweeper.js): lbEl war nur
// INNERHALB von loadLeaderboard() deklariert — submitScore()'s catch-Block referenzierte
// lbEl obwohl es dort gar nicht existierte -> ReferenceError sobald awardGameReward()
// oder loadLeaderboard() failte.
const lbEl = document.getElementById("leaderboard");

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email || "Spieler";
  loadLeaderboard();
  startGame();
});

function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function startGame() {
  grid = emptyGrid();
  score = 0;
  gameOver = false;
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  addRandomTile();
  addRandomTile();
  render();
}

function addRandomTile() {
  const empties = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (grid[r][c] === 0) empties.push([r, c]);
  if (!empties.length) return;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function render() {
  boardEl.innerHTML = "";
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c];
      const cell = document.createElement("div");
      const [bg, fg] = TILE_COLORS[v] || ["#12141c", "#12141c"];
      cell.style.cssText = `
        display:flex;align-items:center;justify-content:center;border-radius:6px;
        font-family:'Press Start 2P',monospace;font-size:${v >= 1000 ? 12 : v >= 100 ? 14 : 18}px;
        background:${bg};color:${fg};transition:.1s;
      `;
      cell.textContent = v || "";
      boardEl.appendChild(cell);
    }
  }
  scoreEl.textContent = "Score: " + score;
}

function slideRowLeft(row) {
  const vals = row.filter(v => v !== 0);
  const merged = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i < vals.length - 1 && vals[i] === vals[i + 1]) {
      const m = vals[i] * 2;
      merged.push(m);
      gained += m;
      i++;
    } else {
      merged.push(vals[i]);
    }
  }
  while (merged.length < SIZE) merged.push(0);
  return { row: merged, gained, moved: merged.some((v, i) => v !== row[i]) };
}

function rotateGridCW(g) {
  const n = emptyGrid();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      n[c][SIZE - 1 - r] = g[r][c];
  return n;
}

function move(dir) {
  if (gameOver) return;
  let rotations = { left: 0, up: 3, right: 2, down: 1 }[dir];
  let g = grid;
  for (let i = 0; i < rotations; i++) g = rotateGridCW(g);

  let moved = false, gained = 0;
  const newRows = g.map(row => {
    const res = slideRowLeft(row);
    if (res.moved) moved = true;
    gained += res.gained;
    return res.row;
  });

  let result = newRows;
  for (let i = 0; i < (4 - rotations) % 4; i++) result = rotateGridCW(result);

  if (!moved) return;
  grid = result;
  score += gained;
  if (gained > 0) sfx.hit ? sfx.hit() : null;
  addRandomTile();
  render();
  checkGameOver();
}

function canMove() {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
  return false;
}

async function checkGameOver() {
  const won = grid.some(row => row.includes(2048));
  if (won && !gameOver) {
    gameOver = true;
    statusEl.textContent = "🎉 2048 ERREICHT! Spiel läuft weiter, du Legende.";
    gameOver = false; // darf weiterspielen für höhere Scores
    await submitScore();
    return;
  }
  if (!canMove()) {
    gameOver = true;
    statusEl.textContent = "Game Over — keine Züge mehr. Score: " + score;
    restartBtn.classList.remove("hidden");
    sfx.lose ? sfx.lose() : null;
    await submitScore();
  }
}

async function submitScore() {
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "2048", score, at: serverTimestamp()
    });
    // MAP FIX (Deep Check): gleicher Bug wie flappy.js — Score wurde gespeichert,
    // aber keine Coins vergeben. 2048-Zocken hat sich bisher gar nicht gelohnt!
    } catch (e) { console.error("[2048] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(Math.round(score/20), 500), "2048_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[2048] Leaderboard-Query failed — evtl. fehlt ein Firestore Composite-Index:", e);
  }
}

async function loadLeaderboard() {
  try {
    const q = query(collection(db, "scores"), where("game", "==", "2048"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = "";
    let rank = 1;
    let myBest = 0;
    snap.forEach(d => {
      const s = d.data();
      if (s.uid === myUid) myBest = Math.max(myBest, s.score);
      const li = document.createElement("li");
      li.innerHTML = `<span>#${rank++} ${s.name || "Spieler"}</span><span>${s.score}</span>`;
      lbEl.appendChild(li);
    });
    if (myBest) bestEl.textContent = "Dein Best: " + myBest;
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
  }
}

// ── Steuerung ──
window.addEventListener("keydown", (e) => {
  const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
                a: "left", d: "right", w: "up", s: "down" };
  const dir = map[e.key];
  if (dir) { e.preventDefault(); move(dir); }
});

document.querySelectorAll(".dpad-btn").forEach(btn => {
  btn.addEventListener("click", () => move(btn.dataset.dir));
});

// ── Swipe (Touch) ──
let touchStartX = 0, touchStartY = 0;
boardEl.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
boardEl.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
  else move(dy > 0 ? "down" : "up");
}, { passive: true });

restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });
