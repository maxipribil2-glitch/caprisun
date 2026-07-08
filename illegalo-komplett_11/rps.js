// MAP — Schere Stein Papier, Best-of-3 (5 Runden max, wer 3 zuerst hat gewinnt).
// Beide wählen verdeckt (Wahl wird erst sichtbar wenn BEIDE gewählt haben).
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
const revealEl = document.getElementById("reveal-row");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const WINS_NEEDED = 3;

let myUid, roomRef, currentRoom, pickedThisRound = false;

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    const prevRound = currentRoom?.round;
    currentRoom = snap.data();
    if (currentRoom.round !== prevRound) pickedThisRound = false;
    maybeShowReaction(currentRoom);
    armRoundTimeout();
    render();
  });
});

function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

// MAP FIX (Timeout-Fallback): RPS hat keinen klassischen "wer ist dran"-Turn (beide
// wählen gleichzeitig), heißt der übliche Turn-Timeout-Pattern greift hier nicht 1:1.
// Stattdessen: falls einer der beiden 45s nach Rundenstart NOCH NICHT gewählt hat,
// verliert automatisch derjenige der nicht gewählt hat (Auto-Forfeit).
const ROUND_TIMEOUT_MS = 45000;
let roundTimeoutTimer;
function armRoundTimeout() {
  clearTimeout(roundTimeoutTimer);
  if (!currentRoom || currentRoom.status !== "active" || currentRoom.roundResolved) return;
  const startedAt = currentRoom.roundStartedAt || Date.now();
  const remaining = ROUND_TIMEOUT_MS - (Date.now() - startedAt);
  if (remaining <= 0) { resolveRoundTimeout(); return; }
  roundTimeoutTimer = setTimeout(resolveRoundTimeout, remaining + 500);
}
async function resolveRoundTimeout() {
  if (isSpectator || !currentRoom) return;
  const oppUid = opponentUid();
  try {
    let winnerUid = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const cur = snap.data();
      if (!cur || cur.status !== "active" || cur.roundResolved) return;
      if (Date.now() - (cur.roundStartedAt||0) < ROUND_TIMEOUT_MS) return;
      const mine = cur.picks?.[myUid], theirs = cur.picks?.[oppUid];
      // Nur weiterlaufen falls WIRKLICH einer nicht gewählt hat (sonst kann's sein
      // dass die Runde grad normal resolved wird, kein Auto-Forfeit nötig)
      if (mine && theirs) return;
      const laggingUid = !mine ? myUid : oppUid;
      winnerUid = cur.players.find(p => p !== laggingUid);
      tx.update(roomRef, { status: "finished", winner: winnerUid });
    });
    if (winnerUid) {
      addDoc(collection(db, "matchResults"), { game: "rps", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "rps_win").catch(()=>{});
    }
  } catch(e) {}
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}  |  ${room.scores?.[myUid]??0} : ${room.scores?.[oppUid]??0}`;

  document.querySelectorAll(".rps-btn").forEach(btn => btn.classList.remove("picked"));

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    document.querySelectorAll(".rps-btn").forEach(b => b.disabled = true);
    return;
  }
  rematchBtn.classList.add("hidden");
  document.querySelectorAll(".rps-btn").forEach(b => b.disabled = isSpectator);

  const myPick = room.picks?.[myUid];
  const oppUid2 = oppUid;
  const oppPick = room.picks?.[oppUid2];

  if (room.roundResolved) {
    revealEl.innerHTML = `<span>${EMOJI[myPick]}</span><span style="font-size:20px;">vs</span><span>${EMOJI[oppPick]}</span>`;
    statusEl.textContent = room.lastRoundWinner === "draw" ? "Unentschieden!" : room.lastRoundWinner === myUid ? "Du hast die Runde gewonnen! ⚡" : "Gegner hat die Runde gewonnen.";
  } else {
    revealEl.innerHTML = "";
    if (myPick) { statusEl.textContent = "Gewählt! Warte auf Gegner..."; }
    else { statusEl.textContent = isSpectator ? "👀 Live-Zuschauer-Modus" : "Wähl deine Waffe!"; }
  }
}

async function pick(choice) {
  if (isSpectator || pickedThisRound || currentRoom.status !== "active" || currentRoom.roundResolved) return;
  pickedThisRound = true;
  try {
    await updateDoc(roomRef, { [`picks.${myUid}`]: choice });
    sfx.move ? sfx.move() : null;
    await maybeResolve();
  } catch (e) {}
}

async function maybeResolve() {
  const room = currentRoom;
  const oppUid = opponentUid();
  const mine = room.picks?.[myUid], theirs = room.picks?.[oppUid];
  if (!mine || !theirs || room.roundResolved) return;
  if (myUid > oppUid) return; // nur einer resolved
  await resolveRound(mine, theirs, oppUid);
}

async function resolveRound(mine, theirs, oppUid) {
  const room = currentRoom;
  let winnerUid = "draw";
  if (mine !== theirs) winnerUid = BEATS[mine] === theirs ? myUid : oppUid;

  const newScores = { ...(room.scores || {}) };
  if (winnerUid !== "draw") newScores[winnerUid] = (newScores[winnerUid]||0) + 1;
  const gameFinished = winnerUid !== "draw" && newScores[winnerUid] >= WINS_NEEDED;

  try {
    await updateDoc(roomRef, {
      roundResolved: true, lastRoundWinner: winnerUid, scores: newScores,
      status: gameFinished ? "finished" : "active",
      winner: gameFinished ? winnerUid : null
    });
    if (gameFinished) {
      addDoc(collection(db, "matchResults"), { game: "rps", players: room.players, playerNames: room.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "rps_win").catch(()=>{});
    } else {
      setTimeout(async () => {
        await updateDoc(roomRef, { round: (room.round||0)+1, picks: {}, roundResolved: false, lastRoundWinner: null }).catch(()=>{});
      }, 2200);
    }
  } catch(e) {}
}

document.querySelectorAll(".rps-btn").forEach(btn => btn.addEventListener("click", () => pick(btn.dataset.choice)));

rematchBtn.addEventListener("click", async () => {
  await updateDoc(roomRef, { status: "active", winner: null, scores: {}, round: 0, picks: {}, roundResolved: false, lastRoundWinner: null });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status: "finished", winner: oppUid });
      addDoc(collection(db, "matchResults"), { game: "rps", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

let lastReactionTs = Date.now();
function maybeShowReaction(room) {
  if (!room.reaction) return;
  if (room.reaction.ts > lastReactionTs) { lastReactionTs = room.reaction.ts; if (room.reaction.by !== myUid) showReactionPopup(room.reaction.emoji); }
}
function showReactionPopup(emoji) {
  const el = document.getElementById("reaction-popup");
  el.textContent = emoji; el.classList.remove("show"); requestAnimationFrame(() => el.classList.add("show"));
}
document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; showReactionPopup(btn.dataset.emoji); updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
