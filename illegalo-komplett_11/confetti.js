// MAP — Leichtgewichtiger Confetti-Effekt (reines Canvas, keine Library nötig).
// Wird bei Spielsiegen (Chess/Checkers/Mancala/UNO/Slot-Jackpot) aufgerufen.
const COLORS = ["#ff2e9a", "#b14aff", "#22c55e", "#eab308", "#3b82f6", "#f59e0b"];

export function fireConfetti(durationMs = 1800) {
  // MAP: respektiert prefers-reduced-motion — bei reduzierter Bewegung
  // einfach gar nix zeichnen, kein Partikel-Spam für Leute die's nich wollen.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;z-index:99990;pointer-events:none;";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.3,
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 4,
    size: 5 + Math.random() * 6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 10,
  }));

  const startTime = performance.now();
  function frame(now) {
    const elapsed = now - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
