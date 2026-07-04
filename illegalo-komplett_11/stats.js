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
const periodBtns = document.querySelectorAll(".period-btn");

const GAME_NAMES = {
  tictactoe: "Tic-Tac-Toe", snakeio: "Snake.io", katapult: "Katapult Tower",
  connect4: "Vier Gewinnt", pong: "Pong", reaction: "Reaction Duell",
  battleship: "Schiffe versenken"
};

renderShopAd("shop-ad");

let allResults = [];
let currentPeriod = "all";

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  loadStats();
});

periodBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    periodBtns.forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    currentPeriod = btn.dataset.period;
    renderStats(filterByPeriod(allResults, currentPeriod));
  });
});

function filterByPeriod(results, period) {
  if (period === "all") return results;
  const now = Date.now();
  const cutoffMs = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return results.filter(r => {
    const ts = r.at?.toMillis?.() || 0;
    return ts > 0 && (now - ts) <= cutoffMs;
  });
}

async function loadStats() {
  try {
    const snap = await getDocs(collection(db, "matchResults"));
    allResults = snap.docs.map(d => d.data());
  } catch (e) {
    overallListEl.innerHTML = `<li class="empty">Konnte Bilanz nicht laden.</li>`;
    return;
  }
  renderStats(filterByPeriod(allResults, currentPeriod));
}

// MAP — ELO-Berechnung (standard K=32, Startpunkte 1000)
function calcElo(results) {
  const elo = {}; // uid → elo-punkte
  const nameMap = {};
  // Ergebnisse chronologisch sortieren (älteste zuerst für korrektes ELO)
  const sorted = [...results].sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));
  sorted.forEach(r => {
    if (!r.players || r.players.length < 2 || r.winner === "draw" || !r.winner) return;
    const [p1, p2] = r.players;
    (r.players).forEach(uid => { if (!elo[uid]) elo[uid] = 1000; if (r.playerNames?.[uid]) nameMap[uid] = r.playerNames[uid]; });
    const winnerUid = r.winner;
    const loserUid = r.players.find(u => u !== winnerUid);
    if (!loserUid) return;
    const eW = elo[winnerUid]; const eL = elo[loserUid];
    const expW = 1 / (1 + Math.pow(10, (eL - eW) / 400));
    const K = 32;
    elo[winnerUid] = Math.round(eW + K * (1 - expW));
    elo[loserUid]  = Math.round(eL + K * (0 - (1 - expW)));
  });
  return Object.entries(elo)
    .map(([uid, pts]) => ({ uid, pts, name: nameMap[uid] || "?" }))
    .sort((a, b) => b.pts - a.pts);
}

function renderStats(results) {
  if (results.length === 0) {
    document.getElementById("elo-list").innerHTML = `<li class="empty">Noch keine Matches.</li>`;
    overallListEl.innerHTML = `<li class="empty">${allResults.length === 0 ? "Noch keine Matches gespielt — los geht's!" : "Kein Match in diesem Zeitraum."}</li>`;
    perGameEl.innerHTML = `<div class="empty">Keine Daten für diesen Zeitraum.</div>`;
    recentListEl.innerHTML = `<li class="empty">—</li>`;
    return;
  }

  // ── ELO-Rangliste ──
  const eloRanking = calcElo(results);
  const MEDALS = ["🥇","🥈","🥉"];
  const eloListEl = document.getElementById("elo-list");
  if (eloListEl) {
    eloListEl.innerHTML = eloRanking.map((p, i) => {
      const badge = MEDALS[i] || `#${i+1}`;
      const color = i === 0 ? "var(--am)" : i === 1 ? "#d4d4f0" : i === 2 ? "#cc8866" : "var(--mu)";
      return `<li style="color:${color}">
        <span>${badge} ${p.name}</span>
        <span style="font-family:'Press Start 2P',monospace;font-size:9px;">${p.pts} ELO</span>
      </li>`;
    }).join("") || `<li class="empty">Noch keine Daten.</li>`;
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
    .map(uid => {
      // streak berechnen (neueste zuerst)
      const history = results
        .filter(r => r.players?.includes(uid))
        .sort((a,b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
      let streak = 0;
      for (const r of history) { if (r.winner === uid) streak++; else break; }
      return { uid, name: names[uid] || "?", wins: wins[uid] || 0, played: played[uid], streak };
    })
    .sort((a, b) => b.wins - a.wins);

  overallListEl.innerHTML = overall.map(p =>
    `<li>
      <span>${p.name}</span>
      <span style="display:flex;gap:10px;align-items:center;">
        ${p.streak >= 3 ? `<span style="color:var(--re);font-size:13px;" title="Siegesserie">🔥${p.streak}</span>` : ""}
        <span style="color:var(--mu);font-size:13px;">${p.wins}W · ${p.played}M</span>
      </span>
    </li>`
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
