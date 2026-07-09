// MAP — Simon Says. Farbfolge merken + nachtippen, jede Runde 1 Farbe länger.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const COLORS = ["red", "green", "blue", "yellow"];
const roundEl = document.getElementById("round");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, sequence, playerIdx, round, showingSequence, canClick;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function resetGame() {
  sequence = []; round = 0; canClick = false;
  roundEl.textContent = "Runde: 0";
  statusEl.textContent = "Tippen zum Starten";
  restartBtn.classList.add("hidden");
  document.getElementById("simon-board").addEventListener("click", startOnce, { once: true });
}

function startOnce() { nextRound(); }

async function nextRound() {
  round++;
  roundEl.textContent = "Runde: " + round;
  sequence.push(COLORS[Math.floor(Math.random() * 4)]);
  playerIdx = 0;
  canClick = false;
  statusEl.textContent = "Zuschauen...";
  await playSequence();
  canClick = true;
  statusEl.textContent = "Jetzt du!";
}

function playSequence() {
  return new Promise(resolve => {
    let i = 0;
    const interval = setInterval(() => {
      if (i >= sequence.length) { clearInterval(interval); resolve(); return; }
      flashPad(sequence[i]);
      i++;
    }, 600);
  });
}

function flashPad(color) {
  const pad = document.querySelector(`.simon-pad[data-color="${color}"]`);
  pad.classList.add("active");
  sfx.move ? sfx.move() : null;
  setTimeout(() => pad.classList.remove("active"), 350);
}

document.querySelectorAll(".simon-pad").forEach(pad => {
  pad.addEventListener("click", () => {
    if (!canClick) return;
    const color = pad.dataset.color;
    flashPad(color);
    if (color !== sequence[playerIdx]) { return failGame(); }
    playerIdx++;
    if (playerIdx >= sequence.length) {
      canClick = false;
      setTimeout(nextRound, 700);
    }
  });
});

async function failGame() {
  canClick = false;
  const score = round - 1;
  statusEl.textContent = `Falsch! Du bist bei Runde ${round} gescheitert. Score: ${score}`;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    if (score > 0) {
      await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "simon", score, at: serverTimestamp() });
      await awardGameReward(myUid, Math.min(score * 40, 500), "simon_score");
    }
    loadLeaderboard();
  } catch (e) {}
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "simon"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1, myBest = 0;
    snap.forEach(d => { const s = d.data(); if (s.uid === myUid) myBest = Math.max(myBest, s.score); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
    if (myBest) bestEl.textContent = "Dein Best: " + myBest;
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
