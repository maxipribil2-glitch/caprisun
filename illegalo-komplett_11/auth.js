// MAP — login & register, username+password only (no email shown to the user).
// Firebase Auth technically needs an email, so we quietly turn the username into
// one behind the scenes (e.g. "maxi" -> "maxi@mpgames.local"). The user never sees this.
import { app } from "./firebase-config.js";
import { supabase } from "./supabase-config.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const showRegisterBtn = document.getElementById("show-register");
const showLoginBtn = document.getElementById("show-login");
const errorBox = document.getElementById("error-box");

function showError(msg) {
  errorBox.textContent = msg;
}

function usernameToEmail(username) {
  const safe = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return `${safe}@mpgames.local`;
}

function friendlyError(err) {
  const code = err.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Login passt nicht — Username oder Passwort falsch.";
  }
  if (code.includes("email-already-in-use")) return "Dieser Username ist schon vergeben.";
  if (code.includes("weak-password")) return "Passwort zu kurz — min. 6 Zeichen.";
  if (code.includes("invalid-email")) return "Username darf nur Buchstaben, Zahlen und _ enthalten.";
  return "Was lief schief: " + (err.message || code);
}

showRegisterBtn.addEventListener("click", () => {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");
  showError("");
});

showLoginBtn.addEventListener("click", () => {
  registerForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  showError("");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    sessionStorage.setItem("gc_just_logged_in", "1"); // MAP: markiert frischen Login-Vorgang
    sessionStorage.setItem("gc_login_username", username); // MAP FIX: username für Intro-Redirect sichern (war vorher außerhalb des Scopes von onAuthStateChanged nicht erreichbar -> ReferenceError bei jedem Login)
    // redirect happens in onAuthStateChanged below
  } catch (err) {
    showError(friendlyError(err));
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;

  if (username.length < 2) {
    showError("Username muss mind. 2 Zeichen haben.");
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showError("Nur Buchstaben, Zahlen und _ im Username erlaubt.");
    return;
  }

  // MAP FIX (Coin-Verteilungs-Bug!): vorher feuerte onAuthStateChanged SOFORT
  // sobald createUserWithEmailAndPassword() durchlief — noch BEVOR der setDoc()
  // Call weiter unten (der die 1000 Start-Coins schreibt) fertig war. Der
  // Listener hat dann direkt window.location.href gesetzt, was den laufenden
  // Firestore-Write mitten drin abbrechen konnte -> manche neue Accounts kriegten
  // nie ihren users-Doc bzw. nie die Coins. Fix: Flag verhindert dass der separate
  // Listener vorzeitig redirected, register() macht den Redirect jetzt SELBST
  // erst nachdem setDoc() wirklich fertig ist.
  sessionStorage.setItem("gc_auth_write_pending", "1");

  try {
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    await updateProfile(cred.user, { displayName: username });
    await setDoc(doc(db, "users", cred.user.uid), {
      username,
      gamocoins: 1000,
      lastDailyBonus: null,
      createdAt: serverTimestamp()
    });
    // MAP FIX: Supabase-Row beim Registrieren MIT anlegen — sonst existiert der
    // Account nur in Firestore, aber Supabase (wo Coins/Rewards/Slot Machine
    // mittlerweile laufen) findet nie ne passende Zeile -> Kontostand zeigt für
    // immer 0, weil die Zeile schlicht nie existiert hat.
    const idToken = await cred.user.getIdToken();
    await supabase.realtime.setAuth(idToken);
    const { error: supaErr } = await supabase.from("users").insert({
      firebase_uid: cred.user.uid,
      username,
      gamocoins: 1000
    });
    if (supaErr) console.error("[auth] Supabase-User-Anlage fehlgeschlagen:", supaErr);
    sessionStorage.removeItem("gc_auth_write_pending");
    const params = new URLSearchParams({ u: username, new: "1" });
    window.location.href = "intro.html?" + params.toString();
  } catch (err) {
    sessionStorage.removeItem("gc_auth_write_pending");
    showError(friendlyError(err));
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    // MAP FIX: falls grad ne Registrierung läuft und der setDoc() Call noch nicht
    // fertig ist, NICHT vorzeitig redirecten — register() übernimmt das selbst.
    if (sessionStorage.getItem("gc_auth_write_pending") === "1") return;
    // MAP FIX: Intro-Screen (Matrix-Animation + Welcome-Text) läuft nur, wenn der
    // User GERADE eben eingeloggt/registriert hat (Flag aus signIn/register-Handler).
    // Falls schon ne bestehende Session da ist und man einfach auf gc-index.html
    // landet, geht's direkt zur Lobby ohne die Animation nochmal abzuspulen.
    const justLoggedIn = sessionStorage.getItem("gc_just_logged_in") === "1";
    const isNewUser = sessionStorage.getItem("gc_new_user") === "1";
    const loginUsername = sessionStorage.getItem("gc_login_username") || (user.displayName || "");
    sessionStorage.removeItem("gc_just_logged_in");
    sessionStorage.removeItem("gc_new_user");
    sessionStorage.removeItem("gc_login_username");
    if (justLoggedIn) {
      const params = new URLSearchParams({ u: loginUsername, new: isNewUser ? "1" : "0" });
      window.location.href = "intro.html?" + params.toString();
    } else {
      window.location.href = "lobby.html";
    }
  }
});
