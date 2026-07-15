// MAP — Wortkette 1v1. Dein Wort muss mit dem letzten Buchstaben des vorherigen
// anfangen, min. 3 Buchstaben, keine Wiederholungen, 20s pro Zug. Timer-Timeout =
// Aufgabe (Gegner gewinnt). Bewusst KEINE Wörterbuch-Prüfung — im Freundeskreis
// checkt man sich gegenseitig, sonst bräuchten wir ne riesige Wortliste.
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const isSpectator = params.get("spectate") === "1";
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("turn-timer");
const chainEl = document.getElementById("chain-display");
const inputEl = document.getElementById("word-input");
const submitBtn = document.getElementById("submit-btn");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const TURN_SECS = 20;
let myUid, roomRef, currentRoom, uiTimer;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (currentRoom.turnStartAt === undefined) initIfHost();
    render();
    armTurnTimer();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myUid; }

async function initIfHost() {
  if (!isHost()) return;
  await updateDoc(roomRef, { chain: [], turn: currentRoom.players[0], turnStartAt: Date.now() }).catch(()=>{});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}  |  Kette: ${(room.chain||[]).length}`;

  chainEl.innerHTML = (room.chain||[]).map((e,i) =>
    `<div>${i+1}. <strong>${e.word}</strong> <span style="color:var(--sub);font-size:12px;">(${room.playerNames[e.by]||"?"})</span></div>`
  ).join("") || `<span style="color:var(--sub);">Noch kein Wort — freie Wahl fürs erste!</span>`;
  chainEl.scrollTop = chainEl.scrollHeight;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    inputEl.disabled = true; submitBtn.disabled = true;
    timerEl.textContent = "";
    return;
  }
  rematchBtn.classList.add("hidden");
  inputEl.disabled = isSpectator || !isMyTurn();
  submitBtn.disabled = inputEl.disabled;
  const lastWord = (room.chain||[]).slice(-1)[0]?.word;
  const needed = lastWord ? lastWord.slice(-1).toUpperCase() : null;
  statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus"
    : isMyTurn() ? (needed ? `🎯 Du bist dran — Wort mit "${needed}" anfangen!` : "🎯 Du fängst an — freie Wahl!")
    : "Warte auf den Gegner...";
}

// UI-Countdown + Timeout-Auswertung. Der Timeout wird nur vom Spieler ausgewertet
// der grad dran ist ODER (Fallback) vom Gegner 3s später — Transaction verhindert
// dass beide gleichzeitig "finished" mit unterschiedlichen Gewinnern schreiben.
function armTurnTimer() {
  clearInterval(uiTimer);
  const room = currentRoom;
  if (room.status !== "active" || !room.turnStartAt) { timerEl.textContent = ""; return; }
  uiTimer = setInterval(async () => {
    const left = Math.max(0, TURN_SECS - Math.floor((Date.now() - room.turnStartAt)/1000));
    timerEl.textContent = "⏱️ " + left + "s";
    const graceMs = room.turn === myUid ? 0 : 3000;
    if (left <= 0 && Date.now() - room.turnStartAt > TURN_SECS*1000 + graceMs) {
      clearInterval(uiTimer);
      await resolveTimeout(room.turn);
    }
  }, 300);
}

async function resolveTimeout(timedOutUid) {
  if (isSpectator) return;
  try {
    let winnerUid = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const cur = snap.data();
      if (!cur || cur.status !== "active" || cur.turn !== timedOutUid) return;
      if (Date.now() - cur.turnStartAt < TURN_SECS*1000) return;
      winnerUid = cur.players.find(p => p !== timedOutUid);
      tx.update(roomRef, { status: "finished", winner: winnerUid });
    });
    if (winnerUid) {
      addDoc(collection(db,"matchResults"), { game:"wordchain", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "wordchain_win").catch(()=>{});
    }
  } catch(e) {}
}

async function submitWord() {
  if (!isMyTurn()) return;
  const word = inputEl.value.trim().toUpperCase();
  inputEl.value = "";
  if (word.length < 3) { statusEl.textContent = "Mind. 3 Buchstaben, digga."; return; }
  if (!/^[A-ZÄÖÜß]+$/.test(word)) { statusEl.textContent = "Nur Buchstaben erlaubt."; return; }
  const chain = currentRoom.chain || [];
  const lastWord = chain.slice(-1)[0]?.word;
  if (lastWord && word[0] !== lastWord.slice(-1)) {
    statusEl.textContent = `❌ Muss mit "${lastWord.slice(-1)}" anfangen!`; return;
  }
  if (chain.some(e => e.word === word)) { statusEl.textContent = "❌ Wurde schon benutzt!"; return; }
  sfx.move ? sfx.move() : null;
  const oppUid = opponentUid();
  try {
    await updateDoc(roomRef, {
      chain: [...chain, { word, by: myUid }],
      turn: oppUid,
      turnStartAt: Date.now()
    });
  } catch(e) {}
}

submitBtn.addEventListener("click", submitWord);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submitWord(); });

rematchBtn.addEventListener("click", async () => {
  // MAP FEATURE (Verbesserungsvorschlag Punkt 4): Startspieler wird bei Rematch
  // jetzt zufällig ausgelost statt immer den Host (players[0]) anfangen zu
  // lassen — fairer, gleiches Prinzip wie schon bei chess.js/checkers.js.
  const starter = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  await updateDoc(roomRef, { status:"active", winner:null, chain: [], turn: starter, turnStartAt: Date.now() });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"wordchain", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
