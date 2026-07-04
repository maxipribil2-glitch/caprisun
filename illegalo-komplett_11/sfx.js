// MAP — Retro-Beeps per Web Audio API, keine Audiodateien nötig. Passt zum Pixel-Look.
let ctx;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function beep(freq, duration, type = "square", volume = 0.13) {
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
};
