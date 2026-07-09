// MAP — Quiz-Duell (1v1). Beide Spieler kriegen die gleiche Frage, wer schneller UND
// richtig antwortet kriegt den Punkt. Kombiniert Reaction-Duell-Timing mit
// Wissens-Element. Best-of-5.
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app);
const db = getFirestore(app);
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const isSpectator = params.get("spectate") === "1";

const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const questionEl = document.getElementById("question-box");
const answersEl = document.getElementById("answers-grid");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) window.location.href = "lobby.html";

// Kleine, generische Fragen-Datenbank — bewusst allgemeinwissen-basiert, kein Trivia
// das aus fremden Quellen kopiert ist (Copyright-safe, selbst formuliert).
const QUESTIONS = [
  { q: "Wie viele Kontinente gibt es?", a: ["5", "6", "7", "8"], correct: 2 },
  { q: "Welcher Planet ist der Erde am nächsten?", a: ["Mars", "Venus", "Merkur", "Jupiter"], correct: 1 },
  { q: "Wie viele Beine hat eine Spinne?", a: ["6", "8", "10", "12"], correct: 1 },
  { q: "Was ist die Hauptstadt von Australien?", a: ["Sydney", "Melbourne", "Canberra", "Perth"], correct: 2 },
  { q: "Wie viele Sekunden hat eine Stunde?", a: ["360", "3600", "36000", "60"], correct: 1 },
  { q: "Welches ist das größte Säugetier?", a: ["Elefant", "Blauwal", "Giraffe", "Nashorn"], correct: 1 },
  { q: "Wie viele Saiten hat eine klassische Gitarre?", a: ["4", "5", "6", "7"], correct: 2 },
  { q: "In welchem Land steht die Freiheitsstatue?", a: ["Frankreich", "USA", "Kanada", "England"], correct: 1 },
  { q: "Wie viele Zähne hat ein erwachsener Mensch normalerweise?", a: ["28", "30", "32", "34"], correct: 2 },
  { q: "Welches Element hat das Symbol 'O'?", a: ["Gold", "Osmium", "Sauerstoff", "Silber"], correct: 2 },
];

const ROUNDS_TO_WIN = 3; // best of 5

let myUid, roomRef, currentRoom, answeredThisRound = false;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Raum existiert nicht (mehr)."; return; }
    const prevRound = currentRoom?.round;
    currentRoom = snap.data();
    if (!currentRoom.currentQuestion) initQuestionIfHost();
    if (currentRoom.round !== prevRound) answeredThisRound = false;
    maybeShowReaction(currentRoom);
    armQuizTimeout();
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

// MAP FIX (Timeout-Fallback): falls beide Spieler mitten in ner Runde den Tab
// schließen ohne "Verlassen", blieb das Match vorher für immer offen. Jetzt: 40s
// pro Frage, danach automatischer Verlust für wer nicht geantwortet hat (bei
// beiden untätig = einfach der Host gewinnt als Fallback, besser als ewig hängen).
const QUIZ_TIMEOUT_MS = 40000;
let quizTimeoutTimer;
function armQuizTimeout() {
  clearTimeout(quizTimeoutTimer);
  if (!currentRoom || currentRoom.status !== "active" || currentRoom.roundResolved) return;
  const startedAt = currentRoom.questionStartAt || Date.now();
  const remaining = QUIZ_TIMEOUT_MS - (Date.now() - startedAt);
  if (remaining <= 0) { resolveQuizTimeout(); return; }
  quizTimeoutTimer = setTimeout(resolveQuizTimeout, remaining + 500);
}
async function resolveQuizTimeout() {
  if (isSpectator || !currentRoom) return;
  const oppUid = opponentUid();
  try {
    let winnerUid = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const cur = snap.data();
      if (!cur || cur.status !== "active" || cur.roundResolved) return;
      if (Date.now() - (cur.questionStartAt||0) < QUIZ_TIMEOUT_MS) return;
      const mine = cur.answers?.[myUid], theirs = cur.answers?.[oppUid];
      if (mine && theirs) return; // beide haben schon geantwortet, normale Auflösung läuft eh
      winnerUid = mine && !theirs ? myUid : (!mine && theirs ? oppUid : cur.players[0]);
      tx.update(roomRef, { status: "finished", winner: winnerUid });
    });
    if (winnerUid) {
      addDoc(collection(db, "matchResults"), { game: "quiz", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "quiz_win").catch(()=>{});
    }
  } catch(e) {}
}

async function initQuestionIfHost() {
  if (!isHost() || currentRoom.status !== "active") return;
  const qIdx = Math.floor(Math.random() * QUESTIONS.length);
  await updateDoc(roomRef, {
    currentQuestion: qIdx, questionStartAt: Date.now(), answers: {}
  }).catch(() => {});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}  |  ${room.scores?.[myUid] ?? 0} : ${room.scores?.[oppUid] ?? 0}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : `${room.playerNames[oppUid] || "Gegner"} hat gewonnen.`;
    questionEl.textContent = "";
    answersEl.innerHTML = "";
    return;
  }
  rematchBtn.classList.add("hidden");

  if (currentRoom.currentQuestion === undefined || currentRoom.currentQuestion === null) {
    statusEl.textContent = "Nächste Frage kommt gleich...";
    return;
  }

  const q = QUESTIONS[room.currentQuestion];
  questionEl.textContent = q.q;
  const myAnswer = room.answers?.[myUid];

  answersEl.innerHTML = "";
  q.a.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.className = "quiz-answer";
    btn.textContent = text;
    if (room.roundResolved) {
      btn.classList.add("disabled");
      if (idx === q.correct) btn.classList.add("correct");
      else if (myAnswer?.idx === idx) btn.classList.add("wrong");
    } else if (myAnswer !== undefined) {
      btn.classList.add("disabled");
    } else {
      btn.addEventListener("click", () => submitAnswer(idx));
    }
    answersEl.appendChild(btn);
  });

  statusEl.textContent = room.roundResolved
    ? (room.lastRoundWinner === myUid ? "Du warst schneller & richtig! ⚡" : room.lastRoundWinner ? "Gegner war schneller." : "Keiner richtig — kein Punkt.")
    : myAnswer !== undefined ? "Warte auf Gegner..." : "Wähl deine Antwort!";
}

async function submitAnswer(idx) {
  if (answeredThisRound || currentRoom.roundResolved) return;
  answeredThisRound = true;
  const timeMs = Date.now() - (currentRoom.questionStartAt || Date.now());
  try {
    await updateDoc(roomRef, {
      [`answers.${myUid}`]: { idx, timeMs }
    });
    sfx.move ? sfx.move() : null;
    await maybeResolve();
  } catch (e) {}
}

async function maybeResolve() {
  const room = currentRoom;
  const oppUid = opponentUid();
  const mine = room.answers?.[myUid];
  const theirs = room.answers?.[oppUid];
  if (!mine || room.roundResolved) return;
  // nur der mit der kleineren UID resolved, um doppeltes Schreiben zu vermeiden
  if (!theirs && myUid > oppUid) return;
  if (myUid > oppUid && theirs) return; // der andere Client resolved

  if (!theirs) {
    // kurz warten ob Gegner noch antwortet
    setTimeout(() => resolveRound(mine, room.answers?.[oppUid] || null), 4000);
    return;
  }
  await resolveRound(mine, theirs);
}

async function resolveRound(mine, theirs) {
  const room = currentRoom;
  if (room.roundResolved) return;
  const oppUid = opponentUid();
  const q = QUESTIONS[room.currentQuestion];

  const mineCorrect = mine.idx === q.correct;
  const theirsCorrect = theirs && theirs.idx === q.correct;

  let winnerUid = null;
  if (mineCorrect && theirsCorrect) winnerUid = mine.timeMs <= theirs.timeMs ? myUid : oppUid;
  else if (mineCorrect) winnerUid = myUid;
  else if (theirsCorrect) winnerUid = oppUid;

  const newScores = { ...(room.scores || {}) };
  if (winnerUid) newScores[winnerUid] = (newScores[winnerUid] || 0) + 1;
  const gameFinished = winnerUid && newScores[winnerUid] >= ROUNDS_TO_WIN;

  try {
    await updateDoc(roomRef, {
      roundResolved: true, lastRoundWinner: winnerUid, scores: newScores,
      status: gameFinished ? "finished" : "active",
      winner: gameFinished ? winnerUid : null
    });
    if (gameFinished) {
      addDoc(collection(db, "matchResults"), {
        game: "quiz", players: room.players, playerNames: room.playerNames,
        winner: winnerUid, at: serverTimestamp()
      }).catch(() => {});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "quiz_win").catch(() => {});
    } else if (myUid < oppUid || !opponentUid()) {
      setTimeout(async () => {
        const qIdx = Math.floor(Math.random() * QUESTIONS.length);
        await updateDoc(roomRef, {
          round: (room.round || 0) + 1, currentQuestion: qIdx, questionStartAt: Date.now(),
          answers: {}, roundResolved: false, lastRoundWinner: null
        }).catch(() => {});
      }, 2200);
    }
  } catch (e) {}
}

rematchBtn.addEventListener("click", async () => {
  const qIdx = Math.floor(Math.random() * QUESTIONS.length);
  await updateDoc(roomRef, {
    status: "active", winner: null, scores: {}, round: 0,
    currentQuestion: qIdx, questionStartAt: Date.now(), answers: {}, roundResolved: false, lastRoundWinner: null
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom && currentRoom.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), {
        game: "quiz", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: oppUid, at: serverTimestamp()
      }).catch(() => {});
    } catch (e) {}
  }
  window.location.href = "lobby.html";
});

let lastReactionTs = Date.now();
function maybeShowReaction(room) {
  if (!room.reaction) return;
  if (room.reaction.ts > lastReactionTs) {
    lastReactionTs = room.reaction.ts;
    if (room.reaction.by !== myUid) showReactionPopup(room.reaction.emoji);
  }
}
function showReactionPopup(emoji) {
  const el = document.getElementById("reaction-popup");
  el.textContent = emoji;
  el.classList.remove("show");
  requestAnimationFrame(() => el.classList.add("show"));
}
document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!roomRef) return;
    showReactionPopup(btn.dataset.emoji);
    updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(() => {});
  });
});
