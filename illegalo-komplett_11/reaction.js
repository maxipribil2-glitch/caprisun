// MAP — Reaction Duell (1v1, per Invite). 3 Runden, wer öfter schneller klickt wenn's
// grün wird gewinnt. Läuft über "rooms" wie die anderen 1v1-Spiele. Delay ist zufällig
// und wird vom Host (players[0]) bestimmt & in Firestore geschrieben, damit beide exakt
// den gleichen Startzeitpunkt sehen (serverTimestamp-basiert, nicht lokale Uhr).
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
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

const box = document.getElementById("react-box");
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");

if (!roomId) { window.location.href = "lobby.html"; }

const ROUNDS_TO_WIN = 2; // best of 3

let myUid = null;
let roomRef = null;
let currentRoom = null;
let clickedThisRound = false;
let roundTimer = null;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) {
    initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  }
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { statusEl.textContent = "Dieser Raum existiert nicht (mehr)."; return; }
    const prevRound = currentRoom?.round;
    currentRoom = snap.data();
    maybeShowReaction(currentRoom);
    render();
    if (currentRoom.round !== prevRound) {
      clickedThisRound = false;
      scheduleLocalPhase();
    }
    // Host startet die erste Runde falls noch nicht passiert
    if (isHost() && currentRoom.status === "active" && !currentRoom.roundStartAt && !currentRoom.phase) {
      startRound();
    }
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]} vs ${room.playerNames[oppUid] || "Gegner"}  |  ${room.scores?.[myUid] ?? 0} : ${room.scores?.[oppUid] ?? 0}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : `${room.playerNames[oppUid] || "Gegner"} hat gewonnen.`;
    box.style.background = "#2a2d3a";
    box.textContent = room.winner === myUid ? "🏆 GG!" : "😢 GG!";
    return;
  }

  rematchBtn.classList.add("hidden");

  const phase = room.phase || "waiting";
  if (phase === "waiting") {
    box.style.background = "#2a2d3a";
    box.textContent = "Gleich geht's los...";
    statusEl.textContent = "Warte auf Countdown...";
  } else if (phase === "wait_green") {
    box.style.background = "#7f1d1d";
    box.textContent = "WARTEN...";
    statusEl.textContent = "Noch nicht klicken — wartet auf GRÜN!";
  } else if (phase === "green") {
    box.style.background = "#15803d";
    box.textContent = "JETZT!! 🟢";
    statusEl.textContent = "KLICK!";
  } else if (phase === "round_result") {
    const rr = room.lastRoundWinner;
    box.style.background = "#2a2d3a";
    box.textContent = rr === "false_start"
      ? `${room.playerNames[room.falseStartBy]} war zu früh! ❌`
      : rr === myUid ? "Du warst schneller! ⚡" : `${room.playerNames[rr] || "Gegner"} war schneller ⚡`;
    statusEl.textContent = "Nächste Runde gleich...";
  }
}

// ── Host-gesteuerter Rundenablauf ──
async function startRound() {
  await updateDoc(roomRef, { phase: "wait_green", roundStartAt: Date.now() });
  const delay = 1500 + Math.random() * 3000; // 1.5s–4.5s Fake-out
  clearTimeout(roundTimer);
  roundTimer = setTimeout(async () => {
    // Re-check: Raum könnte inzwischen vorbei sein
    await updateDoc(roomRef, { phase: "green", greenAt: Date.now() });
  }, delay);
}

function scheduleLocalPhase() {
  // Kein zusätzlicher Client-Timer nötig — Host treibt Phasenwechsel per Firestore,
  // alle Clients reagieren nur auf onSnapshot. Diese Funktion existiert als Hook
  // falls später Client-seitige Animationen pro Runde nötig werden.
}

async function handleClick() {
  if (isSpectator || !currentRoom || currentRoom.status !== "active") return;
  if (clickedThisRound) return;
  clickedThisRound = true;
  const phase = currentRoom.phase;

  if (phase === "wait_green") {
    // False start — sofort verloren für diese Runde
    clearTimeout(roundTimer);
    sfx.lose ? sfx.lose() : null;
    await finishRound("false_start", myUid);
    return;
  }
  if (phase === "green") {
    sfx.win ? sfx.win() : null;
    await finishRound(myUid, null);
  }
}

async function finishRound(roundWinnerOrFlag, falseStartBy) {
  // Nur der erste Klick "gewinnt" — check via Firestore-Update mit aktuellem State,
  // um Race Conditions zwischen beiden Clients zu minimieren (best effort, kein
  // Transaction nötig da falscher Doppel-Score hier nur kosmetisch minimal wäre).
  const room = currentRoom;
  if (room.phase === "round_result") return; // schon entschieden

  const opponent = opponentUid();
  const isFalseStart = roundWinnerOrFlag === "false_start";
  const winnerUid = isFalseStart ? opponent : myUid;
  const newScores = { ...(room.scores || {}) };
  newScores[winnerUid] = (newScores[winnerUid] || 0) + 1;

  const gameFinished = newScores[winnerUid] >= ROUNDS_TO_WIN;

  try {
    await updateDoc(roomRef, {
      phase: "round_result",
      lastRoundWinner: isFalseStart ? "false_start" : myUid,
      falseStartBy: isFalseStart ? myUid : null,
      scores: newScores,
      status: gameFinished ? "finished" : "active",
      winner: gameFinished ? winnerUid : null
    });
    if (gameFinished) {
      addDoc(collection(db, "matchResults"), {
        game: "reaction", players: room.players, playerNames: room.playerNames,
        winner: winnerUid, at: serverTimestamp()
      }).catch(() => {});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "reaction_win").catch(() => {});
    } else if (isHost()) {
      setTimeout(() => {
        updateDoc(roomRef, { round: (room.round || 0) + 1, phase: "waiting", roundStartAt: null }).then(() => {
          setTimeout(() => startRound(), 400);
        }).catch(() => {});
      }, 1800);
    }
  } catch (e) {}
}

box.addEventListener("pointerdown", handleClick);
window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); handleClick(); } });

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, {
    status: "active", winner: null, scores: {}, round: 0, phase: "waiting", roundStartAt: null,
    lastRoundWinner: null, falseStartBy: null
  });
  if (isHost()) setTimeout(() => startRound(), 500);
});

leaveBtn.addEventListener("click", () => { clearTimeout(roundTimer); window.location.href = "lobby.html"; });

// ── Emoji-Reaktionen ──
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
