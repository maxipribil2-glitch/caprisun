// MAP — ELO-Rangliste für das Illegalo Gamecenter.
// Berechnet ELO-Ratings aus der matchResults-Collection (append-only Match-Log).
// Kein separater ELO-Store in Firestore — alles client-seitig kalkuliert aus den Ergebnissen.
// Start-ELO: 1000, K-Faktor: 32 (Standard Chess beginner), Draw = 0.5 für beide.
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const GAME_NAMES = {
  tictactoe: "Tic-Tac-Toe", snakeio: "Snake.io", katapult: "Katapult Tower",
  connect4: "Vier Gewinnt", pong: "Pong"
};
const START_ELO = 1000;
const K = 32;

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  loadElo();
});

document.getElementById("leave-btn").addEventListener("click", () => {
  window.location.href = "lobby.html";
});

async function loadElo() {
  let results = [];
  try {
    const snap = await getDocs(collection(db, "matchResults"));
    results = snap.docs.map(d => d.data()).filter(r => r.game && r.players?.length === 2);
  } catch (e) {
    document.getElementById("elo-overall").innerHTML = `<li class="empty">Konnte Daten nicht laden.</li>`;
    return;
  }

  if (!results.length) {
    document.getElementById("elo-overall").innerHTML = `<li class="empty">Noch keine Matches — go zocken! 🎮</li>`;
    return;
  }

  // Sort by at timestamp (oldest first for correct ELO progression)
  results.sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));

  // Build ELO ratings overall + per game
  const elo = {}; // uid → rating
  const eloByGame = {}; // gameId → uid → rating
  const names = {}; // uid → displayName
  const gamesPlayed = {}; // uid → count

  function getElo(map, uid) { return map[uid] ?? START_ELO; }

  function applyResult(map, p1, p2, winner) {
    const r1 = getElo(map, p1), r2 = getElo(map, p2);
    const e1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
    const e2 = 1 - e1;
    let s1, s2;
    if (winner === "draw") { s1 = 0.5; s2 = 0.5; }
    else if (winner === p1) { s1 = 1; s2 = 0; }
    else { s1 = 0; s2 = 1; }
    map[p1] = Math.round(r1 + K * (s1 - e1));
    map[p2] = Math.round(r2 + K * (s2 - e2));
  }

  results.forEach(r => {
    const [p1, p2] = r.players;
    if (r.playerNames) {
      if (r.playerNames[p1]) names[p1] = r.playerNames[p1];
      if (r.playerNames[p2]) names[p2] = r.playerNames[p2];
    }
    gamesPlayed[p1] = (gamesPlayed[p1] || 0) + 1;
    gamesPlayed[p2] = (gamesPlayed[p2] || 0) + 1;
    applyResult(elo, p1, p2, r.winner);
    if (!eloByGame[r.game]) eloByGame[r.game] = {};
    applyResult(eloByGame[r.game], p1, p2, r.winner);
  });

  // ── Gesamt-ELO Tabelle ──
  const overallRanked = Object.entries(elo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  document.getElementById("elo-overall").innerHTML = overallRanked.length
    ? overallRanked.map(([uid, rating], i) =>
        `<li>
          <span>${i < 3 ? ["🥇","🥈","🥉"][i] : `#${i+1}`} ${names[uid] || "?"} <span style="font-size:12px;color:var(--mu)">(${gamesPlayed[uid] || 0} Matches)</span></span>
          <span style="font-family:'Press Start 2P',monospace;font-size:11px;color:var(--am)">${rating}</span>
        </li>`
      ).join("")
    : `<li class="empty">Keine Daten.</li>`;

  // ── Pro-Spiel Tabs ──
  const games = Object.keys(eloByGame);
  const tabsEl = document.getElementById("game-tabs");
  const perGameEl = document.getElementById("elo-per-game");
  tabsEl.innerHTML = games.map(g =>
    `<button onclick="showGameElo('${g}')" style="background:var(--s2);border:2px solid var(--bd);border-radius:4px;color:var(--tx);font-family:'Press Start 2P',monospace;font-size:9px;padding:7px 10px;cursor:pointer;" id="gtab-${g}">${GAME_NAMES[g] || g}</button>`
  ).join("");
  window._eloByGame = eloByGame;
  window._eloNames = names;
  window._eloGamesPlayed = gamesPlayed;

  window.showGameElo = (gameId) => {
    document.querySelectorAll("[id^='gtab-']").forEach(b => b.style.borderColor = "var(--bd)");
    const tab = document.getElementById("gtab-" + gameId);
    if (tab) tab.style.borderColor = "var(--bl)";
    const ranked = Object.entries(window._eloByGame[gameId] || {})
      .sort((a,b) => b[1]-a[1]).slice(0,10);
    perGameEl.innerHTML = ranked.length
      ? ranked.map(([uid, rating], i) =>
          `<li>
            <span>${i<3?["🥇","🥈","🥉"][i]:`#${i+1}`} ${window._eloNames[uid]||"?"}</span>
            <span style="font-family:'Press Start 2P',monospace;font-size:11px;color:var(--am)">${rating}</span>
          </li>`
        ).join("")
      : `<li class="empty">Keine Daten.</li>`;
  };

  if (games.length) window.showGameElo(games[0]);

  // ── Letzte Matches ──
  const recent = [...results].reverse().slice(0, 8);
  document.getElementById("elo-recent").innerHTML = recent.map(r => {
    const [p1, p2] = r.players;
    const n1 = r.playerNames?.[p1] || "?", n2 = r.playerNames?.[p2] || "?";
    const wName = r.winner === "draw" ? "🤝 Unentschieden" : `🏆 ${r.playerNames?.[r.winner] || "?"}`;
    const gameName = GAME_NAMES[r.game] || r.game;
    const ts = r.at?.toDate ? r.at.toDate().toLocaleDateString("de-DE") : "";
    return `<li style="flex-direction:column;align-items:flex-start;gap:3px;">
      <span style="font-family:'Press Start 2P',monospace;font-size:9px;color:var(--bl);">${gameName}</span>
      <span>${n1} vs ${n2} · ${wName}</span>
      <span style="font-size:12px;color:var(--mu)">${ts}</span>
    </li>`;
  }).join("");
}
