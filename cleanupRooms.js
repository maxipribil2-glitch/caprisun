// MAP — Cleanup für alte "rooms"-Dokumente. Löscht abgeschlossene 1v1-Matches
// (status "finished") die älter als 24h sind, damit sich die Collection nicht
// unbegrenzt aufbläht. Läuft NICHT automatisch im Hintergrund (kein Cron/Cloud
// Function nötig), sondern wird manuell über den Admin-Button in admin.html
// ausgelöst. Klein & simpel gehalten statt gleich ne Cloud Function aufzusetzen.
import { app } from "./firebase-config.js";
import {
  getFirestore, collection, query, where, getDocs, deleteDoc, doc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const db = getFirestore(app);

// MAP HINWEIS: diese Query braucht einen Composite-Index in Firestore
// (status ASC + createdAt ASC auf "rooms"). Beim ERSTEN Aufruf wirft Firestore
// nen Error mit nem direkten Link zum Index-Erstellen in der Konsole — einfach
// draufklicken, ~1 Min warten, dann läuft's. Kein Bug, ist einfach wie Firestore
// bei zusammengesetzten where()-Filtern funktioniert.
export async function cleanupOldRooms(olderThanHours = 24) {
  const cutoff = Timestamp.fromMillis(Date.now() - olderThanHours * 60 * 60 * 1000);
  const q = query(
    collection(db, "rooms"),
    where("status", "==", "finished"),
    where("createdAt", "<", cutoff)
  );
  const snap = await getDocs(q);
  let deleted = 0;
  for (const docSnap of snap.docs) {
    try {
      await deleteDoc(doc(db, "rooms", docSnap.id));
      deleted++;
    } catch (e) {}
  }
  return deleted;
}
