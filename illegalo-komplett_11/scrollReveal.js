// MAP — Scroll-Reveal-System. Macht aus normalen Panels/Kacheln was "krasses"
// beim Scrollen: schweben mit leichtem 3D-Tilt + Staffelung rein, statt einfach
// nur dazustehen. Wiederverwendbar auf jeder Gamecenter-Seite.
//
// Nutzung: initScrollReveal() einmal beim Laden aufrufen (beobachtet .panel
// automatisch), und initScrollReveal(container, selector) nach jedem
// dynamischen Re-Render eines Grids (z.B. renderArcadeGrid()) erneut aufrufen,
// damit NEU hinzugekommene Elemente auch erfasst werden.

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("revealed");
      observer.unobserve(entry.target); // einmal reingeschwebt reicht, nicht bei jedem Scroll neu
    }
  });
}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

export function initScrollReveal(container = document, selector = ".panel, .arcade-card, .chart-card, .ctrl-card, .sc") {
  const els = container.querySelectorAll(selector);
  els.forEach((el, i) => {
    if (el.classList.contains("scroll-reveal")) return; // schon erfasst
    el.classList.add("scroll-reveal");
    // MAP: Staffelung innerhalb eines Grids (z.B. Arcade-Kacheln) — jede Kachel
    // etwas später als die vorherige, für den "Kachel für Kachel"-Effekt.
    // Modulo verhindert dass sehr lange Listen am Ende ewig warten müssten.
    el.style.transitionDelay = `${(i % 10) * 60}ms`;
    observer.observe(el);
  });
}

// Läuft automatisch beim Import, deckt alles ab was schon beim initialen
// Laden im DOM steht (z.B. die festen Panels in lobby.html).
// MAP FEATURE (Verbesserungsvorschlag Punkt 3): Seiten-Übergänge abfangen —
// beim Klick auf nen internen Link (z.B. Arcade-Kachel in der Lobby) fadet die
// Seite kurz aus, BEVOR zur neuen Seite navigiert wird, statt hart rüberzuspringen.
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || link.target === "_blank") return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // sofort navigieren, kein Fade
  e.preventDefault();
  document.body.style.transition = "opacity .18s ease";
  document.body.style.opacity = "0";
  setTimeout(() => { window.location.href = href; }, 180);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initScrollReveal());
} else {
  initScrollReveal();
}
