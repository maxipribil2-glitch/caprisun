// MAP — Globaler Connection-Monitor. Läuft auf JEDER Seite die es einbindet, checkt
// online/offline Events vom Browser + reagiert wenn Firestore-Calls scheitern könnten.
// Zeigt nen eigenständigen Toast, unabhängig davon ob die jeweilige Seite selbst ein
// showToast() definiert hat oder nicht (Fallback-Toast wird bei Bedarf selbst gebaut).
function ensureFallbackToastContainer() {
  let el = document.getElementById("map-connection-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "map-connection-toast";
    el.style.cssText = "position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;z-index:100;display:none;font-family:'VT323',monospace;box-shadow:0 2px 8px rgba(0,0,0,.4);";
    document.body.appendChild(el);
  }
  return el;
}

function showConnectionToast(msg) {
  // Nutzt die Seiten-eigene showToast() falls vorhanden (sieht dann konsistent aus
  // mit dem Rest der jeweiligen Seite), sonst den eigenen Fallback-Toast hier.
  if (typeof window.showToast === "function") {
    window.showToast(msg, true);
    return;
  }
  const el = ensureFallbackToastContainer();
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = "none"; }, 3500);
}

window.addEventListener("offline", () => {
  showConnectionToast("📡 Verbindung verloren — Änderungen werden evtl. nicht gespeichert!");
});
window.addEventListener("online", () => {
  showConnectionToast("✅ Wieder online!");
});

// Direkter Check beim Laden (falls die Seite schon offline geöffnet wurde)
if (!navigator.onLine) {
  showConnectionToast("📡 Du bist offline — manche Funktionen gehen grad nicht.");
}

export { showConnectionToast };
