// MAP — Bilanz-Seite. Liest die komplette matchResults-Collection (append-only Log,
// jeder eingeloggte Gamecenter-Spieler darf alles lesen) und aggregiert client-seitig.
// Kein eigener Server/Cloud Function nötig, bei der Datenmenge einer Freundesgruppe
// völlig ausreichend.
import { app } from "./firebase-config.js";
import { renderShopAd } from "./ads.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const overallListEl = document.getElementById("overall-list");
const perGameEl = document.getElementById("per-game");
const recentListEl = document.getElementById("recent-list");
const leaveBtn = document.getElementById("leave-btn");

const GAME_NAMES = {
  tictactoe: "Tic-Tac-Toe", snakeio: "Snake.io", katapult: "Katapult Tower",
  connect4: "Vier Gewinnt", pong: "Pong"
};

renderShopAd("shop-ad");

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  loadStats();
});

async function loadStats() {
  let results = [];
  try {
    const snap = await getDocs(collection(db, "matchResults"));
    results = snap.docs.map(d => d.data());
  } catch (e) {
    overallListEl.innerHTML = `<li class="empty">Konnte Bilanz nicht laden.</li>`;
    return;
  }

  if (results.length === 0) {
    overallListEl.innerHTML = `<li class="empty">Noch keine Matches gespielt — los geht's!</li>`;
    recentListEl.innerHTML = `<li class="empty">—</li>`;
    return;
  }

  // ── Gesamtwertung: Siege pro Spieler über alle Spiele ──
  const wins = {}, names = {}, played = {};
  results.forEach(r => {
    (r.players || []).forEach(uid => {
      played[uid] = (played[uid] || 0) + 1;
      if (r.playerNames && r.playerNames[uid]) names[uid] = r.playerNames[uid];
    });
    if (r.winner && r.winner !== "draw") wins[r.winner] = (wins[r.winner] || 0) + 1;
  });

  const overall = Object.keys(played)
    .map(uid => ({ uid, name: names[uid] || "?", wins: wins[uid] || 0, played: played[uid] }))
    .sort((a, b) => b.wins - a.wins);

  overallListEl.innerHTML = overall.map(p =>
    `<li><span>${p.name}</span><span>${p.wins} Siege · ${p.played} Matches</span></li>`
  ).join("");

  // ── Pro Spiel ──
  const byGame = {};
  results.forEach(r => {
    if (!byGame[r.game]) byGame[r.game] = { wins: {}, names: {}, count: 0 };
    byGame[r.game].count++;
    (r.players || []).forEach(uid => { if (r.playerNames && r.playerNames[uid]) byGame[r.game].names[uid] = r.playerNames[uid]; });
    if (r.winner && r.winner !== "draw") byGame[r.game].wins[r.winner] = (byGame[r.game].wins[r.winner] || 0) + 1;
  });

  perGameEl.innerHTML = Object.keys(byGame).map(game => {
    const g = byGame[game];
    const top = Object.entries(g.wins).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topHtml = top.length
      ? top.map(([uid, w]) => `<li><span>${g.names[uid] || "?"}</span><span>${w} Siege</span></li>`).join("")
      : `<li class="empty">Noch keine Siege</li>`;
    return `<div style="margin-bottom:16px;">
      <div style="font-family:'Press Start 2P',monospace;font-size:10px;color:var(--bl);margin-bottom:8px;">${GAME_NAMES[game] || game} (${g.count} Matches)</div>
      <ul class="leaderboard">${topHtml}</ul>
    </div>`;
  }).join("") || `<div class="empty">Noch keine Daten.</div>`;

  // ── Letzte Matches ──
  const recent = [...results]
    .sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0))
    .slice(0, 10);

  recentListEl.innerHTML = recent.map(r => {
    const gameName = GAME_NAMES[r.game] || r.game;
    const winnerName = r.winner === "draw" ? "Unentschieden" : (r.playerNames?.[r.winner] || "?");
    const playerNames = (r.players || []).map(uid => r.playerNames?.[uid] || "?").join(" vs ");
    return `<li><span>${gameName}: ${playerNames}</span><span>${winnerName === "Unentschieden" ? "🤝" : "🏆 " + winnerName}</span></li>`;
  }).join("");
}

leaveBtn.addEventListener("click", () => { window.location.href = "lobby.html"; });
