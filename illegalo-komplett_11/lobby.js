// MAP — lobby logic: who's online (Realtime Database presence, instant onDisconnect) + invites (Firestore)
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, onDisconnect, serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp as fsTimestamp, setDoc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const rtdb = getDatabase(app);
const db = getFirestore(app);

// games available on the platform — add more here as you build them
const GAMES = [
  { id: "tictactoe", name: "Tic-Tac-Toe" },
  { id: "snakeio", name: "Snake.io (1v1)" },
  { id: "katapult", name: "Katapult Tower (1v1)" },
  { id: "connect4", name: "Vier Gewinnt (1v1)" },
  { id: "pong", name: "Pong (1v1)" }
];

// solo arcade games — no invite needed, just play directly
const ARCADE_GAMES = [
  { id: "snake", name: "Snake", icon: "🐍", page: "snake.html" },
  { id: "breakout", name: "Breakout", icon: "🧱", page: "breakout.html" }
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
  if (gameId === "connect4") return "connect4.html";
  if (gameId === "pong") return "pong.html";
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
  if (inv.game === "connect4") {
    return {
      ...base,
      symbols: { [inv.from]: "p1", [inv.to]: "p2" },
      board: Array(42).fill(null),
      turn: inv.from
    };
  }
  if (inv.game === "pong") {
    return {
      ...base,
      ball: { x: 180, y: 120, vx: (Math.random()<0.5?-1:1)*3.2, vy: (Math.random()*2-1)*2.4 },
      paddles: {
        [inv.from]: { y: 95 },
        [inv.to]:   { y: 95 }
      },
      scores: { [inv.from]: 0, [inv.to]: 0 }
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

renderShopAd("shop-ad");

// ── Daily Challenge ──
const CHALLENGES = [
  { game: "snake", page: "snake.html", name: "Snake", rule: "Erreiche Score 15 ohne Wandtreffer — auf Speed-Level 2 ab 10 Punkten." },
  { game: "breakout", page: "breakout.html", name: "Breakout", rule: "Räum alle Steine in einer Runde weg — kein Leben verlieren!" },
  { game: "tictactoe", name: "Tic-Tac-Toe", rule: "Gewinne 3 Runden in Folge gegen denselben Gegner — Rematch nach jedem Sieg." },
  { game: "pong", name: "Pong", rule: "Gewinne mit 5:0 — kein einziger Punkt für den Gegner!" },
  { game: "connect4", name: "Vier Gewinnt", rule: "Gewinne in weniger als 7 Zügen (diagonal oder horizontal)." },
  { game: "katapult", name: "Katapult Tower", rule: "Triff die Gegner-Figur im ersten Schuss — kein Fehlschuss erlaubt." },
  { game: "snake", page: "snake.html", name: "Snake", rule: "Sammle 5 Äpfel ohne eine Wende nach rechts — nur links, oben, unten!" },
];
function renderDailyChallenge() {
  const el = document.getElementById("daily-challenge-content");
  if (!el) return;
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();
  const ch = CHALLENGES[seed % CHALLENGES.length];
  const isArcade = ch.page;
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const resetTime = tomorrow.toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit"}) + " 00:00 Uhr";
  el.innerHTML = `<div class="challenge-card">
    <div class="challenge-game">${ch.name}</div>
    <div class="challenge-rule">${ch.rule}</div>
    <div class="challenge-meta">🔄 Reset: ${resetTime}</div>
    ${isArcade ? `<a href="${ch.page}" class="btn" style="display:inline-block;margin-top:12px;font-size:11px;">Jetzt spielen →</a>` : ""}
  </div>`;
}
renderDailyChallenge();

let myUid = null;
let myName = null;
let redirected = false;
const declinedSeen = new Set();
let favorites = new Set(); // UIDs der Lieblingsgegner, persistiert in Firestore

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }
  myUid = user.uid;
  myName = user.displayName || user.email;
  whoEl.innerHTML = `eingeloggt als <span>${myName}</span>`;
  goOnline();
  loadFavorites();
  listenOnlineUsers();
  listenIncomingInvites();
  listenMySentInvites();
  listenActiveRooms();
  requestNotifPermission();
});

async function loadFavorites() {
  try {
    const snap = await getDoc(doc(db, "gcFavorites", myUid));
    favorites = new Set(snap.exists() ? (snap.data().uids || []) : []);
  } catch (e) {}
}

window.toggleFavorite = async (uid) => {
  if (favorites.has(uid)) favorites.delete(uid);
  else favorites.add(uid);
  try {
    await setDoc(doc(db, "gcFavorites", myUid), { uids: Array.from(favorites) });
  } catch (e) {}
  renderPlayerList(lastOnlineUsers);
};

// ── Push-Benachrichtigung bei Invite, auch wenn der Tab nicht aktiv ist ──
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  if ("serviceWorker" in navigator) { navigator.serviceWorker.register("sw.js").catch(() => {}); }
}
function showInviteNotif(fromName, game) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return; // schon im Tab, kein Notif nötig
  const title = "🎮 Neue Einladung!";
  const body = `${fromName} fordert dich zu ${game} raus`;
  if ("serviceWorker" in navigator && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, { body, icon: "icon-shop.png", tag: "gc-invite", renotify: true, data: { url: "lobby.html" } });
    }).catch(() => { try { new Notification(title, { body }); } catch(e) {} });
  } else {
    try { new Notification(title, { body }); } catch(e) {}
  }
}

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

let lastOnlineUsers = [];

function listenOnlineUsers() {
  const statusRef = ref(rtdb, "status");
  onValue(statusRef, (snap) => {
    const data = snap.val() || {};
    const others = Object.entries(data).filter(
      ([uid, v]) => uid !== myUid && v.state === "online"
    );
    lastOnlineUsers = others;
    renderPlayerList(others);
  });
}

function renderPlayerList(others) {
  if (others.length === 0) {
    playerListEl.innerHTML = `<li class="empty">Niemand sonst online grad. Schick deinen Kumpel den Link 👀</li>`;
    return;
  }
  // Favoriten zuerst, Rest danach alphabetisch
  const sorted = [...others].sort((a, b) => {
    const aFav = favorites.has(a[0]), bFav = favorites.has(b[0]);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return (a[1].username || "").localeCompare(b[1].username || "");
  });
  playerListEl.innerHTML = "";
  sorted.forEach(([uid, v]) => {
    const isFav = favorites.has(uid);
    const li = document.createElement("li");
    li.innerHTML = `
      <span><button class="fav-star${isFav ? " on" : ""}" data-uid="${uid}" title="Favorit">★</button><span class="dot"></span>${v.username || "Unbekannt"}</span>
      <button data-uid="${uid}" data-name="${v.username || "Unbekannt"}" class="invite-btn">EINLADEN</button>
    `;
    playerListEl.appendChild(li);
  });
  playerListEl.querySelectorAll(".invite-btn").forEach(btn => {
    btn.addEventListener("click", () => sendInvite(btn.dataset.uid, btn.dataset.name));
  });
  playerListEl.querySelectorAll(".fav-star").forEach(btn => {
    btn.addEventListener("click", () => toggleFavorite(btn.dataset.uid));
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

const notifiedInviteIds = new Set();

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
      if (!notifiedInviteIds.has(d.id)) {
        notifiedInviteIds.add(d.id);
        showInviteNotif(inv.fromName, inv.gameName);
      }
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
        // Einladung jetzt löschen — sonst würde dieser Listener bei JEDEM künftigen
        // Lobby-Besuch wieder auf "accepted" anschlagen und dich zurück ins (längst
        // beendete) Match schicken. War der eigentliche Grund, warum man aus dem
        // Multiplayer-Modus nicht mehr "raus" kam.
        deleteDoc(doc(db, "invites", d.id)).catch(() => {});
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

function listenActiveRooms() {
  const spectateListEl = document.getElementById("spectate-list");
  if (!spectateListEl) return;
  const q = query(collection(db, "rooms"), where("status", "==", "active"));
  onSnapshot(q, snap => {
    const rooms = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.players && !r.players.includes(myUid)) // nicht eigene Matches
      .slice(0, 8);
    if (!rooms.length) {
      spectateListEl.innerHTML = `<div class="empty">Keine aktiven Matches gerade.</div>`;
      return;
    }
    const GAME_NAMES = { tictactoe:"Tic-Tac-Toe", snakeio:"Snake.io", katapult:"Katapult Tower", connect4:"Vier Gewinnt", pong:"Pong" };
    spectateListEl.innerHTML = rooms.map(r => {
      const names = Object.values(r.playerNames || {}).join(" vs ") || "Unbekannte Spieler";
      const game = GAME_NAMES[r.game] || r.game || "Match";
      return `<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--bd);">
        <div>
          <div style="font-family:'Press Start 2P',monospace;font-size:9px;color:var(--bl);margin-bottom:3px;">${game}</div>
          <div style="font-size:16px;">${names}</div>
        </div>
        <a href="${gamePage(r.game)}?room=${r.id}&spectate=1" class="btn ghost" style="font-size:9px;padding:8px 12px;">👁️ Zuschauen</a>
      </li>`;
    }).join("");
  });
}
