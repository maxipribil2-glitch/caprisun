// MAP — Retro-Beeps per Web Audio API, keine Audiodateien nötig. Passt zum Pixel-Look.
let ctx;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// MAP FEATURE: globaler Mute-Toggle. localStorage-Flag gilt für ALLE Games, nicht nur
// pro Seite. beep() checkt das Flag zuerst, bevor überhaupt ein Ton erzeugt wird.
function isMuted() { return localStorage.getItem("illegalo_gc_muted") === "1"; }
export function toggleMute() {
  const muted = !isMuted();
  localStorage.setItem("illegalo_gc_muted", muted ? "1" : "0");
  return muted;
}
export function getMuted() { return isMuted(); }

function beep(freq, duration, type = "square", volume = 0.13) {
  if (isMuted()) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.stop(c.currentTime + duration);
  } catch (e) {}
}

export const sfx = {
  move:  () => beep(440, 0.07),
  hit:   () => beep(220, 0.06),
  eat:   () => beep(660, 0.06),
  brick: () => beep(740, 0.05),
  fire:  () => beep(150, 0.10, "sawtooth"),
  score: () => beep(880, 0.08),
  win:   () => { beep(523, 0.12); setTimeout(() => beep(659, 0.12), 110); setTimeout(() => beep(784, 0.2), 220); },
  lose:  () => { beep(330, 0.15); setTimeout(() => beep(220, 0.22), 140); },
  draw:  () => beep(330, 0.2),
  // MAP: eigener "Cha-Ching"-Sound für Coin-Drops (Coin Rush, Idle-Clicker) statt
  // dem generischen sfx.hit() — zwei schnelle helle Töne, klingt nach Kasse/Münze.
  coin:  () => { beep(1046, 0.05, "square", 0.1); setTimeout(() => beep(1568, 0.07, "square", 0.1), 60); },
};
