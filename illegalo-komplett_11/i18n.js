// MAP — Mini i18n Modul. DE/EN Toggle, persistiert in localStorage.
// Nutzung: import { t, applyLang, toggleLang } from "./i18n.js"
// Dann data-i18n="key" auf HTML-Elemente setzen, applyLang() beim Laden rufen.

const TRANSLATIONS = {
  de: {
    // shop nav
    "nav.order": "✍️ Bestellen",
    "nav.orders": "📦 Orders",
    "nav.track": "🔍 Verfolgen",
    "nav.history": "📜 Verlauf",
    "nav.wish": "⭐ Wunschliste",
    // shop page-post
    "post.title": "Bestellung <em>aufgeben</em> ✍️",
    "post.sub": "Alles manuell eintippen — erscheint sofort im Admin Panel auf jedem Gerät.",
    "post.name": "Name *",
    "post.address": "Lieferadresse *",
    "post.items": "🛍️ Artikel",
    "post.details": "⚙️ Details",
    "post.category": "Kategorie",
    "post.payment": "Zahlung",
    "post.note": "Anmerkung",
    "post.submit": "📤 Bestellung jetzt posten",
    "post.add-item": "+ Weiteren Artikel hinzufügen",
    "post.total": "Gesamtbetrag",
    "post.reorder": "🔁 Nochmal wie letztes Mal",
    "post.clear": "Andere Person? Felder leeren",
    // track
    "track.title": "Bestellung <em>verfolgen</em> 🔍",
    "track.search": "🔍 Suchen",
    "track.placeholder": "z.B. 007 oder #007",
    // lobby
    "lobby.solo": "Retro Arcade — Solo",
    "lobby.choose": "Spiel wählen",
    "lobby.online": "Online jetzt",
    "lobby.invites": "Einladungen",
    "lobby.spectate": "👁️ Laufende Matches",
    "lobby.invite-btn": "EINLADEN",
    "lobby.accept": "ANNEHMEN",
    "lobby.decline": "ABLEHNEN",
    "lobby.no-one": "Niemand sonst online grad. Schick deinen Kumpel den Link 👀",
    "lobby.no-invites": "Keine Einladungen grad.",
    "lobby.no-matches": "Keine aktiven Matches gerade.",
    "lobby.watch": "👁️ Zuschauen",
    "lobby.stats": "📊 Bilanz",
    "lobby.daily": "🏆 Daily Challenge",
    "lobby.tournament": "⚔️ Turnier",
    // common
    "common.logout": "Logout",
    "common.leave": "Verlassen",
    "common.rematch": "🔁 Rematch anfragen",
    "common.accept-rematch": "✅ Rematch annehmen",
    "common.pending": "⏳ Warte auf Bestätigung...",
    "common.chat-placeholder": "Nachricht...",
  },
  en: {
    // shop nav
    "nav.order": "✍️ Order",
    "nav.orders": "📦 My Orders",
    "nav.track": "🔍 Track",
    "nav.history": "📜 History",
    "nav.wish": "⭐ Wishlist",
    // shop page-post
    "post.title": "Place an <em>order</em> ✍️",
    "post.sub": "Fill in manually — shows up instantly in the Admin Panel on every device.",
    "post.name": "Name *",
    "post.address": "Delivery address *",
    "post.items": "🛍️ Items",
    "post.details": "⚙️ Details",
    "post.category": "Category",
    "post.payment": "Payment",
    "post.note": "Note",
    "post.submit": "📤 Place order now",
    "post.add-item": "+ Add another item",
    "post.total": "Total",
    "post.reorder": "🔁 Same as last time",
    "post.clear": "Different person? Clear fields",
    // track
    "track.title": "Track your <em>order</em> 🔍",
    "track.search": "🔍 Search",
    "track.placeholder": "e.g. 007 or #007",
    // lobby
    "lobby.solo": "Retro Arcade — Solo",
    "lobby.choose": "Choose a game",
    "lobby.online": "Online now",
    "lobby.invites": "Invitations",
    "lobby.spectate": "👁️ Live Matches",
    "lobby.invite-btn": "INVITE",
    "lobby.accept": "ACCEPT",
    "lobby.decline": "DECLINE",
    "lobby.no-one": "Nobody else online. Send your friend the link 👀",
    "lobby.no-invites": "No invitations right now.",
    "lobby.no-matches": "No active matches right now.",
    "lobby.watch": "👁️ Watch",
    "lobby.stats": "📊 Stats",
    "lobby.daily": "🏆 Daily Challenge",
    "lobby.tournament": "⚔️ Tournament",
    // common
    "common.logout": "Logout",
    "common.leave": "Leave",
    "common.rematch": "🔁 Request rematch",
    "common.accept-rematch": "✅ Accept rematch",
    "common.pending": "⏳ Waiting for confirmation...",
    "common.chat-placeholder": "Message...",
  }
};

let currentLang = localStorage.getItem("illegalo_lang") || "de";

export function t(key) {
  return TRANSLATIONS[currentLang]?.[key] ?? TRANSLATIONS["de"]?.[key] ?? key;
}

export function getLang() { return currentLang; }

export function applyLang(lang) {
  currentLang = lang || currentLang;
  localStorage.setItem("illegalo_lang", currentLang);
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.placeholder !== undefined) el.placeholder = val;
    } else {
      el.innerHTML = val;
    }
  });
  // Update lang-toggle button text if present
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = currentLang === "de" ? "🇬🇧 EN" : "🇩🇪 DE";
}

export function toggleLang() {
  applyLang(currentLang === "de" ? "en" : "de");
}

// Auto-apply on import
applyLang(currentLang);
