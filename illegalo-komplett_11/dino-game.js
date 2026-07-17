// Illegalo Maintenance Mini-Game — Chrome-Dino-Style Runner

// Öffnungszeiten-Check: Nur Dienstag & Donnerstag, 7–16 Uhr offen (wenn aktiviert)
window.isWithinSchedule = function() {
  const now = new Date();
  const day = now.getDay(); // 0=So,1=Mo,2=Di,3=Mi,4=Do,5=Fr,6=Sa
  const hour = now.getHours() + now.getMinutes()/60;
  const openDays = [2, 4]; // Dienstag, Donnerstag
  if (!openDays.includes(day)) return false;
  return hour >= 7 && hour < 16;
};

// Shared reason → maintenance text mapping (genutzt von shop/admin/lieferant)
window.applyMaintenanceReason = function(reason, defaults) {
  const REASONS = {
    ferien:        { icon: "🌴", title: "Wir machen <span style=\"color:#10b981\">Ferien!</span>", sub: "Wir sind gerade im Urlaub und nicht erreichbar. Schau später wieder vorbei — bis dahin: viel Spaß beim Dino! 🦖" },
    krank:         { icon: "🤒", title: "Der Admin ist <span style=\"color:#ef4444\">krank</span>", sub: "Sorry, gerade ist leider niemand verfügbar. Versuch's später noch einmal!" },
    geschlossen:   { icon: "🕐", title: "Gerade <span style=\"color:#f59e0b\">geschlossen</span>", sub: "Geöffnet: Dienstag & Donnerstag, 7–16 Uhr. Schau dann wieder vorbei — bis dahin: viel Spaß beim Dino! 🦖" },
    mittagspause:  { icon: "🍽️", title: "Sorry, heute keine <span style=\"color:#3b82f6\">Mittagspause!</span>", sub: "Wir sind kurz nicht erreichbar. Schau später wieder vorbei — bis dahin: viel Spaß beim Dino! 🦖" },
    // MAP FEATURE: Kill-Switch-Reason — bewusst KEIN Dino-Game hier, weil ein
    // "alles ist down"-Notfall was anderes signalisieren soll als der normale
    // "grad geschlossen, spiel solang Dino"-Vibe der anderen Reasons.
    killswitch:    { icon: "404", title: "File not found", sub: "The site configured at this address does not contain the requested file.<br><br>If this is your site, make sure that the filename case matches the URL as well as any file permissions.<br>For root URLs (like <code>http://example.com/</code>) you must provide an <code>index.html</code> file.<br><br><a href=\"https://rosebidzogoo-collab.github.io/coursera-test/site\" target=\"_blank\" rel=\"noopener\" style=\"color:#0969da;\">Read the full documentation</a> for more information about using <strong>GitHub Pages</strong>." },
  };
  const t = REASONS[reason] || defaults;
  // MAP FEATURE: Kontakt-Email auf ALLEN Wartungs-Screens außer Kill Switch —
  // der Kill Switch soll ja bewusst wie "hier existiert gar nix" wirken (404-
  // Illusion), da würd ne Kontakt-Email die Illusion brechen. Bei den anderen
  // Gründen (Ferien/Krank/Geschlossen/Mittagspause/generisch) ist Kontakt-Info
  // aber sinnvoll, damit Leute bei Fragen/Bugs wissen wo sie sich melden können.
  if (reason !== "killswitch") {
    // MAP FIX (Verbesserungsvorschlag Punkt 2): Email kommt jetzt aus
    // window.__supportEmail (von jeder Seite aus siteStatus.supportEmail
    // gesetzt), statt hart im Code zu stehen — zentral im Dev Panel änderbar.
    // MAP FIX (Punkt 1): Email-Adresse wird per JS zusammengebaut statt als
    // fertiger mailto-Link im HTML zu stehen — simple Hürde gegen Adress-
    // Scraper-Bots, ohne Nutzerfreundlichkeit für echte Menschen einzubüßen.
    const email = window.__supportEmail || "illegalo.helpcenter@gmx.de";
    const emailLinkId = "maint-contact-" + Math.random().toString(36).slice(2,8);
    t.sub = (t.sub || "") + `<br><br><span style="font-size:.85em;opacity:.85;">Wir sind leider zurzeit nicht verfügbar. Bei Nachfrage oder Bug Reports bitte bei dieser Email-Adresse melden: <a id="${emailLinkId}" href="#" style="color:inherit;text-decoration:underline;">${email}</a></span>`;
    setTimeout(() => {
      const el = document.getElementById(emailLinkId);
      if (el) el.href = "mailto:" + email;
    }, 0);
  }
  const iconEl = document.getElementById("maint-icon");
  const titleEl = document.getElementById("maint-title");
  const subEl = document.getElementById("maint-sub");
  if (iconEl) iconEl.textContent = t.icon;
  if (titleEl) titleEl.innerHTML = t.title;
  if (subEl) subEl.innerHTML = t.sub;

  // MAP FEATURE: Kill Switch sieht jetzt aus wie ne ECHTE GitHub-Pages-404-Seite
  // (weißer Hintergrund, schwarze Schrift, exakter GitHub-Wortlaut) — soll wie
  // "hier gibt's einfach nix" wirken statt "wir sind kurz down, komm später
  // wieder". Wichtig: die URL in der Adressleiste kann NICHT versteckt werden,
  // das is ne Browser-Sicherheitsfunktion, kein Website-Code kann das.
  const screenEl = document.getElementById("maintenance-screen");
  if (screenEl) screenEl.classList.toggle("killswitch-404-look", reason === "killswitch");

  // Dino-Canvas verstecken bei Kill Switch, sonst normal sichtbar lassen
  document.querySelectorAll("canvas[id*='dino']").forEach(c => {
    c.style.display = (reason === "killswitch") ? "none" : "";
  });

  // MAP FEATURE (Verbesserungsvorschlag Punkt 3): Favicon beim Kill Switch auf
  // "leer" umschalten (1x1 transparentes Pixel) — kleiner Bruch in der 404-
  // Illusion war sonst dass der Browser-Tab noch das Illegalo-Icon zeigt,
  // während die Seite selbst wie ne komplett tote GitHub-404-Seite aussieht.
  let faviconEl = document.querySelector("link[rel~='icon']");
  if (!faviconEl) {
    faviconEl = document.createElement("link");
    faviconEl.rel = "icon";
    document.head.appendChild(faviconEl);
  }
  if (reason === "killswitch") {
    if (!faviconEl.dataset.original) faviconEl.dataset.original = faviconEl.href || "";
    faviconEl.href = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  } else if (faviconEl.dataset.original !== undefined) {
    faviconEl.href = faviconEl.dataset.original;
  }
};

window.initDinoGame = function(canvasId, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.inited) return;
  // MAP FIX: falls der Kill Switch aktiv is, wurde das Canvas grad von
  // applyMaintenanceReason() auf display:none gesetzt — dann brauchen wir das
  // Dino-Game gar nicht erst starten (kein Sinn ein unsichtbares Canvas zu rendern).
  if (canvas.style.display === "none") return;
  canvas.dataset.inited = "1";
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const groundY = H - 28;
  const accent = color || "#10b981";

  let player = { x: 26, y: groundY - 28, w: 24, h: 28, vy: 0, jumping: false };
  let obstacles = [];
  let speed = 4, score = 0, best = parseInt(localStorage.getItem("illegalo_dino_best")||"0"), gameOver = false, started = false, lastSpawn = 0;

  function reset() {
    player.y = groundY - player.h; player.vy = 0; player.jumping = false;
    obstacles = []; speed = 4; score = 0; gameOver = false; lastSpawn = 0; started = true;
  }
  function jump() {
    if (!started || gameOver) { reset(); return; }
    if (!player.jumping) { player.vy = -8.5; player.jumping = true; }
  }

  document.addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); jump(); } });
  canvas.addEventListener("pointerdown", e => { e.preventDefault(); jump(); });

  function loop() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "#2a3555";
    ctx.beginPath(); ctx.moveTo(0, groundY + player.h); ctx.lineTo(W, groundY + player.h); ctx.stroke();

    if (started && !gameOver) {
      player.vy += 0.5; player.y += player.vy;
      if (player.y > groundY - player.h) { player.y = groundY - player.h; player.vy = 0; player.jumping = false; }

      lastSpawn++;
      if (lastSpawn > Math.max(28, 60 - speed * 2)) {
        obstacles.push({ x: W, w: 12 + Math.random()*10, h: 18 + Math.random()*22 });
        lastSpawn = 0;
      }
      obstacles.forEach(o => o.x -= speed);
      obstacles = obstacles.filter(o => o.x + o.w > 0);

      obstacles.forEach(o => {
        if (player.x < o.x + o.w && player.x + player.w > o.x && player.y + player.h > groundY - o.h) {
          gameOver = true;
          if (Math.floor(score) > best) { best = Math.floor(score); localStorage.setItem("illegalo_dino_best", best); }
        }
      });

      score += 0.12; speed += 0.0025;
    }

    ctx.fillStyle = accent;
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.fillStyle = "#ef4444";
    obstacles.forEach(o => ctx.fillRect(o.x, groundY - o.h, o.w, o.h));

    ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace"; ctx.textAlign = "right";
    ctx.fillText("Score " + Math.floor(score) + "   Best " + best, W - 8, 16);
    ctx.textAlign = "left";

    if (!started) {
      ctx.fillStyle = "#f1f5f9"; ctx.font = "bold 13px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Tippen oder Leertaste zum Starten", W/2, H/2);
      ctx.textAlign = "left";
    } else if (gameOver) {
      ctx.fillStyle = "#ef4444"; ctx.font = "bold 15px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Game Over! Score: " + Math.floor(score), W/2, H/2 - 8);
      ctx.fillStyle = "#94a3b8"; ctx.font = "11px Inter, sans-serif";
      ctx.fillText("Tippen zum Neustart", W/2, H/2 + 14);
      ctx.textAlign = "left";
    }

    requestAnimationFrame(loop);
  }
  loop();
};
