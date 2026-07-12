// MAP — Anagramm-Rush. 60s Timer, 7 zufällige Buchstaben (aus nem festen Pool
// häufiger deutscher Buchstaben), bilde gültige Wörter draus. Simple Wortliste
// (selbst zusammengestellt, kein externes Wörterbuch-API nötig für den Scope hier).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const letterPools = [
  "ERSATNL", "HAUSTIE", "SCHNEER", "BILDUNG", "GARTENK", "WASSERK", "FEUERZG",
  "MONDLIC", "SONNENK", "WOLKENB"
];
// Erlaubte Wörter (Teilmengen der Buchstaben-Pools oben, 3+ Buchstaben)
const VALID_WORDS = new Set([
  "ERSATZ","STERN","ARTEN","NASE","ANSTALT","LERNT","ANTEIL",
  "HAUS","STEIN","HASE","HATE","HAAR".toUpperCase(),"TIER","HAI","EIS","REIS","SEHT","TEE","SEE",
  "SCHNEE","REH","CHEER".toUpperCase(),"NEHEs".toUpperCase(),"NESE".toUpperCase(),"REN","REHE","SEHNE","SEHR",
  "BILD","BAND","GUT","LID","BUND","LINDU".toUpperCase(),"BUD".toUpperCase(),"DING","BIN","BILDUNG",
  "GARTEN","KARTE","TAKEN","ARTEN","GEKATRN".toUpperCase(),"GARN","KAGET".toUpperCase(),"GAT".toUpperCase(),
  "WASSER","KASSE","WARSE".toUpperCase(),"WARS".toUpperCase(),"ASSE","SARW".toUpperCase(),
  "FEUER","ZUG","FEZ","ZEUGE","FUER","GEZ".toUpperCase(),
  "MOND","LICH".toUpperCase(),"MILCH","MOL".toUpperCase(),"DOLCH",
  "SONNE","KNOSE".toUpperCase(),"SEK".toUpperCase(),"NONS".toUpperCase(),
  "WOLKE","KOLBEN","BOWLE","LOB","WOB".toUpperCase()
].map(w => w.toUpperCase()));

const letterEl = document.getElementById("letters-display");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const inputEl = document.getElementById("word-input");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, letters, foundWords, timeLeft, timerInterval;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); startGame();
});

function startGame() {
  clearInterval(timerInterval);
  letters = letterPools[Math.floor(Math.random() * letterPools.length)];
  letterEl.textContent = letters.split("").join(" ");
  foundWords = new Set();
  timeLeft = 60;
  timerEl.textContent = "⏱️ 60s";
  scoreEl.textContent = "Wörter: 0";
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  inputEl.value = ""; inputEl.disabled = false; submitBtn.disabled = false;
  timerInterval = setInterval(tick, 1000);
}

function tick() {
  timeLeft--;
  timerEl.textContent = "⏱️ " + timeLeft + "s";
  if (timeLeft <= 0) endGame();
}

function canBuildFromLetters(word) {
  const pool = letters.split("");
  for (const ch of word) {
    const idx = pool.indexOf(ch);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

function submitWord() {
  const word = inputEl.value.trim().toUpperCase();
  inputEl.value = "";
  if (!word || word.length < 3) { statusEl.textContent = "Mind. 3 Buchstaben."; return; }
  if (foundWords.has(word)) { statusEl.textContent = "Schon gefunden!"; return; }
  if (!canBuildFromLetters(word)) { statusEl.textContent = "❌ Nicht aus diesen Buchstaben baubar."; return; }
  if (!VALID_WORDS.has(word)) { statusEl.textContent = "❌ Kein gültiges Wort in der Liste."; return; }
  foundWords.add(word);
  scoreEl.textContent = "Wörter: " + foundWords.size;
  statusEl.textContent = "✅ " + word + "!";
  sfx.hit ? sfx.hit() : null;
}

async function endGame() {
  clearInterval(timerInterval);
  inputEl.disabled = true; submitBtn.disabled = true;
  const score = foundWords.size;
  statusEl.textContent = `Zeit abgelaufen! ${score} Wörter gefunden.`;
  restartBtn.classList.remove("hidden");
  sfx.lose ? sfx.lose() : null;
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "anagramm", score, at: serverTimestamp() });
    } catch (e) { console.error("[anagramm] Score-Submit fehlgeschlagen:", e); }
    try {
    await awardGameReward(myUid, Math.min(score * 60, 500), "anagramm_score");
    loadLeaderboard();
  } catch (e) {}
}

submitBtn.addEventListener("click", submitWord);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submitWord(); });
restartBtn.addEventListener("click", startGame);
leaveBtn.addEventListener("click", () => { clearInterval(timerInterval); window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "anagramm"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) { lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`; }
}
