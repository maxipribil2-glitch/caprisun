// MAP — Cross-Promo-Banner zurück zum Illegalo Shop. Rein kosmetisch, kein Tracking,
// kein Cookie, nix — einfach Werbung von uns für uns mit zufälligem Spruch pro Pageload.
const SLOGANS = [
  "Hungrig vom Zocken? Illegalo liefert, bevor du Game Over bist. 🍕",
  "GG WP. Jetzt aber Bestellung aufgeben. 🔥",
  "Mehr Skill brauchst du nicht — mehr Snacks schon. 🛍️",
  "Dein Magen knurrt lauter als der Gegner schreit. 🛒",
  "Real Ones bestellen bei Illegalo. 💯",
  "K.O.? Bestell dir was, bevor du Rage quittest. 🎮",
  "Grad gewonnen? Bestell dir was zur Feier. 🏆",
  "Sponsored by Illegalo — hungrige Gamer sind schlechte Gamer. 😤",
  "Loot dir was Echtes statt Pixel-Loot. 🔥",
  "Skip die Werbung? Nie. Skip den Hunger? Auch nie. 🍔",
  "Bestellung &gt; Highscore. Fight mich. 🛍️",
  "Illegalo: weil Bock auf Essen &gt; Bock auf Verlieren. 😮‍💨",
  "Pause machen, bestellen, weiter zocken. So einfach. 📦",
  "Du bist hier am Grinden — wir liefern das Futter dazu. 🛵",
  "Kein Rage Quit mehr ohne vollen Magen. Illegalo. 🍔",
];

export function renderShopAd(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const slogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
  el.innerHTML = `
    <span class="shop-ad-tag">AD</span>
    <div class="shop-ad-text">${slogan}</div>
    <a href="shop.html" class="shop-ad-cta">Zum Shop →</a>
  `;
}
