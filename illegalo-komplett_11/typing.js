// MAP — Speed-Typing. 30s, WPM = Wörter pro Minute, Coins nach WPM+Genauigkeit.
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const TEXTS = [
  "Der schnelle braune Fuchs springt ueber den faulen Hund im Garten hinter dem Haus.",
  "Illegalo ist das beste Gamecenter das jemals von Freunden gemeinsam gebaut wurde.",
  "Manche Spiele brauchen schnelle Finger und ein gutes Auge fuer Details im Alltag.",
  "Ohne Fleiss keinen Preis, sagt man oft, wenn man ein neues Spiel lernen moechte."
];
const textEl = document.getElementById("text-display");
const timerEl = document.getElementById("timer");
const wpmEl = document.getElementById("wpm");
const inputEl = document.getElementById("type-input");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, text, startTime, timeLeft, timerInterval, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  clearInterval(timerInterval);
  text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
  startTime = null; timeLeft = 30; ended = false;
  timerEl.textContent = "⏱️ 30s"; wpmEl.textContent = "0 WPM"; statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  inputEl.value = ""; inputEl.disabled = false;
  renderText();
  inputEl.focus();
}

function renderText() {
  const typed = inputEl.value;
  textEl.innerHTML = text.split("").map((ch, i) => {
    if (i >= typed.length) return `<span class="typed-pending">${ch}</span>`;
    return typed[i] === ch ? `<span class="typed-correct">${ch}</span>` : `<span class="typed-wrong">${ch}</span>`;
  }).join("");
}

inputEl.addEventListener("input", () => {
  if (ended) return;
  if (!startTime) {
    startTime = Date.now();
    timerInterval = setInterval(tick, 1000);
  }
  renderText();
  updateWpm();
  if (inputEl.value.length >= text.length) endGame();
});

function updateWpm() {
  if (!startTime) return;
  const minutes = (Date.now() - startTime) / 60000;
  const words = inputEl.value.trim().split(/\s+/).length;
  wpmEl.textContent = Math.round(words / Math.max(minutes, 0.01)) + " WPM";
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  updateWpm();
  if (timeLeft <= 0) endGame();
}

async function endGame() {
  if (ended) return;
  ended = true;
  clearInterval(timerInterval);
  inputEl.disabled = true;
  const correctChars = inputEl.value.split("").filter((ch, i) => ch === text[i]).length;
  const accuracy = Math.round((correctChars / Math.max(inputEl.value.length, 1)) * 100);
  const minutes = Math.max((Date.now() - (startTime || Date.now())) / 60000, 0.01);
  const words = inputEl.value.trim().split(/\s+/).filter(Boolean).length;
  const wpm = Math.round(words / minutes);
  statusEl.textContent = `Fertig! ${wpm} WPM, ${accuracy}% genau.`;
  restartBtn.classList.remove("hidden");
  sfx.win ? sfx.win() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "typing", score: wpm, at: serverTimestamp() });
    } catch (e) { console.error("[typing] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(Math.round(wpm * (accuracy/100) * 6), 500), "typing_score");
    sfx.coin ? sfx.coin() : null;
    loadLeaderboard();
  } catch (e) {}
}

restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "typing"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score} WPM</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
