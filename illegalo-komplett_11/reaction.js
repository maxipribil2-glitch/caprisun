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
  const clickMs = Date.now() - (currentRoom.greenAt || Date.now()); // eigene Reaktionszeit

  if (phase === "wait_green") {
    // False start — sofort verloren für diese Runde
    clearTimeout(roundTimer);
    sfx.lose ? sfx.lose() : null;
    await reportClick("false_start", clickMs);
    return;
  }
  if (phase === "green") {
    sfx.win ? sfx.win() : null;
    await reportClick("green", clickMs);
  }
}

// MAP FIX: statt "wer zuerst bei Firestore ankommt gewinnt" (unfair bei
// unterschiedlichem Ping) schreibt jetzt jeder Client nur seine EIGENE gemessene
// Reaktionszeit (clickMs) rein. Erst wenn BEIDE Zeiten da sind, wird lokal verglichen
// wer wirklich schneller war — Ping spielt dabei keine Rolle mehr, nur die tatsächlich
// gemessene Zeit zwischen "grün" und Klick zählt.
async function reportClick(type, clickMs) {
  const room = currentRoom;
  if (room.phase === "round_result") return; // schon entschieden
  try {
    await updateDoc(roomRef, {
      [`roundClicks.${myUid}`]: { type, clickMs, at: Date.now() }
    });
    await maybeResolveRound();
  } catch (e) {}
}

async function maybeResolveRound() {
  const room = currentRoom;
  if (!room || room.phase === "round_result") return;
  const clicks = room.roundClicks || {};
  const oppUid = opponentUid();
  const mine = clicks[myUid];
  const theirs = clicks[oppUid];
  if (!mine) return;

  // Beide haben geklickt -> lokal vergleichen wer schneller/fairer war.
  // Nur EIN Client (der mit der niedrigeren uid, damit's deterministisch nur einmal
  // läuft) schreibt das Endergebnis, damit nicht beide gleichzeitig versuchen zu resolven.
  const shouldResolve = !theirs ? false : myUid < oppUid;
  if (theirs && shouldResolve) {
    await finishRound(mine, theirs, oppUid);
  } else if (!theirs) {
    // Warte kurz auf den Gegner-Klick, falls er noch unterwegs ist (max 2.5s)
    clearTimeout(roundTimer);
    roundTimer = setTimeout(async () => {
      const snap = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js")
        .then(m => m.getDoc(roomRef));
      const data = snap.data();
      const theirsLate = data.roundClicks?.[oppUid];
      if (theirsLate && myUid < oppUid) {
        await finishRound(data.roundClicks[myUid], theirsLate, oppUid);
      } else if (!theirsLate) {
        // Gegner hat noch nicht mal geklickt (evtl. AFK) — ich gewinne die Runde
        if (myUid < oppUid || !data.roundClicks?.[oppUid]) {
          await finishRound(mine, null, oppUid);
        }
      }
    }, 2500);
  }
}

async function finishRound(mine, theirs, oppUid) {
  const room = currentRoom;
  if (room.phase === "round_result") return;

  let winnerUid, isFalseStart = false, falseStartUid = null;
  if (mine.type === "false_start") { winnerUid = oppUid; isFalseStart = true; falseStartUid = myUid; }
  else if (theirs && theirs.type === "false_start") { winnerUid = myUid; isFalseStart = true; falseStartUid = oppUid; }
  else if (!theirs) { winnerUid = myUid; } // Gegner hat nicht reagiert
  else { winnerUid = mine.clickMs <= theirs.clickMs ? myUid : oppUid; }

  const newScores = { ...(room.scores || {}) };
  newScores[winnerUid] = (newScores[winnerUid] || 0) + 1;
  const gameFinished = newScores[winnerUid] >= ROUNDS_TO_WIN;

  try {
    await updateDoc(roomRef, {
      phase: "round_result",
      lastRoundWinner: isFalseStart ? "false_start" : winnerUid,
      falseStartBy: falseStartUid,
      scores: newScores,
      roundClicks: {},
      status: gameFinished ? "finished" : "active",
      winner: gameFinished ? winnerUid : null
    });
    if (gameFinished) {
      addDoc(collection(db, "matchResults"), {
        game: "reaction", players: room.players, playerNames: room.playerNames,
        winner: winnerUid, at: serverTimestamp()
      }).catch(() => {});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "reaction_win").catch(() => {});
    } else if (myUid < oppUid) { // nur einer der beiden treibt die nächste Runde an
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

leaveBtn.addEventListener("click", async () => {
  clearTimeout(roundTimer);
  // MAP FIX: wer mitten im Match "Verlassen" klickt, gibt auf — Gegner kriegt
  // den Sieg + Coins geschrieben, statt dass der andere für immer wartet.
  if (!isSpectator && currentRoom && currentRoom.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid, phase: "round_result", lastRoundWinner: oppUid });
      addDoc(collection(db, "matchResults"), {
        game: "reaction", players: currentRoom.players, playerNames: currentRoom.playerNames,
        winner: oppUid, at: serverTimestamp()
      }).catch(() => {});
      // Coin-Reward geht hier an den ÜBRIGGEBLIEBENEN Client selbst (der schreibt sich
      // seine eigenen Coins, wenn sein Snapshot-Listener status:"finished" sieht).
    } catch (e) {}
  }
  window.location.href = "lobby.html";
});

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
