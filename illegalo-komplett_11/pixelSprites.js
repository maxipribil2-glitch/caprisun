// MAP — Pixel-Art-Sprite-Library. Statt Unicode-Emoji (die je nach Gerät/OS
// unterschiedlich aussehen — Apple- vs Google-Emoji-Style — und NICHT wirklich
// Pixel-Art sind) zeichnen wir hier echte Sprites als kleine Farb-Raster direkt
// auf den Canvas. Jedes Sprite ist ein 12x12-Raster aus EINZELNEN Zeichen-Codes
// (ein Zeichen = eine Zelle, "." = transparent). Skaliert sauber auf jede
// Canvas-Größe, sieht auf JEDEM Gerät exakt gleich aus.

const P = {
  R: "#dc2626", r: "#7f1d1d", // rot / dunkelrot
  G: "#22c55e", g: "#15803d", // grün / dunkelgrün
  Y: "#eab308", y: "#854d0e", // gelb / dunkelgelb
  B: "#3b82f6", b: "#1e3a8a", // blau / dunkelblau
  W: "#f8fafc", H: "#94a3b8", // weiß / grau (H = "hellgrau")
  K: "#0f172a", // fast schwarz (Outline)
  O: "#f59e0b", // orange
  S: "#e2e8f0", // silber
};

// 12x12-Raster, jede Zeile EXAKT 12 Zeichen, "." = transparent
export const SPRITES = {
  cherry: [
    "............",
    ".......g....",
    "......g.....",
    ".....g......",
    "....K..K....",
    "...KRK......",
    "..KRRKK.....",
    "..KRRRK.....",
    "..KRRRK.....",
    "...KRRK.....",
    "....KKK.....",
    "............",
  ].map(r => r.slice(0,12)),
  lemon: [
    "............",
    ".....g......",
    "...KYYK.....",
    "..KYYYK.....",
    ".KYYYYK.....",
    ".KYYYYK.....",
    ".KYYYYK.....",
    ".KYYYYK.....",
    "..KYYYK.....",
    "...KYYK.....",
    "....KKK.....",
    "............",
  ].map(r => r.slice(0,12)),
  bell: [
    "....KK......",
    "....OO......",
    "...KYK......",
    "..KYYK......",
    "..KYYK......",
    ".KYYYK......",
    ".KYYYK......",
    "KYYYYK......",
    "KKKKKK......",
    "..KYYK......",
    "...KKK......",
    "............",
  ].map(r => r.slice(0,12)),
  diamond: [
    "............",
    "...KKK......",
    "..KBBK......",
    ".KBSBK......",
    "KBBBBK......",
    "KSBBSK......",
    ".KBBBK......",
    "..KBBK......",
    "...KBK......",
    "....KK......",
    "............",
    "............",
  ].map(r => r.slice(0,12)),
  seven: [
    "............",
    ".KKKKKK.....",
    ".KWWWWK.....",
    ".......K....",
    "......K.....",
    ".....K......",
    "....K.......",
    "...K........",
    "..K.........",
    ".K..........",
    "KK..........",
    "............",
  ].map(r => r.slice(0,12)),
  star: [
    "....K.......",
    "....Y.......",
    "...YY.......",
    ".KYYYK......",
    "KYYYYYK.....",
    ".KYYYYK.....",
    "..YYYYY.....",
    ".KYKKYK.....",
    ".YK..KY.....",
    "KK....KK....",
    "............",
    "............",
  ].map(r => r.slice(0,12)),
};

/**
 * Zeichnet ein Sprite auf den Canvas-Context.
 * @param ctx CanvasRenderingContext2D
 * @param spriteName Key aus SPRITES
 * @param x, y Position (oben-links)
 * @param size Zielgröße in px (Sprite wird von 12x12 hochskaliert, pixelig dank image-rendering:pixelated)
 */
export function drawSprite(ctx, spriteName, x, y, size) {
  const sprite = SPRITES[spriteName];
  if (!sprite) return;
  const cell = size / 12;
  for (let row = 0; row < sprite.length; row++) {
    const line = sprite[row];
    for (let col = 0; col < 12; col++) {
      const key = line[col];
      if (!key || key === "." || !P[key]) continue;
      ctx.fillStyle = P[key];
      // MAP: +0.5px Overlap verhindert Sub-Pixel-Lücken zwischen Zellen beim Skalieren
      ctx.fillRect(x + col * cell, y + row * cell, cell + 0.5, cell + 0.5);
    }
  }
}

/**
 * Rendert ein Sprite als eigenständiges <canvas>-Element (für HTML statt reinem
 * Game-Canvas, z.B. die Slot-Machine-Reel-Boxen in slots.html).
 */
export function spriteCanvas(spriteName, size = 48) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  c.style.imageRendering = "pixelated";
  const ctx = c.getContext("2d");
  drawSprite(ctx, spriteName, 0, 0, size);
  return c;
}
