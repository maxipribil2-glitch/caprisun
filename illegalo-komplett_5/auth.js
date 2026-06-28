// MAP — login & register, username+password only (no email shown to the user).
// Firebase Auth technically needs an email, so we quietly turn the username into
// one behind the scenes (e.g. "maxi" -> "maxi@mpgames.local"). The user never sees this.
import { app } from "./firebase-config.js";
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

  try {
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    await updateProfile(cred.user, { displayName: username });
    await setDoc(doc(db, "users", cred.user.uid), {
      username,
      createdAt: serverTimestamp()
    });
    // redirect happens in onAuthStateChanged below
  } catch (err) {
    showError(friendlyError(err));
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "lobby.html";
  }
});
