// MAP — shared Firebase init, imported by auth.js / lobby.js / game.js / snake.js / snakeio.js / katapult.js / maintenance.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";

// Läuft über das GLEICHE Firebase-Projekt wie Illegalo (illegalo-shopzone) — kein eigenes
// Gamecenter-Projekt mehr. Realtime Database (für Online-Status, onDisconnect) läuft jetzt
// als eigene Realtime Database INNERHALB von illegalo-shopzone (Firestore + RTDB können
// problemlos im gleichen Projekt nebeneinander laufen).
// access is controlled by the security rules (firestore.rules / database.rules.json),
// not by hiding this key.
const firebaseConfig = {
  apiKey: "AIzaSyAcikzCvKFt26eX7J-3vOdZu-b1Fe0X4lk",
  authDomain: "illegalo-shopzone.firebaseapp.com",
  projectId: "illegalo-shopzone",
  storageBucket: "illegalo-shopzone.firebasestorage.app",
  messagingSenderId: "73845830641",
  appId: "1:73845830641:web:4e9e8967ac4a18b6da4a50",
  databaseURL: "https://illegalo-shopzone-default-rtdb.europe-west1.firebasedatabase.app"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
