// MAP — Memory (Kartenpaare). 8 Paare, 4x4-Grid, Emoji-Motive. Coins skalieren
// invers zur Zug-/Zeitanzahl (weniger = mehr), hard-gecappt bei 500.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const EMOJIS = ["🐍","🎮","🎰","🏆","👑","🔥","💎","⚡"];
const gridEl = document.getElementById("memory-grid");
const timerEl = document.getElementById("timer");
const movesEl = document.getElementById("moves");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, cards, flipped, matched, moves, startTime, timerInterval, locked;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  clearInterval(timerInterval);
  cards = [...EMOJIS, ...EMOJIS].sort(() => Math.random() - 0.5);
  flipped = []; matched = new Set(); moves = 0; startTime = null; locked = false;
  timerEl.textContent = "⏱️ 0s"; movesEl.textContent = "🔄 0 Züge"; statusEl.textContent = "";
  render();
}

function render() {
  gridEl.innerHTML = "";
  cards.forEach((emoji, i) => {
    const card = document.createElement("div");
    const isFlipped = flipped.includes(i) || matched.has(i);
    card.className = "mem-card" + (isFlipped ? " flipped" : "") + (matched.has(i) ? " matched" : "");
    card.textContent = isFlipped ? emoji : "❓";
    card.addEventListener("click", () => flipCard(i));
    gridEl.appendChild(card);
  });
}

function flipCard(i) {
  if (locked || flipped.includes(i) || matched.has(i)) return;
  if (!startTime) {
    startTime = Date.now();
    timerInterval = setInterval(() => { timerEl.textContent = "⏱️ " + Math.floor((Date.now()-startTime)/1000) + "s"; }, 250);
  }
  flipped.push(i);
  render();
  if (flipped.length === 2) {
    moves++; movesEl.textContent = "🔄 " + moves + " Züge";
    locked = true;
    if (cards[flipped[0]] === cards[flipped[1]]) {
      matched.add(flipped[0]); matched.add(flipped[1]);
      sfx.hit ? sfx.hit() : null;
      flipped = []; locked = false; render();
      if (matched.size === cards.length) finishGame();
    } else {
      setTimeout(() => { flipped = []; locked = false; render(); }, 700);
    }
  }
}

async function finishGame() {
  clearInterval(timerInterval);
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  statusEl.textContent = `🎉 Geschafft in ${moves} Zügen, ${seconds}s!`;
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "memory", score: moves, at: serverTimestamp() });
    const coinAmount = Math.max(20, Math.round(500 - (moves - 8) * 25));
    await awardGameReward(myUid, coinAmount, "memory_score");
    loadLeaderboard();
  } catch (e) {}
}

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "memory"), orderBy("score", "asc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score} Züge</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}

restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });
