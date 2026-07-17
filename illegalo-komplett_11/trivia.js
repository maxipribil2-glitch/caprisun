// MAP — Trivia-Marathon. Solo, steigender Schwierigkeitsgrad, 3 Leben,
// Streak-basiertes Coin-System. Fragen-Pool lokal (kein Internet-API-Aufruf
// nötig, funktioniert offline-freundlich und is 100% vorhersehbar/fair).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const streakEl = document.getElementById("streak");
const livesEl = document.getElementById("lives");
const qBoxEl = document.getElementById("question-box");
const answersEl = document.getElementById("answers");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

// MAP: Fragen-Pool nach Schwierigkeit sortiert (easy zuerst, dann medium, dann hard)
const QUESTIONS = {
  easy: [
    { q: "Wie viele Beine hat eine Spinne?", a: ["8","6","10","4"], c: 0 },
    { q: "Welche Farbe entsteht aus Blau + Gelb?", a: ["Grün","Lila","Orange","Rot"], c: 0 },
    { q: "Wie viele Tage hat eine Woche?", a: ["7","6","8","5"], c: 0 },
    { q: "Hauptstadt von Deutschland?", a: ["Berlin","München","Hamburg","Köln"], c: 0 },
    { q: "Was is 5 + 7?", a: ["12","11","13","10"], c: 0 },
    { q: "Welches Tier sagt 'Muh'?", a: ["Kuh","Schaf","Ziege","Pferd"], c: 0 },
  ],
  medium: [
    { q: "Wie viele Planeten hat unser Sonnensystem?", a: ["8","9","7","10"], c: 0 },
    { q: "In welchem Jahr fiel die Berliner Mauer?", a: ["1989","1991","1985","1993"], c: 0 },
    { q: "Wer schrieb 'Faust'?", a: ["Goethe","Schiller","Kafka","Brecht"], c: 0 },
    { q: "Was is die Wurzel aus 144?", a: ["12","11","13","14"], c: 0 },
    { q: "Größter Ozean der Erde?", a: ["Pazifik","Atlantik","Indischer Ozean","Arktischer Ozean"], c: 0 },
    { q: "Welches Element hat das Symbol 'Fe'?", a: ["Eisen","Fluor","Feuerstein","Fermium"], c: 0 },
  ],
  hard: [
    { q: "Wer war der erste Mensch im Weltall?", a: ["Juri Gagarin","Neil Armstrong","Buzz Aldrin","John Glenn"], c: 0 },
    { q: "Wie viele Herzkammern hat der Mensch?", a: ["4","2","3","1"], c: 0 },
    { q: "In welchem Jahrhundert lebte Leonardo da Vinci?", a: ["15./16. Jh.","13./14. Jh.","17./18. Jh.","19. Jh."], c: 0 },
    { q: "Chemisches Symbol für Gold?", a: ["Au","Ag","Go","Gd"], c: 0 },
    { q: "Welcher Fluss is der längste der Welt?", a: ["Nil","Amazonas","Jangtse","Mississippi"], c: 0 },
    { q: "Wie viele Knochen hat der erwachsene Mensch?", a: ["206","198","212","220"], c: 0 },
  ],
};

let myUid, myName, streak = 0, lives = 3, currentQ = null, usedQuestions = new Set();

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function difficultyForStreak(s) {
  if (s < 3) return "easy";
  if (s < 7) return "medium";
  return "hard";
}

function pickQuestion() {
  const diff = difficultyForStreak(streak);
  const pool = QUESTIONS[diff].filter((q,i) => !usedQuestions.has(diff+i));
  const availablePool = pool.length ? pool : QUESTIONS[diff]; // Pool erschöpft -> wiederholen erlaubt
  const idx = Math.floor(Math.random() * availablePool.length);
  const q = availablePool[idx];
  const realIdx = QUESTIONS[diff].indexOf(q);
  usedQuestions.add(diff+realIdx);
  return q;
}

function resetGame() {
  streak = 0; lives = 3; usedQuestions = new Set();
  updateHud();
  statusEl.textContent = "";
  restartBtn.classList.add("hidden");
  nextQuestion();
}

function updateHud() {
  streakEl.textContent = `🔥 Streak: ${streak}`;
  livesEl.textContent = "❤️".repeat(lives) + "🖤".repeat(3-lives);
}

function nextQuestion() {
  currentQ = pickQuestion();
  // Antworten mischen, richtigen Index neu berechnen
  const correctAnswer = currentQ.a[currentQ.c];
  const shuffled = [...currentQ.a].sort(() => Math.random() - 0.5);
  const newCorrectIdx = shuffled.indexOf(correctAnswer);
  qBoxEl.textContent = currentQ.q;
  answersEl.innerHTML = shuffled.map((ans, i) =>
    `<button class="trivia-answer-btn" data-idx="${i}" onclick="window.__triviaAnswer(${i},${newCorrectIdx})">${ans}</button>`
  ).join("");
}

window.__triviaAnswer = (chosenIdx, correctIdx) => {
  document.querySelectorAll(".trivia-answer-btn").forEach(b => b.disabled = true);
  const chosenBtn = document.querySelector(`.trivia-answer-btn[data-idx="${chosenIdx}"]`);
  const correctBtn = document.querySelector(`.trivia-answer-btn[data-idx="${correctIdx}"]`);
  correctBtn.classList.add("correct");
  if (chosenIdx === correctIdx) {
    streak++;
    sfx.win ? sfx.win() : null;
    updateHud();
    setTimeout(nextQuestion, 700);
  } else {
    chosenBtn.classList.add("wrong");
    lives--;
    sfx.lose ? sfx.lose() : null;
    updateHud();
    if (lives <= 0) {
      setTimeout(() => endGame(), 900);
    } else {
      setTimeout(nextQuestion, 900);
    }
  }
};

async function endGame() {
  statusEl.textContent = `Game Over! Streak: ${streak}`;
  restartBtn.classList.remove("hidden");
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "trivia", score: streak, at: serverTimestamp() });
  } catch (e) { console.error("[trivia] Score-Submit fehlgeschlagen:", e); }
  try {
    await awardGameReward(myUid, streak * 30, "trivia_score");
    sfx.coin ? sfx.coin() : null;
  } catch (e) { console.error("[trivia] Coin-Vergabe fehlgeschlagen:", e); }
  loadLeaderboard();
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "trivia"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[trivia] Leaderboard-Query failed:", e);
  }
}
