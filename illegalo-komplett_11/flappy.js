// MAP — Flappy Bird Klon, Solo-Arcade. Ein Canvas, ein Physik-Wert (Gravity),
// Score = Anzahl passierter Röhren. Highscore ins gemeinsame `scores`-Leaderboard.
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

const canvas = document.getElementById("flappy-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
// MAP FIX (Wiederholungsbug): lbEl war nur INNERHALB von loadLeaderboard() deklariert
// (const, block-scoped) — gameOver()'s catch-Block hat lbEl referenziert obwohl es dort
// gar nicht existierte -> ReferenceError, sobald awardGameReward() failte. Jetzt einmal
// auf Modul-Ebene geholt, so wie alle anderen DOM-Refs hier oben.
const lbEl = document.getElementById("leaderboard");

renderShopAd("shop-ad");

const GRAVITY = 0.45;
const FLAP_VY = -7.5;
const PIPE_W = 56;
const PIPE_GAP = 140;
const PIPE_SPEED = 2.6;
const PIPE_SPACING = 190;
const BIRD_X = 90, BIRD_R = 14;

let myUid, myName;
let bird, pipes, score, running, started, rafHandle;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email || "Spieler";
  loadLeaderboard();
  resetGame();
  draw();
});

function resetGame() {
  bird = { y: canvas.height / 2, vy: 0 };
  pipes = [];
  score = 0;
  running = false;
  started = false;
  scoreEl.textContent = "Score: 0";
  statusEl.textContent = "Tippen / Klicken / Leertaste zum Starten & Fliegen";
  restartBtn.classList.add("hidden");
  cancelAnimationFrame(rafHandle);
}

function spawnPipe(x) {
  const margin = 50;
  const gapY = margin + Math.random() * (canvas.height - PIPE_GAP - margin * 2);
  pipes.push({ x, gapY, passed: false });
}

function flap() {
  if (!started) {
    started = true;
    running = true;
    for (let i = 0; i < 3; i++) spawnPipe(canvas.width + i * PIPE_SPACING);
    loop();
  }
  if (!running) return;
  bird.vy = FLAP_VY;
  sfx.move ? sfx.move() : null;
}

function loop() {
  if (!running) return;
  update();
  draw();
  rafHandle = requestAnimationFrame(loop);
}

function update() {
  bird.vy += GRAVITY;
  bird.y += bird.vy;

  pipes.forEach(p => { p.x -= PIPE_SPEED; });
  if (pipes.length && pipes[0].x < -PIPE_W) {
    pipes.shift();
    spawnPipe(pipes[pipes.length - 1].x + PIPE_SPACING);
  }

  pipes.forEach(p => {
    if (!p.passed && p.x + PIPE_W < BIRD_X) {
      p.passed = true;
      score++;
      scoreEl.textContent = "Score: " + score;
      sfx.hit ? sfx.hit() : null;
    }
  });

  // Collision: floor/ceiling
  if (bird.y - BIRD_R < 0 || bird.y + BIRD_R > canvas.height) {
    return gameOver();
  }
  // Collision: pipes
  for (const p of pipes) {
    const withinX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
    if (withinX) {
      const hitsTop = bird.y - BIRD_R < p.gapY;
      const hitsBottom = bird.y + BIRD_R > p.gapY + PIPE_GAP;
      if (hitsTop || hitsBottom) return gameOver();
    }
  }
}

async function gameOver() {
  running = false;
  cancelAnimationFrame(rafHandle);
  statusEl.textContent = "Game Over — Score: " + score;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), {
      uid: myUid, name: myName, game: "flappy", score, at: serverTimestamp()
    });
    // MAP FIX (Deep Check): flappy.js schrieb den Score, hat aber NIE Coins vergeben —
    // einziges Solo-Game wo Spielen sich für Coins gar nicht gelohnt hat!
    } catch (e) { console.error("[flappy] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(score * 20, 500), "flappy_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {
    // MAP FIX: vorher stiller catch(e){} — Leaderboard blieb für immer bei "Lade..."
    // hängen wenn die Query failte (meistens fehlender Firestore Composite-Index für
    // where()+orderBy() zusammen). Jetzt: sichtbare Fehlermeldung + Console-Hinweis.
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[flappy] Leaderboard-Query failed — evtl. fehlt ein Firestore Composite-Index (Konsole-Link im Error oben checken):", e);
  }
}

function draw() {
  ctx.fillStyle = "#0c1420";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#22c55e";
  pipes.forEach(p => {
    ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
    ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_W, canvas.height - (p.gapY + PIPE_GAP));
  });

  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(BIRD_X, bird.y, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
}

canvas.addEventListener("pointerdown", flap);
window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); flap(); } });

restartBtn.addEventListener("click", () => { resetGame(); draw(); });
leaveBtn.addEventListener("click", () => { cancelAnimationFrame(rafHandle); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  try {
    const q = query(collection(db, "scores"), where("game", "==", "flappy"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = "";
    let rank = 1, myBest = 0;
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
