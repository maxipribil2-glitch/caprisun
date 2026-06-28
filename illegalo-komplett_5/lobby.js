// MAP — lobby logic: who's online (Realtime Database presence) + invites (Firestore)
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, onDisconnect, serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp as fsTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const rtdb = getDatabase(app);
const db = getFirestore(app);

// games available on the platform — add more here as you build them
const GAMES = [
  { id: "tictactoe", name: "Tic-Tac-Toe" },
  { id: "snakeio", name: "Snake.io (1v1)" },
  { id: "katapult", name: "Katapult Tower (1v1)" }
];

// solo arcade games — no invite needed, just play directly
const ARCADE_GAMES = [
  { id: "snake", name: "Snake", icon: "🐍", page: "snake.html" }
];

const SNAKEIO_GRID = 20;
const KATA_CANVAS_W = 360, KATA_CANVAS_H = 420, KATA_FLOOR_OFFSET = 16;

function buildKatapultObstacles() {
  // 3 fixed pillar positions (symmetric), random-ish heights each match for variety
  const baseY = KATA_CANVAS_H - KATA_FLOOR_OFFSET;
  const xs = [122, 171, 220];
  return xs.map(x => {
    const h = 55 + Math.floor(Math.random() * 70); // 55–125
    return { x, y: baseY - h, w: 18, h, destroyed: false };
  });
}

function randomFoodCell(grid, occupied) {
  const occSet = new Set(occupied.map(p => p.x + "," + p.y));
  let x, y, tries = 0;
  do {
    x = Math.floor(Math.random() * grid.w);
    y = Math.floor(Math.random() * grid.h);
    tries++;
  } while (occSet.has(x + "," + y) && tries < 200);
  return { x, y };
}

function gamePage(gameId) {
  if (gameId === "snakeio") return "snakeio.html";
  if (gameId === "katapult") return "katapult.html";
  return "game.html";
}

function buildRoomData(inv) {
  const base = {
    game: inv.game,
    players: [inv.from, inv.to],
    playerNames: { [inv.from]: inv.fromName, [inv.to]: inv.toName },
    status: "active",
    winner: null,
    createdAt: fsTimestamp()
  };
  if (inv.game === "snakeio") {
    const grid = { w: SNAKEIO_GRID, h: SNAKEIO_GRID };
    const bodyA = [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }];
    const bodyB = [{ x: 15, y: 10 }, { x: 16, y: 10 }, { x: 17, y: 10 }];
    return {
      ...base,
      grid,
      food: randomFoodCell(grid, [...bodyA, ...bodyB]),
      snakes: {
        [inv.from]: { body: bodyA, dir: "right", nextDir: "right", alive: true, score: 0 },
        [inv.to]:   { body: bodyB, dir: "left",  nextDir: "left",  alive: true, score: 0 }
      },
      tick: 0
    };
  }
  if (inv.game === "katapult") {
    return {
      ...base,
      obstacles: buildKatapultObstacles(),
      turn: inv.from,
      shotSeq: 0,
      lastShot: null
    };
  }
  // default: tictactoe
  return {
    ...base,
    symbols: { [inv.from]: "X", [inv.to]: "O" },
    board: Array(9).fill(null),
    turn: inv.from
  };
}

const whoEl = document.getElementById("who");
const playerListEl = document.getElementById("player-list");
const incomingEl = document.getElementById("incoming-invites");
const waitingEl = document.getElementById("waiting-banner");
const gameSelect = document.getElementById("game-select");
const logoutBtn = document.getElementById("logout-btn");

GAMES.forEach(g => {
  const opt = document.createElement("option");
  opt.value = g.id;
  opt.textContent = g.name;
  gameSelect.appendChild(opt);
});

const arcadeGridEl = document.getElementById("arcade-grid");
if (arcadeGridEl) {
  arcadeGridEl.innerHTML = ARCADE_GAMES.map(g =>
    `<a class="arcade-card" href="${g.page}"><span class="arcade-icon">${g.icon}</span><span class="arcade-name">${g.name}</span></a>`
  ).join("");
}

let myUid = null;
let myName = null;
let redirected = false;
const declinedSeen = new Set();

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }
  myUid = user.uid;
  myName = user.displayName || user.email;
  whoEl.innerHTML = `eingeloggt als <span>${myName}</span>`;
  goOnline();
  listenOnlineUsers();
  listenIncomingInvites();
  listenMySentInvites();
});

function goOnline() {
  const myStatusRef = ref(rtdb, "status/" + myUid);
  const connectedRef = ref(rtdb, ".info/connected");
  onValue(connectedRef, (snap) => {
    if (snap.val() === false) return;
    onDisconnect(myStatusRef).set({ state: "offline", username: myName, last_changed: rtdbTimestamp() })
      .then(() => {
        set(myStatusRef, { state: "online", username: myName, last_changed: rtdbTimestamp() });
      });
  });
}

function listenOnlineUsers() {
  const statusRef = ref(rtdb, "status");
  onValue(statusRef, (snap) => {
    const data = snap.val() || {};
    const others = Object.entries(data).filter(
      ([uid, v]) => uid !== myUid && v.state === "online"
    );
    if (others.length === 0) {
      playerListEl.innerHTML = `<li class="empty">Niemand sonst online grad. Schick deinen Kumpel den Link 👀</li>`;
      return;
    }
    playerListEl.innerHTML = "";
    others.forEach(([uid, v]) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span><span class="dot"></span>${v.username || "Unbekannt"}</span>
        <button data-uid="${uid}" data-name="${v.username || "Unbekannt"}" class="invite-btn">EINLADEN</button>
      `;
      playerListEl.appendChild(li);
    });
    playerListEl.querySelectorAll(".invite-btn").forEach(btn => {
      btn.addEventListener("click", () => sendInvite(btn.dataset.uid, btn.dataset.name));
    });
  });
}

async function sendInvite(toUid, toName) {
  const gameId = gameSelect.value;
  const gameName = GAMES.find(g => g.id === gameId)?.name || gameId;
  await addDoc(collection(db, "invites"), {
    from: myUid,
    fromName: myName,
    to: toUid,
    toName: toName,
    game: gameId,
    gameName: gameName,
    status: "pending",
    roomId: null,
    createdAt: fsTimestamp()
  });
}

function listenIncomingInvites() {
  const q = query(collection(db, "invites"), where("to", "==", myUid), where("status", "==", "pending"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      incomingEl.innerHTML = `<div class="empty">Keine Einladungen grad.</div>`;
      return;
    }
    incomingEl.innerHTML = "";
    snap.forEach((d) => {
      const inv = d.data();
      const card = document.createElement("div");
      card.className = "invite-card";
      card.innerHTML = `
        <div class="row"><strong>${inv.fromName}</strong> lädt dich ein zu <strong>${inv.gameName}</strong></div>
        <div class="invite-actions">
          <button class="accept-btn">ANNEHMEN</button>
          <button class="ghost decline-btn">ABLEHNEN</button>
        </div>
      `;
      card.querySelector(".accept-btn").addEventListener("click", () => acceptInvite(d.id, inv));
      card.querySelector(".decline-btn").addEventListener("click", () => declineInvite(d.id));
      incomingEl.appendChild(card);
    });
  });
}

async function acceptInvite(inviteId, inv) {
  const roomRef = await addDoc(collection(db, "rooms"), buildRoomData(inv));
  await updateDoc(doc(db, "invites", inviteId), { status: "accepted", roomId: roomRef.id });
  window.location.href = `${gamePage(inv.game)}?room=${roomRef.id}`;
}

async function declineInvite(inviteId) {
  await updateDoc(doc(db, "invites", inviteId), { status: "declined" });
}

function listenMySentInvites() {
  const q = query(collection(db, "invites"), where("from", "==", myUid));
  onSnapshot(q, (snap) => {
    let pendingCount = 0;
    snap.forEach((d) => {
      const inv = d.data();
      if (inv.status === "pending") {
        pendingCount++;
      } else if (inv.status === "accepted" && inv.roomId && !redirected) {
        redirected = true;
        window.location.href = `${gamePage(inv.game)}?room=${inv.roomId}`;
      } else if (inv.status === "declined" && !declinedSeen.has(d.id)) {
        declinedSeen.add(d.id);
        waitingEl.textContent = `${inv.toName} hat deine Einladung abgelehnt.`;
        waitingEl.classList.remove("hidden");
        setTimeout(() => waitingEl.classList.add("hidden"), 4000);
        deleteDoc(doc(db, "invites", d.id)).catch(() => {});
      }
    });
    if (pendingCount > 0) {
      waitingEl.textContent = "Warte auf Antwort auf deine Einladung...";
      waitingEl.classList.remove("hidden");
    } else if (!waitingEl.dataset.locked) {
      waitingEl.classList.add("hidden");
    }
  });
}

logoutBtn.addEventListener("click", async () => {
  if (myUid) {
    await set(ref(rtdb, "status/" + myUid), { state: "offline", username: myName, last_changed: rtdbTimestamp() });
  }
  await signOut(auth);
  window.location.href = "gc-index.html";
});
