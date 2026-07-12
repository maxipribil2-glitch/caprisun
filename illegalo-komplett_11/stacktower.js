// MAP — Stack Tower. Blöcke fahren horizontal hin/her, Tap stoppt & platziert.
// Überstand wird abgeschnitten. Score = Anzahl gestapelter Blöcke.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const canvas = document.getElementById("stack-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

const BLOCK_H = 24;
let myUid, myName, blocks, current, score, running, started, rafHandle, camY;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame(); draw();
});

function resetGame() {
  blocks = [{ x: 70, w: 200, y: canvas.height - BLOCK_H }];
  score = 0; running = false; started = false; camY = 0;
  scoreEl.textContent = "Höhe: 0";
  statusEl.textContent = "Tippen zum Starten & jeden Block platzieren";
  restartBtn.classList.add("hidden");
  spawnNext();
  cancelAnimationFrame(rafHandle);
}

function spawnNext() {
  const last = blocks[blocks.length - 1];
  const dir = Math.random() < 0.5 ? -1 : 1;
  current = { x: dir < 0 ? canvas.width : -last.w, w: last.w, y: last.y - BLOCK_H, dir, speed: 2.4 + score * 0.08 };
}

function tap() {
  if (!started) { started = true; running = true; loop(); return; }
  if (!running) return;
  placeBlock();
}

function loop() {
  if (!running) return;
  update(); draw();
  rafHandle = requestAnimationFrame(loop);
}

function update() {
  current.x += current.dir * current.speed;
}

function placeBlock() {
  const last = blocks[blocks.length - 1];
  const overlapStart = Math.max(current.x, last.x);
  const overlapEnd = Math.min(current.x + current.w, last.x + last.w);
  const overlapW = overlapEnd - overlapStart;

  if (overlapW <= 4) { return gameOver(); }

  blocks.push({ x: overlapStart, w: overlapW, y: current.y });
  score++;
  scoreEl.textContent = "Höhe: " + score;
  sfx.hit ? sfx.hit() : null;
  if (score > 6) camY += BLOCK_H; // Kamera folgt nach oben ab Höhe 7
  spawnNext();
}

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = "Turm eingestürzt — Höhe: " + score;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "stacktower", score, at: serverTimestamp() });
    } catch (e) { console.error("[stacktower] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(score * 8, 500), "stacktower_score");
    loadLeaderboard();
  } catch (e) {}
}

function draw() {
  ctx.fillStyle = "#0c1420";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  blocks.forEach((b, i) => {
    ctx.fillStyle = i % 2 === 0 ? "#f59e0b" : "#fb923c";
    ctx.fillRect(b.x, b.y + camY, b.w, BLOCK_H - 1);
  });
  if (current) {
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(current.x, current.y + camY, current.w, BLOCK_H - 1);
  }
}

canvas.addEventListener("pointerdown", tap);
window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); tap(); } });
restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "stacktower"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1, myBest = 0;
    snap.forEach(d => { const s = d.data(); if (s.uid === myUid) myBest = Math.max(myBest, s.score); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
    if (myBest) bestEl.textContent = "Dein Best: " + myBest;
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
