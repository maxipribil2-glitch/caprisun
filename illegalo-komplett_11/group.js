// MAP — Gruppenbestellung: mehrere Leute sammeln Items in einem gemeinsamen Firestore-
// Dokument (groupOrders/{code}), bevor einer von ihnen die fertige Liste als EINE normale
// Bestellung in die "orders"-Collection postet (gleicher Mechanismus wie shop.html selbst,
// inkl. fortlaufender Bestellnummer über die gleiche Transaction).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc,
  collection, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAcikzCvKFt26eX7J-3vOdZu-b1Fe0X4lk",
  authDomain:        "illegalo-shopzone.firebaseapp.com",
  projectId:         "illegalo-shopzone",
  storageBucket:     "illegalo-shopzone.firebasestorage.app",
  messagingSenderId: "73845830641",
  appId:             "1:73845830641:web:4e9e8967ac4a18b6da4a50"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const startScreen = document.getElementById("start-screen");
const groupScreen = document.getElementById("group-screen");
const codeDisplay = document.getElementById("code-display");
const itemsListEl = document.getElementById("group-items-list");
const totalEl = document.getElementById("group-total");
const toastEl = document.getElementById("toast");

let currentCode = null;
let currentGroup = null;
let unsub = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function fmt(n) { return "€" + (Number(n) || 0).toFixed(2).replace(".", ","); }

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne I/O/0/1, vermeidet Verwechslung
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

window.createGroup = async () => {
  const code = randomCode();
  try {
    await setDoc(doc(db, "groupOrders", code), {
      items: [], status: "open", createdAt: serverTimestamp()
    });
    enterGroup(code);
    showToast("Gruppenbestellung erstellt! 🎉");
  } catch (e) { showToast("Fehler beim Erstellen 😕"); }
};

window.joinGroup = async () => {
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (!code) return showToast("Bitte einen Code eingeben.");
  try {
    const snap = await getDoc(doc(db, "groupOrders", code));
    if (!snap.exists()) return showToast("Diesen Code gibt's nicht 🤔");
    if (snap.data().status !== "open") return showToast("Diese Gruppenbestellung ist schon abgeschickt.");
    enterGroup(code);
  } catch (e) { showToast("Fehler beim Beitreten 😕"); }
};

function enterGroup(code) {
  currentCode = code;
  startScreen.style.display = "none";
  groupScreen.style.display = "block";
  codeDisplay.textContent = code;
  const url = new URL(location.href);
  url.searchParams.set("code", code);
  history.replaceState({}, "", url);

  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "groupOrders", code), (snap) => {
    if (!snap.exists() || snap.data().status !== "open") {
      itemsListEl.innerHTML = `<div class="empty">Diese Gruppenbestellung wurde bereits abgeschickt oder existiert nicht mehr.</div>`;
      totalEl.textContent = fmt(0);
      return;
    }
    currentGroup = snap.data();
    renderItems();
  });

  const savedName = localStorage.getItem("illegalo_group_myname");
  if (savedName) document.getElementById("g-myname").value = savedName;
}

function renderItems() {
  const items = currentGroup.items || [];
  if (!items.length) {
    itemsListEl.innerHTML = `<div class="empty">Noch nix da — leg los!</div>`;
    totalEl.textContent = fmt(0);
    return;
  }
  itemsListEl.innerHTML = items.map((it, i) => `
    <div class="gitem">
      <div class="gitem-main">
        <div class="gitem-name">${it.name} ${it.qty > 1 ? `×${it.qty}` : ""}</div>
        <div class="gitem-meta">von ${it.addedBy || "?"}</div>
      </div>
      <div class="gitem-price">${fmt(it.price * it.qty)}</div>
      <button class="gitem-del" data-idx="${i}" title="Entfernen">✕</button>
    </div>
  `).join("");
  itemsListEl.querySelectorAll(".gitem-del").forEach(btn => {
    btn.addEventListener("click", () => removeItem(parseInt(btn.dataset.idx)));
  });
  const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  totalEl.textContent = fmt(total);
}

window.addGroupItem = async () => {
  const myName = document.getElementById("g-myname").value.trim();
  const name = document.getElementById("g-item-name").value.trim();
  const qty = Math.max(1, parseInt(document.getElementById("g-item-qty").value) || 1);
  const price = Math.max(0, parseFloat(document.getElementById("g-item-price").value) || 0);
  if (!myName) return showToast("Bitte deinen Namen eintragen.");
  if (!name) return showToast("Bitte einen Artikelnamen eintragen.");

  localStorage.setItem("illegalo_group_myname", myName);
  const newItem = { name, qty, price, icon: "📦", addedBy: myName };
  try {
    await updateDoc(doc(db, "groupOrders", currentCode), {
      items: [...(currentGroup.items || []), newItem]
    });
    document.getElementById("g-item-name").value = "";
    document.getElementById("g-item-qty").value = "1";
    document.getElementById("g-item-price").value = "";
    showToast(`${name} hinzugefügt ✅`);
  } catch (e) { showToast("Fehler beim Hinzufügen 😕"); }
};

async function removeItem(idx) {
  const items = [...(currentGroup.items || [])];
  items.splice(idx, 1);
  try {
    await updateDoc(doc(db, "groupOrders", currentCode), { items });
  } catch (e) { showToast("Fehler beim Entfernen 😕"); }
}

window.copyGroupLink = () => {
  const url = location.origin + location.pathname + "?code=" + currentCode;
  navigator.clipboard.writeText(url).then(() => showToast("Link kopiert! 📋")).catch(() => showToast("Code: " + currentCode));
};

async function getNextOrderNumber() {
  const counterRef = doc(db, "meta", "orderCounter");
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data().value || 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { value: next });
      return next;
    });
  } catch (e) { return null; }
}

let submitting = false;
window.submitGroupOrder = async () => {
  if (submitting) return;
  const items = currentGroup.items || [];
  if (!items.length) return showToast("Erst Items hinzufügen!");
  const name = document.getElementById("g-final-name").value.trim();
  const address = document.getElementById("g-final-address").value.trim();
  if (!name || !address) return showToast("Name & Adresse für die Lieferung eintragen.");

  submitting = true;
  try {
    const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
    const orderNumber = await getNextOrderNumber();
    await setDoc(doc(collection(db, "orders")), {
      orderNumber,
      date: new Date().toISOString(),
      created: serverTimestamp(),
      customer: { name, address },
      items: items.map(it => ({ name: it.name, icon: it.icon || "📦", qty: it.qty, price: it.price })),
      total,
      cat: "Sonstiges",
      pay: "💵 Bar",
      ship: "Abholung",
      note: `Gruppenbestellung (Code ${currentCode}): ${[...new Set(items.map(it => it.addedBy))].join(", ")}`,
      status: "Verarbeitung",
    });
    await deleteDoc(doc(db, "groupOrders", currentCode));
    showToast("Bestellung abgeschickt! 🚀");
    setTimeout(() => { window.location.href = "shop.html"; }, 1200);
  } catch (e) {
    showToast("Fehler beim Absenden 😕");
    submitting = false;
  }
};

// ── Direkt joinen, falls per Link mit ?code=... aufgerufen ──
const urlCode = new URLSearchParams(location.search).get("code");
if (urlCode) {
  document.getElementById("join-code-input").value = urlCode.toUpperCase();
  window.joinGroup();
}
