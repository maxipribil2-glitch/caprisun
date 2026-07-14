// MAP — maintenance check. Listens live for the admin kill-switch (gcConfig/site.maintenance)
// and covers the whole page with the "server is down" message if it's on. Läuft jetzt über
// die gleiche Firestore wie Illegalo (illegalo-shopzone), kein eigenes Projekt mehr.
// Public read access is needed here so even logged-out visitors on gc-index.html see it.
import { app } from "./firebase-config.js";
import {
  getFirestore, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const db = getFirestore(app);

onSnapshot(doc(db, "gcConfig", "site"), (snap) => {
  const data = snap.exists() ? snap.data() : null;
  const isDown = !!(data && data.maintenance);
  let overlay = document.getElementById("maintenance-overlay");

  if (isDown && !overlay) {
    overlay = document.createElement("div");
    overlay.id = "maintenance-overlay";
    // MAP FEATURE: sieht jetzt aus wie ne echte GitHub-Pages-404-Seite (weißer
    // Hintergrund, GitHub-Wortlaut) statt "Server Down" — soll wie "hier gibt's
    // einfach nix" wirken. Inline-Styles hier weil dieses Overlay komplett
    // dynamisch per JS erzeugt wird (kein fixes HTML-Element wie bei den
    // anderen Seiten), CSS-Klassen aus style.css würden hier nicht automatisch greifen.
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f6f8fa;color:#1f2328;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
    overlay.innerHTML = `
      <div style="font-size:4rem;font-weight:300;margin-bottom:1rem;">404</div>
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:1.2rem;">File not found</div>
      <p style="color:#59636e;font-size:0.95rem;max-width:480px;line-height:1.6;">
        The site configured at this address does not contain the requested file.<br><br>
        If this is your site, make sure that the filename case matches the URL as well as any file permissions.<br>
        For root URLs (like <code style="background:#eff1f3;padding:2px 5px;border-radius:4px;">http://example.com/</code>) you must provide an <code style="background:#eff1f3;padding:2px 5px;border-radius:4px;">index.html</code> file.<br><br>
        <a href="https://rosebidzogoo-collab.github.io/coursera-test/site" target="_blank" rel="noopener" style="color:#0969da;">Read the full documentation</a> for more information about using <strong>GitHub Pages</strong>.
      </p>
    `;
    document.body.appendChild(overlay);
  } else if (!isDown && overlay) {
    overlay.remove();
  }
}, () => {
  // if the read fails (e.g. rules not deployed yet), just don't block the page
});
