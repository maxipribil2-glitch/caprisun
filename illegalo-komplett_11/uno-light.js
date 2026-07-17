// MAP — UNO-Light. Vereinfachte Version: nur Zahlkarten (0-9, 4 Farben), keine
// Spezial-/Wild-Karten. Farbe ODER Zahl muss zur obersten Ablage-Karte passen.
// Kein Match möglich -> ziehen (Zug is dann vorbei, kein sofortiges Nachlegen —
// bewusst simpel gehalten für "Light").
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
const oppHandInfoEl = document.getElementById("opp-hand-info");
const discardTopEl = document.getElementById("discard-top");
const myHandEl = document.getElementById("my-hand");
const rematchBtn = document.getElementById("rematch-btn");
const leaveBtn = document.getElementById("leave-btn");
if (!roomId) window.location.href = "lobby.html";

let myUid, roomRef, currentRoom;
renderShopAd("shop-ad");

const COLORS = ["red", "blue", "green", "yellow"];

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let n = 0; n <= 9; n++) deck.push({ color, num: n });
  }
  return deck.sort(() => Math.random() - 0.5);
}

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  roomRef = doc(db, "rooms", roomId);
  if (!isSpectator) initMatch({ roomRef, myUid, myName: user.displayName || user.email || "Spieler", onRematch: () => {} });
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    if (!currentRoom.deck) initIfHost();
    render();
  });
});

function isHost() { return currentRoom && currentRoom.players[0] === myUid; }
function opponentUid() { return currentRoom.players.find(p => p !== myUid); }
function isMyTurn() { return !isSpectator && currentRoom.status === "active" && currentRoom.turn === myUid; }

async function initIfHost() {
  if (!isHost()) return;
  const deck = buildDeck();
  const handA = deck.splice(0, 7);
  const handB = deck.splice(0, 7);
  const discard = [deck.splice(0, 1)[0]];
  await updateDoc(roomRef, {
    deck, discard,
    hands: { [currentRoom.players[0]]: handA, [currentRoom.players[1]]: handB },
    turn: currentRoom.players[0]
  }).catch(()=>{});
}

function cardMatches(card, top) { return card.color === top.color || card.num === top.num; }

function render() {
  const room = currentRoom;
  if (!room.hands) { statusEl.textContent = "Baue Deck auf..."; return; }
  const oppUid = opponentUid();
  namesEl.textContent = `${room.playerNames?.[myUid]||"Du"} vs ${room.playerNames?.[oppUid]||"Gegner"}`;
  oppHandInfoEl.textContent = `Gegner hat noch ${(room.hands[oppUid]||[]).length} Karten`;

  const top = room.discard[room.discard.length - 1];
  discardTopEl.className = `uno-card ${top.color}`;
  discardTopEl.textContent = top.num;

  const myHand = room.hands[myUid] || [];
  const canPlaySomething = myHand.some(c => cardMatches(c, top));
  myHandEl.innerHTML = myHand.map((c, i) => {
    const playable = isMyTurn() && cardMatches(c, top);
    return `<div class="uno-card ${c.color} ${playable?"playable":(isMyTurn()?"unplayable":"")}" ${playable?`onclick="window.__unoPlay(${i})"`:""}>${c.num}</div>`;
  }).join("");

  if (room.status === "finished") {
    rematchBtn.classList.remove("hidden");
    statusEl.textContent = room.winner === myUid ? "DU HAST GEWONNEN 🔥" : "Verloren, GG.";
    return;
  }
  rematchBtn.classList.add("hidden");
  if (isSpectator) statusEl.textContent = "👀 Live-Zuschauer-Modus";
  else if (isMyTurn()) statusEl.textContent = canPlaySomething ? "🎯 Du bist dran — leg ne Karte!" : "🎯 Du bist dran — keine passt, zieh!";
  else statusEl.textContent = "Warte auf den Gegner...";
}

window.__unoPlay = async (cardIdx) => {
  if (!isMyTurn()) return;
  const myHand = [...(currentRoom.hands[myUid] || [])];
  const top = currentRoom.discard[currentRoom.discard.length - 1];
  const card = myHand[cardIdx];
  if (!card || !cardMatches(card, top)) return;
  myHand.splice(cardIdx, 1);
  const newDiscard = [...currentRoom.discard, card];

  sfx.move ? sfx.move() : null;

  if (myHand.length === 0) {
    // Sieg!
    try {
      await updateDoc(roomRef, {
        [`hands.${myUid}`]: myHand, discard: newDiscard,
        status: "finished", winner: myUid
      });
      sfx.win ? sfx.win() : null;
      addDoc(collection(db,"matchResults"), { game:"uno-light", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: myUid, at: serverTimestamp() }).catch(()=>{});
      awardGameReward(myUid, 100, "uno_light_win").catch(()=>{});
    } catch(e) {}
    return;
  }

  try {
    await updateDoc(roomRef, {
      [`hands.${myUid}`]: myHand, discard: newDiscard, turn: opponentUid()
    });
  } catch(e) {}
};

window.__unoDraw = async () => {
  if (!isMyTurn()) return;
  let deck = [...currentRoom.deck];
  if (deck.length === 0) {
    // Nachziehstapel leer -> Ablage (außer oberste Karte) neu mischen
    const top = currentRoom.discard[currentRoom.discard.length - 1];
    deck = currentRoom.discard.slice(0, -1).sort(() => Math.random() - 0.5);
    if (deck.length === 0) { // wirklich gar keine Karten mehr übrig -> Zug einfach überspringen
      try { await updateDoc(roomRef, { turn: opponentUid() }); } catch(e) {}
      return;
    }
    try { await updateDoc(roomRef, { discard: [top], deck }); currentRoom.discard = [top]; currentRoom.deck = deck; } catch(e) { return; }
  }
  const drawnCard = deck.pop();
  const myHand = [...(currentRoom.hands[myUid] || []), drawnCard];
  sfx.move ? sfx.move() : null;
  try {
    await updateDoc(roomRef, {
      [`hands.${myUid}`]: myHand, deck, turn: opponentUid()
    });
  } catch(e) {}
};

rematchBtn.addEventListener("click", async () => {
  const starter = Math.random() < 0.5 ? currentRoom.players[0] : currentRoom.players[1];
  const deck = buildDeck();
  const handA = deck.splice(0, 7);
  const handB = deck.splice(0, 7);
  const discard = [deck.splice(0, 1)[0]];
  await updateDoc(roomRef, {
    status:"active", winner:null, deck, discard,
    hands: { [currentRoom.players[0]]: handA, [currentRoom.players[1]]: handB },
    turn: starter
  });
});

leaveBtn.addEventListener("click", async () => {
  if (!isSpectator && currentRoom?.status === "active") {
    const oppUid = opponentUid();
    try {
      await updateDoc(roomRef, { status:"finished", winner: oppUid });
      addDoc(collection(db,"matchResults"), { game:"uno-light", players: currentRoom.players, playerNames: currentRoom.playerNames, winner: oppUid, at: serverTimestamp() }).catch(()=>{});
    } catch(e) {}
  }
  window.location.href = "lobby.html";
});

document.querySelectorAll(".reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => { if (!roomRef) return; updateDoc(roomRef, { reaction: { by: myUid, emoji: btn.dataset.emoji, ts: Date.now() } }).catch(()=>{}); });
});
