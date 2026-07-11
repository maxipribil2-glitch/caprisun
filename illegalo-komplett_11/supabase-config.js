// MAP — Supabase-Client-Setup MIT ECHTER Firebase-Auth-Bridge.
// Firebase Auth bleibt das einzige Login-System (auth.js unverändert, gleiche
// app-Instanz aus firebase-config.js wird hier wiederverwendet). ALLES andere
// (Coins, Rooms, Scores, Matches, Invites, Roulette, Tournaments, Site-Status,
// Kill-Switch, Audit-/Voucher-Log, Online-Status) läuft über Supabase.
//
// WICHTIGES UPGRADE ggü. der ersten Version: statt offener RLS-Policies (die
// clientseitig "vertrauen" mussten) nutzt Supabase jetzt den `accessToken`-
// Callback und verifiziert den ECHTEN Firebase-ID-Token server-seitig bei jedem
// Request. Das erfordert EINMALIGES Setup in der Supabase Console:
//   Dashboard -> Authentication -> Sign In / Providers -> "Third Party Auth"
//   -> Firebase hinzufügen -> eure Firebase Project ID ("illegalo-shopzone") eintragen
// Erst DANACH kann `auth.jwt()->>'sub'` in den RLS-Policies die echte,
// verifizierte Firebase-UID liefern (nicht fälschbar über den Client mehr!).
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { app } from "./firebase-config.js";

const SUPABASE_URL = "https://ocpamumzabezoirkqalk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pVawEZhV5sEZSfoJi_V3pA_7HP4gUXd";

const firebaseAuthForSupabase = getAuth(app);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
  accessToken: async () => {
    const user = firebaseAuthForSupabase.currentUser;
    return user ? await user.getIdToken() : null;
  }
});

// Hilfsfunktion: aktuelle Firebase-UID (praktisch für Queries wo man's explizit
// braucht, z.B. .eq("firebase_uid", currentFirebaseUid()) zusätzlich zur RLS)
export function currentFirebaseUid() {
  return firebaseAuthForSupabase.currentUser?.uid || null;
}
