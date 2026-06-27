// MAP — admin panel: only users with isAdmin:true on their Firestore user doc get in
import { app } from "./firebase-config.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const guardEl = document.getElementById("guard");
const panelEl = document.getElementById("admin-panel");
const statusEl = document.getElementById("status-text");
const toggleBtn = document.getElementById("toggle-btn");
const logoutBtn = document.getElementById("logout-btn");

let isMaintenance = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "gc-index.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  const isAdmin = userSnap.exists() && userSnap.data().isAdmin === true;

  if (!isAdmin) {
    guardEl.textContent = "Kein Zugriff — dieser Account ist kein Admin.";
    guardEl.classList.remove("hidden");
    return;
  }

  panelEl.classList.remove("hidden");

  onSnapshot(doc(db, "config", "site"), (snap) => {
    isMaintenance = !!(snap.exists() && snap.data().maintenance);
    render();
  });
});

function render() {
  if (isMaintenance) {
    statusEl.textContent = "SERVER STATUS: OFFLINE";
    statusEl.style.color = "var(--re)";
    toggleBtn.textContent = "SERVER WIEDER EINSCHALTEN";
    toggleBtn.classList.remove("alert");
  } else {
    statusEl.textContent = "SERVER STATUS: ONLINE";
    statusEl.style.color = "var(--gr)";
    toggleBtn.textContent = "SERVER AUSSCHALTEN";
    toggleBtn.classList.add("alert");
  }
}

toggleBtn.addEventListener("click", async () => {
  await setDoc(doc(db, "config", "site"), { maintenance: !isMaintenance }, { merge: true });
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "gc-index.html";
});
