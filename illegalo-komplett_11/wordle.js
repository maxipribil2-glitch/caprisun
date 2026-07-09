// MAP — Wörterrätsel (Wordle-Klon). 6 Versuche, 5-Buchstaben-Wörter, eigene kleine
// Wortliste (selbst zusammengestellt). Coins nach Anzahl gebrauchter Versuche.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const WORDS = ["HAUSE","BAEUM","STEIN","WOLKE","FEUER","WASSR","BLUME","MOTOR","TIGER","APFEL","NUDEL","SCHAL","KATZE","PILOT","MUSIK"].map(w=>w.replace("BAEUM","BAUME").replace("WASSR","WASER"));
// Hinweis: bewusst einfache Eigenwortliste ohne Umlaute (ASCII-only), Umlaute in
// Original-Begriffen sind hier neutralisiert damit Input-Vergleich simpel bleibt.

const gridEl = document.getElementById("wordle-grid");
const inputEl = document.getElementById("word-input");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, target, guesses, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  target = WORDS[Math.floor(Math.random() * WORDS.length)];
  guesses = []; ended = false;
  statusEl.textContent = ""; restartBtn.classList.add("hidden");
  inputEl.disabled = false; submitBtn.disabled = false; inputEl.value = "";
  render();
}

function render() {
  gridEl.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const row = document.createElement("div");
    row.className = "wordle-row";
    const guess = guesses[i];
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement("div");
      cell.className = "wordle-cell";
      if (guess) {
        cell.textContent = guess.word[c];
        cell.classList.add(guess.result[c]);
      }
      row.appendChild(cell);
    }
    gridEl.appendChild(row);
  }
}

function evaluateGuess(word) {
  const result = Array(5).fill("absent");
  const targetChars = target.split("");
  const used = Array(5).fill(false);
  for (let i = 0; i < 5; i++) {
    if (word[i] === target[i]) { result[i] = "correct"; used[i] = true; }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === "correct") continue;
    const idx = targetChars.findIndex((ch, j) => ch === word[i] && !used[j]);
    if (idx !== -1) { result[i] = "present"; used[idx] = true; }
  }
  return result;
}

async function submitGuess() {
  if (ended) return;
  const word = inputEl.value.trim().toUpperCase();
  if (word.length !== 5) { statusEl.textContent = "Genau 5 Buchstaben bitte."; return; }
  const result = evaluateGuess(word);
  guesses.push({ word, result });
  inputEl.value = "";
  render();
  sfx.move ? sfx.move() : null;

  if (word === target) {
    ended = true;
    statusEl.textContent = `🎉 Richtig in ${guesses.length} Versuchen!`;
    sfx.win ? sfx.win() : null;
    await finishGame(guesses.length);
  } else if (guesses.length >= 6) {
    ended = true;
    statusEl.textContent = `Verloren — das Wort war: ${target}`;
    sfx.lose ? sfx.lose() : null;
    await finishGame(null);
  }
  if (ended) { inputEl.disabled = true; submitBtn.disabled = true; restartBtn.classList.remove("hidden"); }
}

async function finishGame(attempts) {
  try {
    if (attempts) {
      await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "wordle", score: attempts, at: serverTimestamp() });
      await awardGameReward(myUid, Math.max(50, 500 - (attempts-1)*80), "wordle_score");
      sfx.coin ? sfx.coin() : null;
      loadLeaderboard();
    }
  } catch (e) {}
}

submitBtn.addEventListener("click", submitGuess);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess(); });
restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "wordle"), orderBy("score", "asc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score} Versuche</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
