// MAP — maintenance check. Listens live for the admin kill-switch (config/site.maintenance)
// and covers the whole page with the "server is down" message if it's on.
// Public read access is needed here so even logged-out visitors on gc-index.html see it.
import { app } from "./firebase-config.js";
import {
  getFirestore, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const db = getFirestore(app);

onSnapshot(doc(db, "config", "site"), (snap) => {
  const data = snap.exists() ? snap.data() : null;
  const isDown = !!(data && data.maintenance);
  let overlay = document.getElementById("maintenance-overlay");

  if (isDown && !overlay) {
    overlay = document.createElement("div");
    overlay.id = "maintenance-overlay";
    overlay.innerHTML = `
      <div class="page-title" style="justify-content:center; font-size:18px;"><span class="accent-dot" style="background:var(--re);"></span>Server offline</div>
      <p>Sorry, die Server sind gerade aus.<br><span class="sub">Schau später nochmal vorbei.</span></p>
    `;
    document.body.appendChild(overlay);
  } else if (!isDown && overlay) {
    overlay.remove();
  }
}, () => {
  // if the read fails (e.g. rules not deployed yet), just don't block the page
});
