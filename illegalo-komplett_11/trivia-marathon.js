// MAP — Trivia-Marathon. Solo-Quiz mit steigendem Schwierigkeitsgrad, 3 Leben,
// Streak-basierte Coin-Vergabe. Unterscheidet sich von quiz.js (das is 1v1).
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { renderShopAd } from "./ads.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);

// MAP: Fragen nach Schwierigkeit sortiert (easy zuerst, hard später) —
// Marathon zieht sich einfach zufällig aus dem passenden Pool je nach Streak.
const QUESTIONS = {
  easy: [
    { q: "Wie viele Beine hat eine Spinne?", a: ["8", "6", "10", "4"], correct: 0 },
    { q: "Was is die Hauptstadt von Deutschland?", a: ["Berlin", "München", "Hamburg", "Köln"], correct: 0 },
    { q: "Wie viele Tage hat ne Woche?", a: ["7", "5", "10", "6"], correct: 0 },
    { q: "Welche Farbe entsteht aus Blau + Gelb?", a: ["Grün", "Lila", "Orange", "Braun"], correct: 0 },
    { q: "Wie viele Kontinente gibt's?", a: ["7", "5", "6", "9"], correct: 0 },
  ],
  medium: [
    { q: "In welchem Jahr fiel die Berliner Mauer?", a: ["1989", "1991", "1985", "1993"], correct: 0 },
    { q: "Wie heißt der größte Planet im Sonnensystem?", a: ["Jupiter", "Saturn", "Neptun", "Mars"], correct: 0 },
    { q: "Wer hat die Relativitätstheorie entwickelt?", a: ["Einstein", "Newton", "Bohr", "Curie"], correct: 0 },
    { q: "Wie viele Spieler hat ne Fußballmannschaft (auf dem Feld)?", a: ["11", "10", "12", "9"], correct: 0 },
    { q: "Welches Element hat das Symbol 'Au'?", a: ["Gold", "Silber", "Aluminium", "Argon"], correct: 0 },
  ],
  hard: [
    { q: "Wer schrieb 'Faust'?", a: ["Goethe", "Schiller", "Kafka", "Brecht"], correct: 0 },
    { q: "Wie viele Knochen hat ein erwachsener Mensch?", a: ["206", "186", "226", "246"], correct: 0 },
    { q: "In welchem Jahr wurde die UNO gegründet?", a: ["1945", "1939", "1950", "1955"], correct: 0 },
    { q: "Wie heißt die kleinste Primzahl?", a: ["2", "1", "0", "3"], correct: 0 },
    { q: "Welcher Fluss is der längste der Welt?", a: ["Nil", "Amazonas", "Jangtse", "Mississippi"], correct: 0 },
  ],
};

const streakEl = document.getElementById("streak");
const livesEl = document.getElementById("lives");
const questionBoxEl = document.getElementById("question-box");
const answersEl = document.getElementById("answers");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart-btn");
const leaveBtn = document.getElementById("leave-btn");
renderShopAd("shop-ad");

let myUid, myName, streak, lives, usedQuestions, currentQ, ended;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid; myName = user.displayName || user.email || "Spieler";
  loadLeaderboard(); resetGame();
});

function resetGame() {
  streak = 0; lives = 3; usedQuestions = new Set(); ended = false;
  updateHud();
  restartBtn.classList.add("hidden");
  statusEl.textContent = "";
  nextQuestion();
}

function updateHud() {
  streakEl.textContent = `🔥 Streak: ${streak}`;
  livesEl.textContent = "❤️".repeat(lives) + "🖤".repeat(3 - lives);
}

function pickPool() {
  if (streak < 3) return QUESTIONS.easy;
  if (streak < 7) return QUESTIONS.medium;
  return QUESTIONS.hard;
}

function nextQuestion() {
  const pool = pickPool();
  const available = pool.map((q,i) => `${pool===QUESTIONS.easy?"e":pool===QUESTIONS.medium?"m":"h"}${i}`).filter(k => !usedQuestions.has(k));
  let idx, key;
  if (available.length === 0) {
    usedQuestions.clear(); // Pool durch -> von vorn, kann bei langem Marathon passieren
    idx = Math.floor(Math.random() * pool.length);
  } else {
    key = available[Math.floor(Math.random() * available.length)];
    idx = parseInt(key.slice(1));
  }
  currentQ = pool[idx];
  const poolKey = pool===QUESTIONS.easy?"e":pool===QUESTIONS.medium?"m":"h";
  usedQuestions.add(`${poolKey}${idx}`);

  questionBoxEl.textContent = currentQ.q;
  // Antworten mischen, damit's nich immer Index 0 is
  const order = [0,1,2,3].sort(() => Math.random() - 0.5);
  answersEl.innerHTML = order.map(origIdx =>
    `<button class="trivia-answer-btn" data-orig="${origIdx}">${currentQ.a[origIdx]}</button>`
  ).join("");
  answersEl.querySelectorAll(".trivia-answer-btn").forEach(btn => {
    btn.addEventListener("click", () => answerQuestion(parseInt(btn.dataset.orig)));
  });
}

function answerQuestion(chosenIdx) {
  if (ended) return;
  const btns = answersEl.querySelectorAll(".trivia-answer-btn");
  btns.forEach(b => b.disabled = true);
  const correctBtn = [...btns].find(b => parseInt(b.dataset.orig) === currentQ.correct);
  correctBtn?.classList.add("correct");

  if (chosenIdx === currentQ.correct) {
    streak++;
    sfx.hit ? sfx.hit() : null;
    updateHud();
    setTimeout(nextQuestion, 700);
  } else {
    const wrongBtn = [...btns].find(b => parseInt(b.dataset.orig) === chosenIdx);
    wrongBtn?.classList.add("wrong");
    lives--;
    sfx.lose ? sfx.lose() : null;
    updateHud();
    if (lives <= 0) {
      setTimeout(endGame, 900);
    } else {
      setTimeout(nextQuestion, 900);
    }
  }
}

async function endGame() {
  ended = true;
  statusEl.textContent = `Marathon vorbei! Finale Streak: ${streak}`;
  restartBtn.classList.remove("hidden");
  try {
    await addDoc(collection(db, "scores"), { uid: myUid, name: myName, game: "trivia-marathon", score: streak, at: serverTimestamp() });
  } catch (e) { console.error("[trivia-marathon] Score-Submit fehlgeschlagen:", e); }
  try {
    await awardGameReward(myUid, Math.min(streak * 25, 500), "trivia_marathon_streak");
    sfx.coin ? sfx.coin() : null;
  } catch (e) { console.error("[trivia-marathon] Coin-Vergabe fehlgeschlagen:", e); }
  loadLeaderboard();
}

restartBtn.addEventListener("click", resetGame);
leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });

async function loadLeaderboard() {
  const lbEl = document.getElementById("leaderboard");
  try {
    const q = query(collection(db, "scores"), where("game", "==", "trivia-marathon"), orderBy("score", "desc"), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) { lbEl.innerHTML = `<li class="empty">Noch keine Scores.</li>`; return; }
    lbEl.innerHTML = ""; let rank = 1;
    snap.forEach(d => { const s = d.data(); const li = document.createElement("li"); li.innerHTML = `<span>#${rank++} ${s.name||"Spieler"}</span><span>${s.score}</span>`; lbEl.appendChild(li); });
  } catch (e) {
    lbEl.innerHTML = `<li class="empty">Konnte Leaderboard nicht laden.</li>`;
    console.error("[trivia-marathon] Leaderboard-Query failed:", e);
  }
}
