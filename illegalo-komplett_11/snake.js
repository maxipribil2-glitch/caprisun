// MAP — classic solo Snake. Pure local game loop; only the final score gets written
// to Firestore (collection "scores") so there's a shared leaderboard across the group.
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const db = getFirestore(app);

const canvas = document.getElementById("snake-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
const leaderboardEl = document.getElementById("leaderboard");

const GRID = 18;
const CELL = canvas.width / GRID;

let myUid = null, myName = null;
let snake, dir, nextDir, food, score, alive, loopHandle;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email;
  loadLeaderboard();
  resetGame();
  startLoop();
});

const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
function isOpposite(a, b) {
  return (a === "up" && b === "down") || (a === "down" && b === "up") ||
         (a === "left" && b === "right") || (a === "right" && b === "left");
}

function resetGame() {
  snake = [{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }];
  dir = "right"; nextDir = "right";
  food = randomFood();
  score = 0; alive = true;
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  updateScore();
  draw();
}

function randomFood() {
  let p, tries = 0;
  do {
    p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    tries++;
  } while (snake.some(s => s.x === p.x && s.y === p.y) && tries < 200);
  return p;
}

function setDir(d) { if (!isOpposite(dir, d)) nextDir = d; }

window.addEventListener("keydown", e => {
  const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
                w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };
  if (map[e.key]) { e.preventDefault(); setDir(map[e.key]); }
});
document.querySelectorAll(".dpad-btn").forEach(btn => {
  btn.addEventListener("click", () => setDir(btn.dataset.dir));
});

function startLoop() {
  clearInterval(loopHandle);
  loopHandle = setInterval(step, 140);
}

function step() {
  if (!alive) return;
  dir = isOpposite(dir, nextDir) ? dir : nextDir;
  const d = DIRS[dir];
  const head = snake[0];
  const nh = { x: head.x + d.x, y: head.y + d.y };

  const eating = nh.x === food.x && nh.y === food.y;
  const bodyToCheck = eating ? snake : snake.slice(0, -1);
  const outOfBounds = nh.x < 0 || nh.x >= GRID || nh.y < 0 || nh.y >= GRID;
  const hitSelf = bodyToCheck.some(s => s.x === nh.x && s.y === nh.y);

  if (outOfBounds || hitSelf) { gameOver(); return; }

  snake.unshift(nh);
  if (eating) {
    score++;
    updateScore();
    food = randomFood();
    sfx.eat();
  } else {
    snake.pop();
  }
  draw();
}

function updateScore() { scoreEl.textContent = "Score: " + score; }

async function gameOver() {
  alive = false;
  clearInterval(loopHandle);
  statusEl.textContent = "Game Over! Score: " + score;
  restartBtn.classList.remove("hidden");
  sfx.lose();
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "snake", score, createdAt: serverTimestamp()
    });
    await awardGameReward(myUid, Math.floor(score / 2), "snake_score").catch(() => {});
  } catch (e) {}
  loadLeaderboard();
}

async function loadLeaderboard() {
  try {
    const snap = await getDocs(query(collection(db, "scores"), where("game", "==", "snake")));
    const all = snap.docs.map(d => d.data());
    const mine = all.filter(s => s.uid === myUid).map(s => s.score);
    bestEl.textContent = "Dein Best: " + (mine.length ? Math.max(...mine) : 0);
    const top = [...all].sort((a, b) => b.score - a.score).slice(0, 5);
    leaderboardEl.innerHTML = top.length
      ? top.map((s, i) => `<li><span>#${i + 1} ${s.name || "?"}</span><span>${s.score}</span></li>`).join("")
      : `<li class="empty">Noch keine Scores — sei der Erste!</li>`;
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#13151c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc((food.x + 0.5) * CELL, (food.y + 0.5) * CELL, CELL * 0.35, 0, Math.PI * 2);
  ctx.fill();
  snake.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? "#8b5cf6" : "#10b981";
    ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
  });
}

restartBtn.addEventListener("click", () => { resetGame(); startLoop(); });
leaveBtn.addEventListener("click", () => { clearInterval(loopHandle); window.location.href = "lobby.html"; });
