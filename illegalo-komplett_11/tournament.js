// MAP — Turnier-Modus. Bis zu 4 Spieler, einfaches Bracket (Halbfinale → Finale).
// Firestore-Collection: "tournaments". Jeder kann ein Turnier erstellen, andere
// treten per Code bei. Der Ersteller (host) startet das Turnier, danach werden
// die Runden automatisch als normale "invites"/"rooms" abgewickelt — kein eigener
// Game-Loop, es nutzt exakt das bestehende System.
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const lobbyEl = document.getElementById("t-lobby");
const roomEl = document.getElementById("t-room");
const titleEl = document.getElementById("t-title");
const codeEl = document.getElementById("t-code");
const phaseEl = document.getElementById("t-phase");
const bracketEl = document.getElementById("t-bracket");
const startBtn = document.getElementById("t-start-btn");
const tLeaveBtn = document.getElementById("t-leave-btn");
const leaveBtn = document.getElementById("leave-btn");
const createBtn = document.getElementById("create-btn");
const joinBtn = document.getElementById("join-btn");
const joinCodeEl = document.getElementById("join-code");
const errEl = document.getElementById("t-err");
const gameSelect = document.getElementById("t-game-select");

const GAME_NAMES = {
  tictactoe: "Tic-Tac-Toe", connect4: "Vier Gewinnt",
  katapult: "Katapult Tower", pong: "Pong"
};

function gamePage(id) {
  if (id === "connect4") return "connect4.html";
  if (id === "katapult") return "katapult.html";
  if (id === "pong") return "pong.html";
  return "game.html";
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}

let myUid = null, myName = null;
let currentTId = null;
let unsub = null;

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid = user.uid;
  myName = user.displayName || user.email;
});

createBtn.addEventListener("click", async () => {
  if (!myUid) return;
  const code = genCode();
  const game = gameSelect.value;
  const tRef = doc(collection(db, "tournaments"));
  await setDoc(tRef, {
    code, game, gameName: GAME_NAMES[game] || game,
    host: myUid, hostName: myName,
    players: [{ uid: myUid, name: myName }],
    status: "waiting", // waiting → active → done
    bracket: null,
    createdAt: serverTimestamp()
  });
  joinTournament(tRef.id);
});

joinBtn.addEventListener("click", async () => {
  const code = joinCodeEl.value.trim().toUpperCase();
  if (code.length < 4) { errEl.textContent = "Code eingeben!"; return; }
  errEl.textContent = "";
  const q = query(collection(db, "tournaments"), where("code", "==", code), where("status", "==", "waiting"));
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
  const snap = await getDocs(q);
  if (snap.empty) { errEl.textContent = "Kein offenes Turnier mit diesem Code gefunden."; return; }
  const tDoc = snap.docs[0];
  const data = tDoc.data();
  if (data.players.find(p => p.uid === myUid)) { joinTournament(tDoc.id); return; }
  if (data.players.length >= 4) { errEl.textContent = "Turnier ist voll (max. 4 Spieler)."; return; }
  const newPlayers = [...data.players, { uid: myUid, name: myName }];
  await updateDoc(tDoc.ref, { players: newPlayers });
  joinTournament(tDoc.id);
});

function joinTournament(tid) {
  currentTId = tid;
  lobbyEl.style.display = "none";
  roomEl.style.display = "block";
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "tournaments", tid), snap => {
    if (!snap.exists()) { resetToLobby(); return; }
    renderTournament(snap.data(), tid);
  });
}

function renderTournament(t, tid) {
  titleEl.textContent = `${t.gameName} Turnier`;
  codeEl.textContent = `CODE: ${t.code}`;
  const isHost = t.host === myUid;

  if (t.status === "waiting") {
    phaseEl.textContent = `${t.players.length}/4 Spieler — ${isHost ? "Starte sobald alle da sind." : "Warte auf Host..."}`;
    bracketEl.innerHTML = t.players.map((p, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--bd);">
        <span style="color:var(--am);font-family:'Press Start 2P',monospace;font-size:10px;">#${i+1}</span>
        <span style="font-size:17px;">${p.name}</span>
        ${p.uid === t.host ? `<span style="font-size:12px;color:var(--pu);">HOST</span>` : ""}
        ${p.uid === myUid ? `<span style="font-size:12px;color:var(--gr);">DU</span>` : ""}
      </div>`).join("");
    startBtn.classList.toggle("hidden", !isHost || t.players.length < 2);
  } else if (t.status === "active") {
    renderBracket(t);
  } else if (t.status === "done") {
    const winner = t.bracket?.finalWinner;
    phaseEl.textContent = "Turnier beendet!";
    bracketEl.innerHTML = `<div style="text-align:center;padding:20px 0;font-size:20px;">🏆 Gewinner: <strong style="color:var(--am);">${winner?.name || "?"}</strong></div>`;
  }
}

function renderBracket(t) {
  const b = t.bracket;
  if (!b) { phaseEl.textContent = "Bracket wird erstellt..."; return; }
  phaseEl.innerHTML = `Phase: <strong style="color:var(--bl);">${b.phase === "semi" ? "Halbfinale" : "Finale"}</strong>`;
  const matchHtml = b.matches.map(m => {
    const a = m.p1 ? m.p1.name : "TBD";
    const bName = m.p2 ? m.p2.name : "TBD";
    const winnerName = m.winner ? m.winner.name : null;
    const myMatch = m.p1?.uid === myUid || m.p2?.uid === myUid;
    return `<div style="background:var(--s2);border:2px solid ${myMatch?"var(--in)":"var(--bd)"};border-radius:6px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-family:'Press Start 2P',monospace;font-size:9px;color:var(--mu);margin-bottom:8px;">${b.phase === "semi" ? "HALBFINALE" : "FINALE"} ${m.id}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:17px;${m.winner?.uid===m.p1?.uid?'color:var(--am);font-weight:700':'color:var(--tx)'};">${a}</span>
        <span style="font-size:12px;color:var(--mu);">vs</span>
        <span style="font-size:17px;${m.winner?.uid===m.p2?.uid?'color:var(--am);font-weight:700':'color:var(--tx)'};">${bName}</span>
      </div>
      ${winnerName ? `<div style="text-align:center;margin-top:8px;font-size:13px;color:var(--gr);">✅ ${winnerName} gewinnt</div>` : ""}
      ${myMatch && !winnerName && m.roomId ? `<a href="${gamePage(t.game)}?room=${m.roomId}&tournament=${currentTId}&matchId=${m.id}" class="btn" style="display:block;text-align:center;margin-top:10px;font-size:10px;">Jetzt spielen →</a>` : ""}
    </div>`;
  }).join("");
  bracketEl.innerHTML = matchHtml;
}

startBtn.addEventListener("click", async () => {
  const snap = await (await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js")).getDoc(doc(db, "tournaments", currentTId));
  if (!snap.exists()) return;
  const t = snap.data();
  const players = t.players;
  if (players.length < 2) return;
  // Shuffle Spieler fair
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  // 2 oder 4 Spieler: direkt Finale oder Halbfinale
  const isFinal = shuffled.length <= 2;
  const matches = isFinal
    ? [{ id: 1, p1: shuffled[0], p2: shuffled[1], winner: null, roomId: null }]
    : [
        { id: 1, p1: shuffled[0], p2: shuffled[1], winner: null, roomId: null },
        { id: 2, p1: shuffled[2], p2: shuffled[3] || null, winner: shuffled[3] ? null : shuffled[2], roomId: null }
      ];
  await updateDoc(doc(db, "tournaments", currentTId), {
    status: "active",
    bracket: { phase: isFinal ? "final" : "semi", matches, finalWinner: null }
  });
  // Räume für die ersten Matches erstellen
  for (const m of matches) {
    if (!m.p1 || !m.p2 || m.winner) continue;
    const roomRef = await addDoc(collection(db, "rooms"), buildTournamentRoom(t, m));
    const updatedMatches = matches.map(x => x.id === m.id ? { ...x, roomId: roomRef.id } : x);
    await updateDoc(doc(db, "tournaments", currentTId), {
      "bracket.matches": updatedMatches
    });
  }
});

function buildTournamentRoom(t, m) {
  const base = {
    game: t.game,
    players: [m.p1.uid, m.p2.uid],
    playerNames: { [m.p1.uid]: m.p1.name, [m.p2.uid]: m.p2.name },
    status: "active", winner: null, tournament: currentTId, matchId: m.id, createdAt: serverTimestamp()
  };
  if (t.game === "connect4") return { ...base, symbols: { [m.p1.uid]: "p1", [m.p2.uid]: "p2" }, board: Array(42).fill(null), turn: m.p1.uid };
  if (t.game === "pong") return { ...base, ball: { x: 180, y: 120, vx: 3.2, vy: 1.4 }, paddles: { [m.p1.uid]: { y: 95 }, [m.p2.uid]: { y: 95 } }, scores: { [m.p1.uid]: 0, [m.p2.uid]: 0 } };
  if (t.game === "katapult") return { ...base, obstacles: [{x:122,y:250,w:18,h:120,destroyed:false},{x:171,y:280,w:18,h:90,destroyed:false},{x:220,y:260,w:18,h:110,destroyed:false}], turn: m.p1.uid, shotSeq: 0, lastShot: null };
  return { ...base, symbols: { [m.p1.uid]: "X", [m.p2.uid]: "O" }, board: Array(9).fill(null), turn: m.p1.uid };
}

tLeaveBtn.addEventListener("click", async () => {
  if (unsub) { unsub(); unsub = null; }
  // Spieler aus Tournament entfernen
  try {
    const snap = await (await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js")).getDoc(doc(db, "tournaments", currentTId));
    if (snap.exists() && snap.data().status === "waiting") {
      const newPlayers = snap.data().players.filter(p => p.uid !== myUid);
      await updateDoc(doc(db, "tournaments", currentTId), { players: newPlayers });
    }
  } catch(e) {}
  resetToLobby();
});

function resetToLobby() {
  currentTId = null;
  roomEl.style.display = "none";
  lobbyEl.style.display = "block";
}

leaveBtn.addEventListener("click", () => {
  if (unsub) unsub();
  window.location.href = "lobby.html";
});
