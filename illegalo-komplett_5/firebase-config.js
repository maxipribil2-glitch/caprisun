// MAP — shared Firebase init, imported by auth.js / lobby.js / game.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";

// Your actual config from console.firebase.google.com (project: multiplayer-games-163ee)
// NOTE: this apiKey is fine to be public — Firebase web API keys are not secrets,
// access is controlled by the security rules (gc-firestore.rules / database.rules.json),
// not by hiding this key. Don't be surprised it's visible in plain JS.
const firebaseConfig = {
  apiKey: "AIzaSyA5XMksEqYw4zerqa_FNozyNRCmXtyz6gI",
  authDomain: "multiplayer-games-163ee.firebaseapp.com",
  projectId: "multiplayer-games-163ee",
  storageBucket: "multiplayer-games-163ee.firebasestorage.app",
  messagingSenderId: "17559210509",
  appId: "1:17559210509:web:b1476cf44aa1501499a344",
  measurementId: "G-0WM9GXQ0DN",
  databaseURL: "https://multiplayer-games-163ee-default-rtdb.europe-west1.firebasedatabase.app"
};

export const app = initializeApp(firebaseConfig);
