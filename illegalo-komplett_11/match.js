// MAP — Geteiltes Match-Modul: Chat (max 20 Nachrichten, live per Firestore) +
// Rematch-Bestätigung (beide müssen anklicken, nicht mehr nur einer).
// Wird von allen 5 1v1-Spielen importiert.

import {
  getFirestore, doc, updateDoc, onSnapshot, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { sfx } from "./sfx.js";

const db = getFirestore();

const MAX_CHAT = 20;

/**
 * initMatch({ roomRef, myUid, myName, db })
 * Ruft in jedem Multiplayer-Spiel auf — setzt Chat + Rematch-Confirm auf.
 * roomRef: Firestore-DocumentReference des aktiven Raums
 * myUid:   eigene User-ID
 * myName:  eigener Anzeigename
 * onRematch: callback wenn beide Rematch bestätigt haben (wird von Spiel-Datei übergeben)
 */
// MAP FEATURE: Presence-Heartbeat für alle 1v1-Games. Jeder Client schreibt alle
// 8 Sekunden seinen eigenen "lastActive"-Timestamp. Wenn der Timestamp vom Gegner
// älter als 20s ist (Tab im Hintergrund, Handy eingeschlafen, Verbindung weg),
// zeigt initMatch automatisch ein "⏸️ Gegner inaktiv..."-Badge, statt dass man nur
// rätselt warum sich nix mehr bewegt.
const INACTIVE_THRESHOLD_MS = 20_000;

function ensureInactivityBadge() {
  let el = document.getElementById("inactivity-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "inactivity-badge";
    el.style.cssText = "position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fff;padding:6px 14px;border-radius:20px;font-size:13px;z-index:60;display:none;";
    document.body.appendChild(el);
  }
  return el;
}

export function initMatch({ roomRef, myUid, myName, onRematch }) {
  const badge = ensureInactivityBadge();
  updateDoc(roomRef, { [`lastActive.${myUid}`]: Date.now() }).catch(() => {});
  const heartbeat = setInterval(() => {
    updateDoc(roomRef, { [`lastActive.${myUid}`]: Date.now() }).catch(() => {});
  }, 8000);
  window.addEventListener("beforeunload", () => clearInterval(heartbeat));

  onSnapshot(roomRef, snap => {
    if (!snap.exists()) return;
    const room = snap.data();
    const oppUid = (room.players || []).find(p => p !== myUid);
    const oppLastActive = room.lastActive?.[oppUid] || 0;
    if (oppUid && room.status === "active" && Date.now() - oppLastActive > INACTIVE_THRESHOLD_MS) {
      badge.textContent = "⏸️ " + (room.playerNames?.[oppUid] || "Gegner") + " ist grad inaktiv...";
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  });

  // ── Chat ──
  const chatInputEl = document.getElementById("chat-input");
  const chatMessagesEl = document.getElementById("chat-messages");

  // Live-Listener für Chat-Nachrichten (aus room.chat Array)
  let lastChatLen = 0;
  onSnapshot(roomRef, snap => {
    if (!snap.exists()) return;
    const room = snap.data();
    const msgs = room.chat || [];
    if (chatMessagesEl) {
      chatMessagesEl.innerHTML = msgs.map(m =>
        `<div style="color:${m.uid === myUid ? "var(--bl)" : "var(--am)"}"><span style="opacity:.6;font-size:12px;">${m.name}:</span> ${escapeHtml(m.text)}</div>`
      ).join("");
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
    // Sound bei neuer fremder Nachricht
    if (msgs.length > lastChatLen && msgs.length > 0 && msgs[msgs.length-1].uid !== myUid) {
      try { sfx.move(); } catch(e) {}
    }
    lastChatLen = msgs.length;

    // ── Rematch-Confirm state ──
    const rematchReq = room.rematchRequest;
    const rematchBtn = document.getElementById("rematch-btn");
    const pendingEl = document.getElementById("rematch-pending");
    const acceptBtn = document.getElementById("rematch-accept-btn");
    if (!rematchBtn) return;
    if (room.status !== "finished") {
      rematchBtn.classList.add("hidden");
      if (pendingEl) pendingEl.classList.add("hidden");
      if (acceptBtn) acceptBtn.classList.add("hidden");
      return;
    }
    if (!rematchReq) {
      rematchBtn.classList.remove("hidden");
      if (pendingEl) pendingEl.classList.add("hidden");
      if (acceptBtn) acceptBtn.classList.add("hidden");
    } else if (rematchReq.by === myUid) {
      rematchBtn.classList.add("hidden");
      if (pendingEl) pendingEl.classList.remove("hidden");
      if (acceptBtn) acceptBtn.classList.add("hidden");
    } else {
      // Gegner hat Rematch angefragt — Accept-Button zeigen
      rematchBtn.classList.add("hidden");
      if (pendingEl) pendingEl.classList.add("hidden");
      if (acceptBtn) acceptBtn.classList.remove("hidden");
    }
    // Beide haben accepted → Rematch starten
    if (rematchReq?.accepted === true && typeof onRematch === "function") {
      onRematch(room);
    }
  });

  window.sendChat = async () => {
    const text = chatInputEl?.value?.trim();
    if (!text) return;
    chatInputEl.value = "";
    try {
      const snap = await (await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js")).getDoc(roomRef);
      const msgs = (snap.data()?.chat || []).slice(-(MAX_CHAT-1));
      msgs.push({ uid: myUid, name: myName, text, ts: Date.now() });
      await updateDoc(roomRef, { chat: msgs });
    } catch(e) {}
  };

  window.requestRematch = async () => {
    try {
      await updateDoc(roomRef, { rematchRequest: { by: myUid, accepted: false } });
    } catch(e) {}
  };

  window.acceptRematch = async () => {
    try {
      await updateDoc(roomRef, { "rematchRequest.accepted": true });
    } catch(e) {}
  };

  // Button-Handler
  const rematchBtn = document.getElementById("rematch-btn");
  const acceptBtn = document.getElementById("rematch-accept-btn");
  if (rematchBtn) rematchBtn.addEventListener("click", window.requestRematch);
  if (acceptBtn) acceptBtn.addEventListener("click", window.acceptRematch);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
