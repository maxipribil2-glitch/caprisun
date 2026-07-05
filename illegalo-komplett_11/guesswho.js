// MAP — Errate-Wer. Beide sehen 16 Karten (Emoji-Gesichter). Jeder wählt geheim
// eine "Geheimkarte" für sich, dann muss der Gegner erraten welche das war (nicht
// umgekehrt "Ja/Nein"-Fragen wie beim Original — vereinfacht zu "beide raten
// gleichzeitig, wer schneller+richtig tippt kriegt den Punkt", Reaction-Duell-Style).
import { app } from "./firebase-config.js";
import { initMatch } from "./match.js";
import { renderShopAd } from "./ads.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";
import { awardGameReward } from "./gamocoin.js";

const auth = getAuth(app), db = getFirestore(app);
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const isSpectator = params.get("spectate") === "1";
const namesEl = document.getElementById("names");
const statusEl = document.getElementById("status");
const gridEl = document.getElementById("guess-grid");
const secretBox = document.getElementById("secret-box");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

const FACES = ["😀","😎","🥳","😏","🤓","😴","🥸","😜","🤠","😇","🙃","😬","🤯","🥶","😱","🤩"];
const ROUNDS_TO_WIN = 3;

let myUid, roomRef, currentRoom, myGuess = null;

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
    if (!currentRoom.secrets) initIfHost();
    if (currentRoom.round !== prevRound) myGuess = null;
    maybeShowReaction(currentRoom);
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }

async function initIfHost() {
  if (!isHost()) return;
  const secrets = {};
  currentRoom.players.forEach(uid => { secrets[uid] = Math.floor(Math.random() * FACES.length); });
  await updateDoc(roomRef, { secrets, round: 0, scores: {}, guesses: {}, roundResolved: false }).catch(() => {});
}

function render() {
  const room = currentRoom;
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames[myUid]||"Du"} vs ${room.playerNames[oppUid]||"Gegner"}  |  ${room.scores?.[myUid]??0} : ${room.scores?.[oppUid]??0}`;

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    return;
  }
  rematchBtn.classList.add("hidden");

  if (!room.secrets) { statusEl.textContent = "Karten werden verteilt..."; return; }

  const myFace = FACES[room.secrets[myUid]];
  secretBox.style.display = "block";
  secretBox.textContent = `Deine Geheimkarte ist: ${myFace} — der Gegner versucht sie zu erraten!`;

  const oppUid = opponentUid();
  const myGuessData = room.guesses?.[myUid];

  gridEl.innerHTML = "";
  FACES.forEach((face, idx) => {
    const card = document.createElement("div");
    let cls = "gw-card";
    if (myGuessData && myGuessData.idx === idx) cls += " picked";
    if (room.roundResolved) {
      cls += " disabled";
      if (idx === room.secrets[oppUid]) cls += " correct";
      else if (myGuessData && myGuessData.idx === idx) cls += " wrong";
    } else if (myGuessData) {
      cls += " disabled";
    }
    card.className = cls;
    card.textContent = face;
    if (!room.roundResolved && !myGuessData && !isSpectator) card.addEventListener("click", () => submitGuess(idx));
    gridEl.appendChild(card);
  });

  statusEl.textContent = room.roundResolved
    ? (room.lastRoundWinner === myUid ? "Du warst schneller+richtig! ⚡" : room.lastRoundWinner ? "Gegner war schneller+richtig." : "Beide falsch/keiner!")
    : myGuessData ? "Warte auf Gegner..." : "Rate die Geheimkarte des Gegners!";
}

async function submitGuess(idx) {
  if (isSpectator || currentRoom.roundResolved) return;
  const timeMs = Date.now() - (currentRoom.roundStartAt || Date.now());
  try {
    await updateDoc(roomRef, { [`guesses.${myUid}`]: { idx, timeMs } });
    sfx.move ? sfx.move() : null;
    await maybeResolve();
  } catch (e) {}
}

async function maybeResolve() {
  const room = currentRoom;
  const oppUid = opponentUid();
  const mine = room.guesses?.[myUid], theirs = room.guesses?.[oppUid];
  if (!mine || room.roundResolved) return;
  if (myUid > oppUid && !theirs) return;
  if (myUid > oppUid && theirs) return; // anderer Client resolved
  if (!theirs) { setTimeout(() => resolveRound(mine, room.guesses?.[oppUid]||null, oppUid), 4000); return; }
  await resolveRound(mine, theirs, oppUid);
}

async function resolveRound(mine, theirs, oppUid) {
  const room = currentRoom;
  if (room.roundResolved) return;
  const mineCorrect = mine.idx === room.secrets[oppUid];
  const theirsCorrect = theirs && theirs.idx === room.secrets[myUid];

  let winnerUid = null;
  if (mineCorrect && theirsCorrect) winnerUid = mine.timeMs <= theirs.timeMs ? myUid : oppUid;
  else if (mineCorrect) winnerUid = myUid;
  else if (theirsCorrect) winnerUid = oppUid;

  const newScores = { ...(room.scores||{}) };
  if (winnerUid) newScores[winnerUid] = (newScores[winnerUid]||0)+1;
  const gameFinished = winnerUid && newScores[winnerUid] >= ROUNDS_TO_WIN;

  try {
    await updateDoc(roomRef, {
      roundResolved: true, lastRoundWinner: winnerUid, scores: newScores,
      status: gameFinished ? "finished" : "active",
      winner: gameFinished ? winnerUid : null
    });
    if (gameFinished) {
      addDoc(collection(db, "matchResults"), { game: "guesswho", players: room.players, playerNames: room.playerNames, winner: winnerUid, at: serverTimestamp() }).catch(()=>{});
      if (winnerUid === myUid) awardGameReward(myUid, 100, "guesswho_win").catch(()=>{});
    } else if (myUid < oppUid) {
      setTimeout(async () => {
        const secrets = {};
        room.players.forEach(uid => { secrets[uid] = Math.floor(Math.random()*FACES.length); });
        await updateDoc(roomRef, { round:(room.round||0)+1, secrets, guesses:{}, roundResolved:false, lastRoundWinner:null, roundStartAt: Date.now() }).catch(()=>{});
      }, 2200);
    }
  } catch(e) {}
}

rematchBtn.addEventListener("click", async () => {
  const secrets = {};
  currentRoom.players.forEach(uid => { secrets[uid] = Math.floor(Math.random()*FACES.length); });
  await updateDoc(roomRef, { status:"active", winner:null, scores:{}, round:0, secrets, guesses:{}, roundResolved:false, roundStartAt: Date.now() });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"guesswho", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
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
