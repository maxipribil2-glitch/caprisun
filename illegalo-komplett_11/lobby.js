// MAP — lobby logic: who's online (Realtime Database presence, instant onDisconnect) + invites (Firestore)
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import { getBalance, formatCoins, claimDailyBonus, claimChallengeReward, ensureSupabaseUserExists } from "./gamocoin.js";
import { toggleLang, applyLang } from "./i18n.js";
window._toggleLang = toggleLang;
applyLang();
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

// MAP FIX: showToast() war komplett undefiniert in lobby.js — jede Stelle die
// versucht hat ne Erfolgs-/Fehler-Meldung zu zeigen (Daily Bonus, Invites,
// Session-Recap, etc.) is mit ReferenceError gecrasht. Gleiche Implementierung
// wie in roulette.js/shop.html übernommen für Konsistenz.
function showToast(msg, isErr=false) {
  let t = document.getElementById("toast");
  if (!t) { t=document.createElement("div"); t.id="toast"; t.style.cssText="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1d1530;border:1.5px solid;border-radius:10px;padding:10px 18px;font-size:14px;font-family:'VT323',monospace;z-index:9999;pointer-events:none;max-width:320px;text-align:center;"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.color = isErr ? "#ff3864" : "#39ff8c";
  t.style.borderColor = isErr ? "#ff3864" : "#39ff8c";
  t.style.opacity = "1";
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity="0"; }, 3200);
}

// games available on the platform — add more here as you build them
// MAP FEATURE (Punkt 4): Games werden nach "zuletzt gespielt" sortiert statt fester
// Reihenfolge. localStorage speichert Timestamps pro Game-ID, aktualisiert bei jedem
// Start. Games die noch nie gespielt wurden, bleiben in der Original-Reihenfolge
// hinten dran.
function trackGamePlayed(gameId) {
  try {
    const data = JSON.parse(localStorage.getItem("illegalo_gc_recent") || "{}");
    data[gameId] = Date.now();
    localStorage.setItem("illegalo_gc_recent", JSON.stringify(data));
  } catch (e) {}
}
function sortByRecent(list) {
  let recent = {};
  try { recent = JSON.parse(localStorage.getItem("illegalo_gc_recent") || "{}"); } catch (e) {}
  return [...list].sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0));
}
window._trackGamePlayed = trackGamePlayed; // von Game-Seiten aus aufrufbar falls gewünscht

const GAMES = [
  { id: "tictactoe", name: "Tic-Tac-Toe" },
  { id: "snakeio", name: "Snake.io (1v1)" },
  { id: "katapult", name: "Katapult Tower (1v1)" },
  { id: "connect4", name: "Vier Gewinnt (1v1)" },
  { id: "pong", name: "Pong (1v1)" },
  { id: "reaction", name: "Reaction Duell (1v1)" },
  { id: "battleship", name: "Schiffe versenken (1v1)" },
  { id: "nim", name: "Nim (1v1)" },
  { id: "quiz", name: "Quiz-Duell (1v1)" },
  { id: "chess", name: "Schach (1v1)" },
  { id: "airhockey", name: "Air Hockey (1v1)" },
  { id: "bomberman", name: "Bomber-Arena (1v1)" },
  { id: "artillery", name: "Artillery-Duell (1v1)" },
  { id: "rps", name: "Schere Stein Papier (1v1)" },
  { id: "checkers", name: "Dame (1v1)" },
  { id: "guesswho", name: "Errate-Wer (1v1)" },
  { id: "pool", name: "Pool-Duell (1v1)" },
  { id: "towerdefense", name: "Tower-Defense-Duell (1v1)" },
  { id: "wordchain", name: "Wortkette (1v1)" },
  { id: "mancala", name: "Mancala (1v1)" },
  { id: "uno", name: "UNO-Light (1v1)" },
  { id: "uno-light", name: "UNO-Light (1v1)" },
  { id: "uno", name: "UNO Light (1v1)" },
  { id: "pool", name: "Billard-Duell (1v1)" },
  { id: "guesswho", name: "Errate-Wer (1v1)" }
];

// solo arcade games — no invite needed, just play directly
const ARCADE_GAMES = [
  { id: "snake", name: "Snake", icon: "🐍", page: "snake.html" },
  { id: "breakout", name: "Breakout", icon: "🧱", page: "breakout.html" },
  { id: "roulette", name: "Roulette", icon: "🎰", page: "roulette.html" },
  { id: "2048", name: "2048", icon: "🔢", page: "game2048.html" },
  { id: "flappy", name: "Flappy", icon: "🐤", page: "flappy.html" },
  { id: "minesweeper", name: "Minesweeper", icon: "💣", page: "minesweeper.html" },
  { id: "memory", name: "Memory", icon: "🃏", page: "memory.html" },
  { id: "stacktower", name: "Stack Tower", icon: "🗼", page: "stacktower.html" },
  { id: "anagramm", name: "Anagramm-Rush", icon: "🔤", page: "anagramm.html" },
  { id: "coinrush", name: "Coin Rush", icon: "🏃", page: "coinrush.html" },
  { id: "wordle", name: "Wörterrätsel", icon: "📝", page: "wordle.html" },
  { id: "simon", name: "Simon Says", icon: "🎯", page: "simon.html" },
  { id: "typing", name: "Speed-Typing", icon: "⌨️", page: "typing.html" },
  { id: "sudoku", name: "Sudoku", icon: "🔢", page: "sudoku.html" },
  { id: "clicker", name: "Coin Clicker", icon: "🪙", page: "clicker.html" },
  { id: "pixelart", name: "Pixel-Art-Painter", icon: "🎨", page: "pixelart.html" },
  { id: "slithersolo", name: "Slither Solo", icon: "🟢", page: "slithersolo.html" },
  { id: "wham", name: "Whack-a-Mole", icon: "🐹", page: "wham.html" },
  { id: "bubbleshooter", name: "Bubble Shooter", icon: "🔵", page: "bubbleshooter.html" },
  { id: "stroop", name: "Farb-Reflex", icon: "🌈", page: "stroop.html" },
  { id: "balloonpop", name: "Balloon Pop", icon: "🎈", page: "balloonpop.html" },
  { id: "wordsearch", name: "Wortsuche", icon: "🔤", page: "wordsearch.html" },
  { id: "trivia", name: "Trivia-Marathon", icon: "🧠", page: "trivia.html" },
  { id: "trivia-marathon", name: "Trivia-Marathon", icon: "🧠", page: "trivia-marathon.html" },
  { id: "trivia", name: "Trivia-Marathon", icon: "🧠", page: "trivia.html" },
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
  trackGamePlayed(gameId);
  if (gameId === "snakeio") return "snakeio.html";
  if (gameId === "katapult") return "katapult.html";
  if (gameId === "connect4") return "connect4.html";
  if (gameId === "pong") return "pong.html";
  if (gameId === "reaction") return "reaction.html";
  if (gameId === "battleship") return "battleship.html";
  if (gameId === "nim") return "nim.html";
  if (gameId === "quiz") return "quiz.html";
  if (gameId === "chess") return "chess.html";
  if (gameId === "airhockey") return "airhockey.html";
  if (gameId === "bomberman") return "bomberman.html";
  if (gameId === "artillery") return "artillery.html";
  if (gameId === "rps") return "rps.html";
  if (gameId === "checkers") return "checkers.html";
  if (gameId === "guesswho") return "guesswho.html";
  if (gameId === "pool") return "pool.html";
  if (gameId === "towerdefense") return "towerdefense.html";
  if (gameId === "wordchain") return "wordchain.html";
  if (gameId === "mancala") return "mancala.html";
  if (gameId === "uno") return "uno.html";
  if (gameId === "uno-light") return "uno-light.html";
  if (gameId === "uno") return "uno.html";
  if (gameId === "guesswho") return "guesswho.html";
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
  if (inv.game === "reaction") {
    return {
      ...base,
      scores: { [inv.from]: 0, [inv.to]: 0 },
      round: 0,
      phase: "waiting",
      roundStartAt: null,
      lastRoundWinner: null,
      falseStartBy: null
    };
  }
  if (inv.game === "battleship") {
    return {
      ...base,
      status: "setup",
      ready: {},
      ships: {},
      shots: {},
      turn: inv.from
    };
  }
  if (inv.game === "nim") {
    return {
      ...base,
      piles: null, // wird vom Host beim ersten onSnapshot gesetzt
      turn: inv.from
    };
  }
  if (inv.game === "quiz") {
    return {
      ...base,
      scores: { [inv.from]: 0, [inv.to]: 0 },
      round: 0,
      currentQuestion: null,
      answers: {},
      roundResolved: false
    };
  }
  if (inv.game === "chess") {
    return { ...base, board: null, turn: "w", colors: null, captured: null };
  }
  if (inv.game === "airhockey") {
    return { ...base, puck: null, scoreTop: 0, scoreBottom: 0 };
  }
  if (inv.game === "guesswho") {
    return { ...base, secrets: null, round: 0, scores: { [inv.from]: 0, [inv.to]: 0 }, guesses: {}, roundResolved: false, roundStartAt: Date.now() };
  }
  if (inv.game === "pool") {
    return { ...base, balls: null, turn: inv.from, potted: {}, shootingBy: null };
  }
  if (inv.game === "towerdefense") {
    return { ...base, lanes: null };
  }
  if (inv.game === "wordchain") {
    return { ...base, chain: [], turn: inv.from, turnStartAt: Date.now() };
  }
  if (inv.game === "bomberman") {
    return { ...base, grid: null, pos: null, bombs: [], alive: null };
  }
  if (inv.game === "artillery") {
    return {
      ...base,
      terrain: null,
      hits: { [inv.from]: 0, [inv.to]: 0 },
      turn: inv.from,
      lastShot: null
    };
  }
  if (inv.game === "rps") {
    return { ...base, scores: { [inv.from]: 0, [inv.to]: 0 }, round: 0, picks: {}, roundResolved: false };
  }
  if (inv.game === "checkers") {
    return { ...base, board: null, turn: "w", colors: null };
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
let arcadeFilter = "all"; // MAP FEATURE (Punkt 1): "all" | "solo" | "1v1"

function renderArcadeGrid() {
  if (!arcadeGridEl) return;
  const sortedArcade = sortByRecent(ARCADE_GAMES);
  const sortedOnline1v1 = sortByRecent(GAMES); // nur zur Anzeige im "1v1"-Filter unten
  let html = "";
  if (arcadeFilter === "all" || arcadeFilter === "solo") {
    html += sortedArcade.map(g =>
      `<a class="arcade-card" href="${g.page}"><span class="arcade-icon">${g.icon}</span><span class="arcade-name">${g.name}</span></a>`
    ).join("");
  }
  arcadeGridEl.innerHTML = html;
  // "1v1"-Filter zeigt hier nur einen Hinweis, weil 1v1-Games über den Game-Select
  // (Invite-System) laufen, nicht über direkte Links wie die Solo-Arcade-Karten.
  if (arcadeFilter === "1v1") {
    arcadeGridEl.innerHTML = `<div class="empty" style="grid-column:1/-1;">1v1-Games wählst du oben im Dropdown "Spiel wählen" + Invite senden.</div>`;
  }
}

document.querySelectorAll(".arcade-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".arcade-filter-btn").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    arcadeFilter = btn.dataset.filter;
    renderArcadeGrid();
  });
});

// MAP FEATURE: Banner für den Einarmigen Banditen — checkt ob der tägliche Spin
// noch verfügbar ist (basiert auf gleichem lastSlotSpin-Feld wie in gamocoin.js).
// MAP FIX: läuft jetzt NACH myUid-Zuweisung im onAuthStateChanged-Callback statt
// vorher am Modul-Ende — davor war myUid noch null wenn die Funktion lief, das
// war der Grund warum der Banner beim Login nie aufgetaucht ist.
async function renderSlotMachineBanner() {
  if (!myUid) return;
  try {
    const { getDoc, doc: docRef2 } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
    const snap = await getDoc(docRef2(db, "users", myUid));
    const lastSpin = snap.exists() ? (snap.data().lastSlotSpin?.toMillis?.() || 0) : 0;
    const available = Date.now() - lastSpin >= 24*60*60*1000;
    const panel = document.getElementById("daily-bonus-panel");
    if (!panel || !available) return;
    const banner = document.createElement("a");
    banner.href = "slots.html";
    banner.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:8px 10px;background:#7c2d12;border-radius:8px;font-size:13px;text-decoration:none;color:#fff;";
    banner.innerHTML = `<span>🎰 Täglicher Spin verfügbar!</span><span style="color:#f59e0b;font-weight:bold;">Drehen →</span>`;
    panel.appendChild(banner);
  } catch (e) {}
}

renderArcadeGrid();

// MAP FEATURE (Punkt 6): "Spiel des Tages" — deterministisch nach Kalendertag
// gewählt (gleicher Tag = gleiches Spiel für alle), damit nicht immer nur die
// gleichen 3-4 Games gespielt werden.
function renderGameOfTheDay() {
  const allGames = [...ARCADE_GAMES.map(g => ({...g, kind:"solo"})), ...GAMES.map(g => ({...g, page: gamePage(g.id), icon:"⚔️", kind:"1v1"}))];
  const dayIndex = Math.floor(Date.now() / 86400000) % allGames.length;
  const pick = allGames[dayIndex];
  const panel = document.getElementById("daily-bonus-panel");
  if (!panel) return;
  const banner = document.createElement("div");
  banner.style.cssText = "margin-top:8px;padding:8px 10px;background:#1e3a8a;border-radius:8px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px;";
  banner.innerHTML = `<span>${pick.icon||"🎮"} Heute empfohlen: <strong>${pick.name}</strong></span>`;
  if (pick.kind === "solo") {
    const link = document.createElement("a");
    link.href = pick.page; link.textContent = "Spielen →";
    link.style.cssText = "color:#f59e0b;font-weight:bold;white-space:nowrap;";
    banner.appendChild(link);
  }
  panel.appendChild(banner);
}
renderGameOfTheDay();

renderShopAd("shop-ad");

// ── Custom Avatare ──
const AVATARS = ["🐱","🐶","🦊","🐻","🐼","🐨","🦁","🐯","🐸","🐙","🦄","🐲","👾","🤖","👻","💀","🎮","🔥","⚡","🌙","🍕","🎯","💎","🏆"];
const AVATAR_KEY = "illegalo_gc_avatar";

function loadAvatar() {
  return localStorage.getItem(AVATAR_KEY) || "🎮";
}
function saveAvatar(av) {
  localStorage.setItem(AVATAR_KEY, av);
  const btn = document.getElementById("avatar-btn");
  if (btn) btn.textContent = av;
}
document.getElementById("avatar-btn").textContent = loadAvatar();

window.openAvatarPicker = () => {
  const modal = document.getElementById("avatar-modal");
  const grid = document.getElementById("avatar-grid");
  if (!modal || !grid) return;
  const current = loadAvatar();
  grid.innerHTML = AVATARS.map(av => `
    <button onclick="pickAvatar('${av}')" style="background:${av===current?'var(--in)':'var(--s2)'};border:2px solid ${av===current?'var(--in)':'var(--bd)'};border-radius:8px;font-size:20px;padding:6px;cursor:pointer;box-shadow:none;transition:.1s;">
      ${av}
    </button>`).join("");
  modal.style.display = "flex";
};
window.closeAvatarPicker = () => {
  const m = document.getElementById("avatar-modal");
  if (m) m.style.display = "none";
};
window.pickAvatar = (av) => {
  saveAvatar(av);
  closeAvatarPicker();
};
window.addEventListener("click", e => {
  const m = document.getElementById("avatar-modal");
  if (m && e.target === m) closeAvatarPicker();
});

// ── Achievements ──
const ACHIEVEMENTS = [
  { id:"first_win", icon:"🏅", name:"Erster Sieg", desc:"Gewinne dein erstes Match" },
  { id:"win3", icon:"🔥", name:"On Fire", desc:"3 Siege in Folge" },
  { id:"win5", icon:"💪", name:"Dominant", desc:"5 Siege in Folge" },
  { id:"win10", icon:"👑", name:"Unaufhaltsam", desc:"10 Siege insgesamt" },
  { id:"champ", icon:"🏆", name:"Turnier-Champion", desc:"Turnier gewonnen" },
  { id:"all_games", icon:"🎮", name:"Jack of All Games", desc:"Alle Spiele gespielt" },
  { id:"social", icon:"🤝", name:"Sozialer Schmetterling", desc:"5 verschiedene Gegner" },
  { id:"nochal", icon:"⭐", name:"Daily Challenger", desc:"Daily Challenge absolviert" },
];

function checkAchievements(results) {
  if (!results.length) return;
  const myResults = results.filter(r => r.winner === myUid);
  const unlocked = JSON.parse(localStorage.getItem("illegalo_gc_achiev_" + myUid) || "[]");
  const newUnlocked = [];
  const wins = myResults.filter(r => r.winner === myUid).length;
  const played = results.filter(r => r.players?.includes(myUid)).length;
  const opponents = new Set(results.filter(r => r.players?.includes(myUid)).flatMap(r => r.players || []).filter(p => p !== myUid));
  const games = new Set(results.filter(r => r.players?.includes(myUid)).map(r => r.game));

  // Check streak
  const myHistory = results.filter(r => r.players?.includes(myUid)).sort((a,b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
  let streak = 0;
  for (const r of myHistory) { if (r.winner === myUid) streak++; else break; }

  const checks = {
    first_win: wins >= 1,
    win3: streak >= 3,
    win5: streak >= 5,
    win10: wins >= 10,
    all_games: games.size >= 5,
    social: opponents.size >= 5,
  };
  for (const [id, cond] of Object.entries(checks)) {
    if (cond && !unlocked.includes(id)) { unlocked.push(id); newUnlocked.push(id); }
  }
  if (newUnlocked.length) {
    localStorage.setItem("illegalo_gc_achiev_" + myUid, JSON.stringify(unlocked));
    newUnlocked.forEach(id => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (a) setTimeout(() => showToast(`🎖️ Achievement unlocked: ${a.icon} ${a.name}!`), 500);
    });
  }
  renderAchievements(unlocked);
}

function renderAchievements(unlocked) {
  const panel = document.getElementById("achievements-panel");
  const grid = document.getElementById("achievements-grid");
  if (!panel || !grid) return;
  panel.style.display = "block";
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const has = unlocked.includes(a.id);
    return `<div title="${a.name}: ${a.desc}" style="background:${has?'var(--s2)':'var(--bg)'};border:2px solid ${has?'var(--am)':'var(--bd)'};border-radius:10px;padding:8px 10px;text-align:center;opacity:${has?1:.35};min-width:54px;">
      <div style="font-size:20px;">${a.icon}</div>
      <div style="font-family:'Press Start 2P',monospace;font-size:6px;color:${has?'var(--am)':'var(--mu2)'};margin-top:4px;line-height:1.4;">${a.name}</div>
    </div>`;
  }).join("");
}

// ── Gamecenter Dark/Light Mode ──
(function applyGcTheme() {
  if (localStorage.getItem("gc_theme") === "light") {
    document.body.classList.add("gc-light");
    const btn = document.getElementById("gc-theme-btn");
    if (btn) btn.textContent = "🌙";
  }
})();
window.toggleGcTheme = () => {
  const isLight = document.body.classList.toggle("gc-light");
  localStorage.setItem("gc_theme", isLight ? "light" : "dark");
  const btn = document.getElementById("gc-theme-btn");
  if (btn) btn.textContent = isLight ? "🌙" : "☀️";
};

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
    <!-- MAP FEATURE: Bonus-Spin-Hinweis + Claim-Button -->
    <div class="challenge-meta" style="color:var(--am,#f59e0b);margin-top:6px;">🎰 Aufgabe geschafft? Gibt 1 Gratis-Spin am einarmigen Banditen!</div>
    <div class="challenge-meta">🔄 Reset: ${resetTime}</div>
    ${isArcade ? `<a href="${ch.page}" class="btn" style="display:inline-block;margin-top:12px;font-size:11px;">Jetzt spielen →</a>` : ""}
    <button id="claim-challenge-btn" style="display:block;margin-top:10px;font-size:11px;">✅ Aufgabe erledigt — Bonus-Spin holen</button>
    <div id="claim-challenge-status" style="font-size:11px;margin-top:6px;color:var(--sub,#888);"></div>
  </div>`;
  document.getElementById("claim-challenge-btn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("claim-challenge-status");
    const res = await claimChallengeReward(myUid);
    if (res.claimed) {
      statusEl.textContent = "🎉 Bonus-Spin gutgeschrieben! Geh zum einarmigen Banditen.";
      showToast("🎰 +1 Bonus-Spin! Nutz ihn beim Banditen.");
    } else if (res.nextClaim) {
      const hoursLeft = Math.ceil((res.nextClaim - Date.now()) / 3600000);
      statusEl.textContent = `Heute schon geclaimt — nochmal in ~${hoursLeft}h.`;
    } else if (res.reason === "killswitch_active") {
      statusEl.textContent = "🛑 Gerade nicht verfügbar — Server im Wartungsmodus.";
    } else {
      statusEl.textContent = "Ging grad nicht, versuch's nochmal.";
    }
  });
}
renderDailyChallenge();

let myUid = null;

// MAP FEATURE (Verbesserungsvorschlag Punkt 4): Inaktivitäts-Timeout — vorher
// blieben Gamecenter-Accounts unbegrenzt eingeloggt. Nach 2h ohne jede
// Interaktion (Maus/Touch/Tastatur) wird automatisch ausgeloggt, falls mal wer
// nen fremden Rechner nutzt und vergisst sich abzumelden. Deutlich großzügiger
// als das Dev Panel (30 Min), weil normale Spieler-Sessions länger dauern können.
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
let inactivityTimer = null;
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(async () => {
    if (myUid) {
      showToast("⏰ Automatisch ausgeloggt wegen Inaktivität (2h).");
      try { await signOut(auth); } catch (e) {}
      setTimeout(() => { window.location.href = "gc-index.html"; }, 1500);
    }
  }, INACTIVITY_TIMEOUT_MS);
}
["mousemove","keydown","touchstart","click","scroll"].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});
resetInactivityTimer();
let myName = null;
let redirected = false;
const declinedSeen = new Set();
let favorites = new Set(); // UIDs der Lieblingsgegner, persistiert in Firestore

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }
  myUid = user.uid;
  myName = user.displayName || user.email;
  whoEl.innerHTML = `eingeloggt als <span>${myName}</span>`;
  // MaxiCoins balance
  console.log("[lobby] eingeloggt mit UID:", myUid);
  await ensureSupabaseUserExists(myUid); // MAP FEATURE: Auto-Heal für alte Accounts
  getBalance(myUid).then(coins => {
    console.log("[lobby] getBalance() ergab:", coins, "für UID:", myUid);
    if (!sessionStorage.getItem("gc_session_start_balance")) {
      sessionStorage.setItem("gc_session_start_balance", String(coins));
    }
    const el = document.getElementById("lobby-coins");
    if (el) el.textContent = formatCoins(coins);
  });
  goOnline();
  loadFavorites();
  listenOnlineUsers();
  listenIncomingInvites();
  listenMySentInvites();
  listenLiveMatches();
  loadDailyBonusPanel();
  checkForChangelogUpdate();
  renderSlotMachineBanner();

  // MAP: falls der Daily Bonus grad im intro.html-Flow automatisch geclaimt wurde,
  // zeigen wir hier den Toast, sobald die Lobby geladen ist.
  const claimedAmount = sessionStorage.getItem("gc_daily_bonus_claimed");
  if (claimedAmount) {
    sessionStorage.removeItem("gc_daily_bonus_claimed");
    setTimeout(() => showToast(`🎁 Daily Bonus abgeholt! +${claimedAmount} 🪙`), 400);
  }
  listenActiveRooms();
  listenRouletteTables();
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

// MAP FEATURE: Live-Match-Banner. Zeigt alle laufenden Matches (status:"active")
// in der Lobby an, mit direktem Spectate-Link. Text passt sich automatisch am
// Game-Namen an: "username spielt gerade gegen username Schach! Schau live zu!"
async function loadDailyBonusPanel() {
  const contentEl = document.getElementById("daily-bonus-content");
  if (!contentEl || !myUid) return;
  try {
    const { getDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
    const snap = await getDoc(docRef(db, "users", myUid));
    const lastBonus = snap.exists() ? (snap.data().lastDailyBonus?.toMillis?.() || 0) : 0;
    const now = Date.now();
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
    const available = now - lastBonus >= TWENTY_FOUR_H;

    if (available) {
      contentEl.innerHTML = `<button id="claim-daily-btn">🎁 1000 Coins abholen</button>`;
      document.getElementById("claim-daily-btn").addEventListener("click", async () => {
        const res = await claimDailyBonus(myUid);
        if (res.claimed) {
          showToast(`🎁 Daily Bonus abgeholt! +${res.amount} 🪙`);
          contentEl.innerHTML = `<div class="empty">Nächster Bonus in 24h ⏳</div>`;
        } else if (res.reason === "too_soon") {
          // MAP: schon automatisch beim Login geclaimt worden — kein Doppel-Claim,
          // Button verschwindet einfach mit Hinweis statt Coins nochmal zu geben.
          showToast(`Schon abgeholt heute! 🎁`);
          contentEl.innerHTML = `<div class="empty">Nächster Bonus in 24h ⏳</div>`;
        } else if (res.reason === "killswitch_active") {
          showToast(`🛑 Gerade nicht verfügbar — Server im Wartungsmodus.`, true);
        }
      });
    } else {
      const hoursLeft = Math.ceil((TWENTY_FOUR_H - (now - lastBonus)) / 3600000);
      contentEl.innerHTML = `<div class="empty">Nächster Bonus in ~${hoursLeft}h ⏳</div>`;
    }
  } catch (e) {
    contentEl.innerHTML = `<div class="empty">Konnte Daily Bonus nicht laden.</div>`;
  }
}

// MAP FEATURE (Punkt 5): einfacher Changelog-Hinweis. GC_VERSION wird bei größeren
// Feature-Updates hochgezählt — falls die localStorage-Version älter ist, zeigt's
// nen Banner mit Link zu changelog.html, statt dass Updates ungesehen verpuffen.
const GC_VERSION = "2.0"; // hochzählen bei jedem größeren Update
function checkForChangelogUpdate() {
  const seenVersion = localStorage.getItem("illegalo_gc_seen_version");
  if (seenVersion === GC_VERSION) return;
  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;max-width:400px;margin:0 auto;background:#1e3a8a;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;z-index:90;display:flex;justify-content:space-between;align-items:center;gap:10px;box-shadow:0 2px 10px rgba(0,0,0,.4);";
  banner.innerHTML = `<span>🆕 Neue Games & Features sind da!</span>`;
  const btn = document.createElement("button");
  btn.textContent = "Changelog ansehen →";
  btn.style.cssText = "background:#f59e0b;border:none;color:#000;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;";
  btn.addEventListener("click", () => { window.location.href = "changelog.html"; });
  const closeBtn = document.createElement("span");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "cursor:pointer;padding:0 4px;";
  closeBtn.addEventListener("click", () => { localStorage.setItem("illegalo_gc_seen_version", GC_VERSION); banner.remove(); });
  banner.appendChild(btn); banner.appendChild(closeBtn);
  document.body.appendChild(banner);
}

function listenLiveMatches() {
  const panel = document.getElementById("live-matches-panel");
  const listEl = document.getElementById("live-matches-list");
  const q = query(collection(db, "rooms"), where("status", "==", "active"));
  onSnapshot(q, (snap) => {
    if (snap.empty) { panel.style.display = "none"; return; }
    const rows = [];
    snap.forEach((d) => {
      const room = d.data();
      // MAP HINWEIS (Punkt 6): Spectators stehen NIE in room.players (nur die 2
      // eigentlichen Match-Teilnehmer), heißt Zuschauer können hier nicht versehentlich
      // als "aktiver Spieler" auftauchen — war schon safe, Check bleibt trotzdem explizit.
      if (!room.players || room.players.length !== 2) return;
      // MAP FIX: Zombie-Rooms rausfiltern — Matches die zwar noch status:"active"
      // haben, aber schon Wochen alt sind (abgebrochen ohne "Verlassen" zu klicken,
      // Timeout-Fallback hat aus irgendeinem Grund nicht gegriffen). Ohne den Filter
      // hier zeigte die "Live"-Liste JEDEN aktiven Room, egal wie uralt — die
      // eigentliche Datenbereinigung (cleanupOldRooms) löscht nur "finished"-Rooms,
      // nicht ewig hängende "active"-Zombies.
      const createdMs = room.createdAt?.toMillis?.() || 0;
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      if (Date.now() - createdMs > THREE_HOURS) return;
      const [p1, p2] = room.players;
      const name1 = room.playerNames?.[p1] || "Spieler";
      const name2 = room.playerNames?.[p2] || "Spieler";
      const gameEntry = GAMES.find(g => g.id === room.game);
      const gameName = gameEntry ? gameEntry.name.replace(" (1v1)", "") : (room.game || "einem Spiel");
      rows.push({ roomId: d.id, game: room.game, name1, name2, gameName });
    });
    if (!rows.length) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    listEl.innerHTML = "";
    rows.forEach(r => {
      const li = document.createElement("li");
      li.style.cursor = "pointer";
      li.innerHTML = `<span>🎮 <strong>${r.name1}</strong> spielt gerade gegen <strong>${r.name2}</strong> ${r.gameName}!</span><span class="ghost" style="padding:4px 10px;font-size:11px;">Live zuschauen →</span>`;
      li.addEventListener("click", () => {
        window.location.href = `${gamePage(r.game)}?room=${r.roomId}&spectate=1`;
      });
      listEl.appendChild(li);
    });
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
  // MAP FEATURE: Roulette-Invites laufen NICHT über das rooms-System (kein 1v1-
  // Match), sondern führen beide Spieler einfach zum GLEICHEN Tisch via ?table=.
  if (inv.game === "roulette") {
    await updateDoc(doc(db, "invites", inviteId), { status: "accepted" });
    window.location.href = `roulette.html?table=${encodeURIComponent(inv.tableId || "main")}`;
    return;
  }
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
  // MAP FEATURE (Punkt 4): Session-Recap vor dem Logout — Coins verdient wird aus
  // der Differenz zur Start-Balance beim Login berechnet (robuster als nen eigener
  // Zähler den man an jeder Coin-Vergabe-Stelle im ganzen Projekt hätte pflegen müssen).
  const startBalance = parseInt(sessionStorage.getItem("gc_session_start_balance") || "0");
  const matchesPlayed = parseInt(sessionStorage.getItem("gc_session_matches") || "0");
  try {
    const currentBalance = await getBalance(myUid);
    const coinsEarned = Math.max(0, currentBalance - startBalance);
    if (coinsEarned > 0 || matchesPlayed > 0) {
      showToast(`👋 Session-Recap: ${matchesPlayed} Spiele geöffnet, ${coinsEarned} 🪙 verdient!`);
      await new Promise(r => setTimeout(r, 1600));
    }
  } catch (e) {}
  sessionStorage.removeItem("gc_session_start_balance");
  sessionStorage.removeItem("gc_session_matches");
  if (myUid) {
    await set(ref(rtdb, "status/" + myUid), { state: "offline", username: myName, last_changed: rtdbTimestamp() });
  }
  await signOut(auth);
  window.location.href = "gc-index.html";
});

// MAP FEATURE (Verbesserungsvorschlag Punkt 5): Übersicht "welche Roulette-
// Tische sind grad offen" — vorher gab's nur den globalen "main"-Tisch oder
// private Tische über Invite-Links, aber keine Möglichkeit zu sehen was schon
// existiert. Zeigt Tische die in den letzten 2h aktiv waren.
function listenRouletteTables() {
  const listEl = document.getElementById("roulette-tables-list");
  if (!listEl) return;
  const q = query(collection(db, "rouletteTables"));
  onSnapshot(q, snap => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const tables = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => {
        const created = t.createdAt?.toMillis?.() || 0;
        return Date.now() - created <= TWO_HOURS;
      })
      .sort((a,b) => Object.keys(b.players||{}).length - Object.keys(a.players||{}).length);
    if (!tables.length) {
      listEl.innerHTML = `<div class="empty">Grad keine aktiven Tische — <a href="roulette.html">selbst einen eröffnen</a>!</div>`;
      return;
    }
    listEl.innerHTML = tables.map(t => {
      const playerCount = Object.keys(t.players || {}).length;
      const phaseLabel = { betting: "🎯 Wetten offen", spinning: "🎡 Dreht grad", result: "🏆 Ergebnis" }[t.phase] || t.phase;
      return `<a href="roulette.html?table=${encodeURIComponent(t.id)}" style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px dashed var(--bd);text-decoration:none;color:var(--tx);">
        <span>🎰 ${t.id === "main" ? "Haupttisch" : t.id} (${playerCount} 👤)</span>
        <span style="color:var(--am);">${phaseLabel} →</span>
      </a>`;
    }).join("");
  }, () => { listEl.innerHTML = `<div class="empty">Konnte Tische nicht laden.</div>`; });
}

function listenActiveRooms() {
  const spectateListEl = document.getElementById("spectate-list");
  if (!spectateListEl) return;
  const q = query(collection(db, "rooms"), where("status", "==", "active"));
  onSnapshot(q, snap => {
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const rooms = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.players && !r.players.includes(myUid)) // nicht eigene Matches
      // MAP FIX: uralte "active"-Zombie-Rooms rausfiltern (gleicher Grund wie
      // in listenLiveMatches — nur wirklich aktuelle Matches gelten als "live")
      .filter(r => Date.now() - (r.createdAt?.toMillis?.() || 0) <= THREE_HOURS)
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
