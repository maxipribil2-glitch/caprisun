// Illegalo Maintenance Mini-Game — Chrome-Dino-Style Runner
window.initDinoGame = function(canvasId, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.inited) return;
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
