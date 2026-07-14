-- ════════════════════════════════════════════════════════════════
-- Illegalo Gamecenter — Supabase Schema (ersetzt Firestore, Firebase Auth bleibt)
-- Einfach im Supabase Dashboard -> SQL Editor komplett einfügen & ausführen.
-- ════════════════════════════════════════════════════════════════

-- ── users (ersetzt Firestore users/{uid}) ──
create table if not exists users (
  firebase_uid text primary key,
  username text not null unique,
  gamocoins bigint not null default 1000,
  is_admin boolean not null default false,
  last_daily_bonus timestamptz,
  last_slot_spin timestamptz,
  free_delivery_voucher boolean not null default false,
  live_drop_session_total bigint not null default 0,
  -- MAP FEATURE: Bonus-Spins fürs einarmige-Banditen-System — getrennt vom
  -- normalen last_slot_spin (24h-Cooldown), damit Bonus-Spins (aus Daily
  -- Challenge oder gekauft) den normalen täglichen Gratis-Spin nicht anfassen.
  bonus_spins int not null default 0,
  last_challenge_claim timestamptz,
  created_at timestamptz not null default now()
);

-- ── rooms (1v1-Matches) ──
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  players text[] not null,
  player_names jsonb not null default '{}',
  status text not null default 'active',
  winner text,
  data jsonb not null default '{}', -- alles Game-spezifische (board, turn, chain, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── scores (Solo-Highscores) ──
create table if not exists scores (
  id bigint generated always as identity primary key,
  firebase_uid text not null references users(firebase_uid),
  name text not null,
  game text not null,
  score bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_scores_game_score on scores(game, score desc);

-- ── matchResults (1v1-Sieg-Historie) ──
create table if not exists match_results (
  id bigint generated always as identity primary key,
  game text not null,
  players text[] not null,
  player_names jsonb not null default '{}',
  winner text not null,
  created_at timestamptz not null default now()
);

-- ── invites ──
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  from_uid text not null,
  from_name text not null,
  to_uid text not null,
  to_name text not null,
  game text not null,
  game_name text not null,
  status text not null default 'pending',
  room_id uuid references rooms(id),
  table_id text,
  created_at timestamptz not null default now()
);

-- ── gcFavorites ──
create table if not exists gc_favorites (
  firebase_uid text primary key references users(firebase_uid),
  uids text[] not null default '{}'
);

-- ── tournaments ──
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  host text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- MAP CLEANUP (Verbesserungsvorschlag Punkt 5): roulette_tables wurde entfernt —
-- war komplett ungenutzt, Roulette läuft weiterhin über Firestore, nicht Supabase.

-- ── siteStatus (inkl. Kill Switch) ──
create table if not exists site_status (
  id text primary key default 'main',
  home boolean not null default true,
  shop boolean not null default true,
  admin boolean not null default true,
  lieferant boolean not null default true,
  schedule_enabled boolean not null default false,
  reason text,
  killswitch_at timestamptz
);
insert into site_status (id) values ('main') on conflict (id) do nothing;

-- ── gcConfig (Gamecenter-Maintenance) ──
create table if not exists gc_config (
  id text primary key default 'site',
  maintenance boolean not null default false,
  -- MAP FEATURE: Preis für den Bonus-Spin-Kauf, im Dev Panel einstellbar
  bonus_spin_price bigint not null default 1000
);
insert into gc_config (id) values ('site') on conflict (id) do nothing;

-- ── auditLog (nur Staff) ──
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  by_user text not null,
  at timestamptz not null default now()
);

-- ── voucherLog ──
create table if not exists voucher_log (
  id bigint generated always as identity primary key,
  firebase_uid text not null,
  action text not null,
  by_user text not null,
  at timestamptz not null default now()
);

-- ── errorLog ──
create table if not exists error_log (
  id bigint generated always as identity primary key,
  page text not null,
  message text not null,
  at timestamptz not null default now()
);

-- ── blockedUsers ──
create table if not exists blocked_users (
  username text primary key,
  blocked boolean not null default false
);

-- ── presence (Online-Status, ersetzt Realtime Database status/{uid}) ──
create table if not exists presence (
  firebase_uid text primary key,
  username text not null,
  state text not null default 'offline',
  last_changed timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════
-- Row Level Security — siehe supabase-config.js-Kommentar: läuft
-- NICHT über echte Auth-Verifikation (kein Supabase Auth im Spiel),
-- sondern gibt clientseitig kontrollierten Zugriff frei. Für den
-- Freundeskreis-Kontext ausreichend, aber weniger strikt als die
-- alten Firestore Rules mit echtem request.auth.uid-Check.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- RPC-Funktionen für atomare Coin-Operationen — Supabase-JS hat KEIN
-- client-seitiges Transaction-API wie Firestore's runTransaction().
-- Diese Postgres-Functions laufen serverseitig atomar (kein Double-
-- Spend, keine Race Conditions), aufgerufen via supabase.rpc(...).
-- ════════════════════════════════════════════════════════════════

-- Wette platzieren: prüft Balance + zieht ab, alles in einer Transaction
create or replace function place_bet(p_uid text, p_amount bigint)
returns jsonb language plpgsql as $$
declare
  v_balance bigint;
begin
  -- MAP FIX (Security): ohne diesen Check könnte JEDER mit nem gültigen Login
  -- über direkten RPC-Call fremde UIDs übergeben und deren Coins manipulieren.
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  select gamocoins into v_balance from users where firebase_uid = p_uid for update;
  if v_balance is null then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;
  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance);
  end if;
  update users set gamocoins = gamocoins - p_amount where firebase_uid = p_uid;
  return jsonb_build_object('ok', true, 'balance', v_balance - p_amount);
end;
$$;

create or replace function award_game_reward(p_uid text, p_amount bigint, p_is_solo boolean)
returns jsonb language plpgsql as $$
declare
  v_capped bigint := least(greatest(p_amount, 0), 500);
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if v_capped <= 0 then return jsonb_build_object('ok', false); end if;
  update users set gamocoins = gamocoins + v_capped where firebase_uid = p_uid;
  return jsonb_build_object('ok', true, 'amount', v_capped);
end;
$$;

create or replace function claim_daily_bonus(p_uid text, p_bonus_amount bigint)
returns jsonb language plpgsql as $$
declare
  v_last timestamptz;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('claimed', false, 'reason', 'unauthorized');
  end if;
  select last_daily_bonus into v_last from users where firebase_uid = p_uid for update;
  if v_last is not null and now() - v_last < interval '24 hours' then
    return jsonb_build_object('claimed', false, 'next_bonus', v_last + interval '24 hours');
  end if;
  update users set gamocoins = gamocoins + p_bonus_amount, last_daily_bonus = now() where firebase_uid = p_uid;
  return jsonb_build_object('claimed', true, 'amount', p_bonus_amount);
end;
$$;

create or replace function spin_slot_machine(p_uid text)
returns jsonb language plpgsql as $$
declare
  v_last timestamptz;
  v_is_jackpot boolean;
  v_coins_won bigint := 0;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('spun', false, 'reason', 'unauthorized');
  end if;
  select last_slot_spin into v_last from users where firebase_uid = p_uid for update;
  if v_last is not null and now() - v_last < interval '24 hours' then
    return jsonb_build_object('spun', false, 'reason', 'too_soon', 'next_spin', v_last + interval '24 hours');
  end if;
  v_is_jackpot := random() < 0.01;
  if v_is_jackpot then
    update users set last_slot_spin = now(), free_delivery_voucher = true where firebase_uid = p_uid;
    return jsonb_build_object('spun', true, 'is_jackpot', true, 'coins_won', 0, 'voucher_won', true);
  else
    v_coins_won := least(50 + floor(random()*450)::bigint, 10000);
    update users set last_slot_spin = now(), gamocoins = gamocoins + v_coins_won where firebase_uid = p_uid;
    return jsonb_build_object('spun', true, 'is_jackpot', false, 'coins_won', v_coins_won, 'voucher_won', false);
  end if;
end;
$$;

-- Staff-only: Coins für ANDERE Accounts gutschreiben/abziehen (Dev-Panel-Feature).
-- Läuft NICHT über die normale "update own user"-RLS-Policy (die erlaubt nur die
-- eigene Zeile), sondern separat mit is_illegalo_staff()-Check.
-- Coin Rush: Live-Drop-Coins, gecappt bei 500 pro Session (p_uid = auth.jwt())
create or replace function add_live_drop_coins(p_uid text, p_amount bigint)
returns jsonb language plpgsql as $$
declare
  v_session_total bigint;
  v_remaining bigint;
  v_to_credit bigint;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('credited', 0);
  end if;
  select live_drop_session_total into v_session_total from users where firebase_uid = p_uid for update;
  if v_session_total is null then return jsonb_build_object('credited', 0); end if;
  v_remaining := greatest(0, 500 - v_session_total);
  v_to_credit := least(p_amount, v_remaining);
  if v_to_credit <= 0 then return jsonb_build_object('credited', 0); end if;
  update users set gamocoins = gamocoins + v_to_credit, live_drop_session_total = v_session_total + v_to_credit
    where firebase_uid = p_uid;
  return jsonb_build_object('credited', v_to_credit);
end;
$$;

create or replace function admin_add_coins(p_target_uid text, p_amount bigint)
returns jsonb language plpgsql as $$
begin
  if not is_illegalo_staff() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  update users set gamocoins = gamocoins + p_amount where firebase_uid = p_target_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- MAP FEATURE: Daily Challenge claimen -> +1 Bonus-Spin, 1x pro Tag
create or replace function claim_challenge_reward(p_uid text)
returns jsonb language plpgsql as $$
declare
  v_last timestamptz;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('claimed', false, 'reason', 'unauthorized');
  end if;
  select last_challenge_claim into v_last from users where firebase_uid = p_uid for update;
  if v_last is not null and now() - v_last < interval '24 hours' then
    return jsonb_build_object('claimed', false, 'reason', 'too_soon', 'next_claim', v_last + interval '24 hours');
  end if;
  update users set bonus_spins = bonus_spins + 1, last_challenge_claim = now() where firebase_uid = p_uid;
  return jsonb_build_object('claimed', true);
end;
$$;

-- MAP FEATURE: Bonus-Spin für 1000 Coins kaufen (kein Tages-Limit, mehrfach möglich)
create or replace function buy_bonus_spin(p_uid text)
returns jsonb language plpgsql as $$
declare
  v_balance bigint;
  v_cost bigint;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  -- MAP FEATURE: Preis kommt jetzt aus gc_config (im Dev Panel einstellbar)
  -- statt fest verdrahtet zu sein.
  select bonus_spin_price into v_cost from gc_config where id = 'site';
  if v_cost is null then v_cost := 1000; end if;
  select gamocoins into v_balance from users where firebase_uid = p_uid for update;
  if v_balance is null then return jsonb_build_object('ok', false, 'reason', 'user_not_found'); end if;
  if v_balance < v_cost then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance, 'cost', v_cost); end if;
  update users set gamocoins = gamocoins - v_cost, bonus_spins = bonus_spins + 1 where firebase_uid = p_uid;
  return jsonb_build_object('ok', true, 'balance', v_balance - v_cost);
end;
$$;

-- MAP FEATURE: Bonus-Spin einlösen — GLEICHE Jackpot-Logik wie spin_slot_machine,
-- aber verbraucht bonus_spins statt den 24h last_slot_spin-Cooldown zu prüfen.
create or replace function use_bonus_spin(p_uid text)
returns jsonb language plpgsql as $$
declare
  v_bonus int;
  v_is_jackpot boolean;
  v_coins_won bigint := 0;
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('spun', false, 'reason', 'unauthorized');
  end if;
  select bonus_spins into v_bonus from users where firebase_uid = p_uid for update;
  if v_bonus is null or v_bonus <= 0 then
    return jsonb_build_object('spun', false, 'reason', 'no_bonus_spins');
  end if;
  v_is_jackpot := random() < 0.01;
  if v_is_jackpot then
    update users set bonus_spins = bonus_spins - 1, free_delivery_voucher = true where firebase_uid = p_uid;
    return jsonb_build_object('spun', true, 'is_jackpot', true, 'coins_won', 0, 'voucher_won', true);
  else
    v_coins_won := least(50 + floor(random()*450)::bigint, 10000);
    update users set bonus_spins = bonus_spins - 1, gamocoins = gamocoins + v_coins_won where firebase_uid = p_uid;
    return jsonb_build_object('spun', true, 'is_jackpot', false, 'coins_won', v_coins_won, 'voucher_won', false);
  end if;
end;
$$;

-- MAP FEATURE (Verbesserungsvorschlag Punkt 1): Legacy-Account-Migration mit
-- serverseitiger Deckelung — die Auto-Heal-Migration (ensureSupabaseUserExists)
-- läuft clientseitig und liest den zu migrierenden Coin-Stand aus Firestore.
-- Ohne Deckelung könnte wer über die Browser-Konsole seinen Firestore-Wert vor
-- der Migration manipulieren und sich einen unrealistischen Startwert
-- erschleichen. Diese Function deckelt auf ein plausibles Maximum.
create or replace function migrate_legacy_user(p_uid text, p_username text, p_coins bigint)
returns jsonb language plpgsql as $$
declare
  v_capped_coins bigint := least(greatest(p_coins, 0), 50000);
begin
  if p_uid != auth.jwt()->>'sub' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  insert into users (firebase_uid, username, gamocoins)
  values (p_uid, p_username, v_capped_coins)
  on conflict (firebase_uid) do nothing;
  return jsonb_build_object('ok', true, 'coins', v_capped_coins);
exception when unique_violation then
  insert into users (firebase_uid, username, gamocoins)
  values (p_uid, p_username || '_' || substr(p_uid, 1, 5), v_capped_coins)
  on conflict (firebase_uid) do nothing;
  return jsonb_build_object('ok', true, 'coins', v_capped_coins, 'username_adjusted', true);
end;
$$;

-- MAP FIX (fehlende Function, Wiederholungsbug): dev.html ruft cleanup_old_logs() im
-- Log-Cleanup-Panel auf, aber die RPC existierte nirgends im Schema -> jeder Klick auf
-- "Alte Logs jetzt aufräumen" ist mit "function does not exist" fehlgeschlagen. Staff-only
-- (gleiche Prüfung wie admin_add_coins), löscht audit_log/voucher_log/error_log
-- Einträge älter als 90 Tage und meldet die gelöschten Zeilen pro Tabelle zurück.
create or replace function cleanup_old_logs()
returns jsonb language plpgsql as $$
declare
  v_audit_deleted bigint;
  v_voucher_deleted bigint;
  v_error_deleted bigint;
begin
  if not is_illegalo_staff() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  delete from audit_log where at < now() - interval '90 days';
  get diagnostics v_audit_deleted = row_count;

  delete from voucher_log where at < now() - interval '90 days';
  get diagnostics v_voucher_deleted = row_count;

  delete from error_log where at < now() - interval '90 days';
  get diagnostics v_error_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'audit_deleted', v_audit_deleted,
    'voucher_deleted', v_voucher_deleted,
    'error_deleted', v_error_deleted
  );
end;
$$;

alter table users enable row level security;
alter table rooms enable row level security;
alter table scores enable row level security;
alter table match_results enable row level security;
alter table invites enable row level security;
alter table gc_favorites enable row level security;
alter table tournaments enable row level security;
alter table site_status enable row level security;
alter table gc_config enable row level security;
alter table audit_log enable row level security;
alter table voucher_log enable row level security;
alter table error_log enable row level security;
alter table blocked_users enable row level security;
alter table presence enable row level security;

-- ════════════════════════════════════════════════════════════════
-- ECHTE RLS-Policies — nutzen auth.jwt()->>'sub' (verifizierte Firebase-UID
-- dank der accessToken-Bridge in supabase-config.js) statt offener "public"-
-- Policies. auth.jwt()->>'email' entspricht dem alten isIllegaloStaff()-Check
-- (Firebase-ID-Tokens enthalten die Email als Claim).
-- VORAUSSETZUNG: Supabase Dashboard -> Authentication -> Third Party Auth ->
-- Firebase hinzufügen (Project ID: illegalo-shopzone), SONST liefert
-- auth.jwt() nichts und ALLES hier lehnt automatisch ab (fail-closed, sicher
-- aber dann funktioniert nix bis das Setup gemacht ist).
-- ════════════════════════════════════════════════════════════════

create or replace function is_illegalo_staff() returns boolean language sql stable as $$
  select coalesce((auth.jwt()->>'email') like '%@illegalo.local', false);
$$;

-- users: jeder eingeloggte darf lesen, nur die EIGENE Zeile schreiben.
-- is_admin darf sich per RLS praktisch nicht selbst ändern (siehe Trigger unten).
create policy "read users" on users for select using (auth.jwt() is not null);
create policy "insert own user" on users for insert with check (firebase_uid = auth.jwt()->>'sub');
create policy "update own user" on users for update
  using (firebase_uid = auth.jwt()->>'sub')
  with check (firebase_uid = auth.jwt()->>'sub');

-- Trigger statt RLS für den is_admin-Schutz (robuster als OLD/NEW-Vergleich in RLS)
create or replace function prevent_self_admin_escalation() returns trigger language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and not is_illegalo_staff() then
    new.is_admin := old.is_admin; -- stillschweigend zurücksetzen, kein Fehler nötig
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_admin_escalation on users;
create trigger trg_prevent_admin_escalation before update on users
  for each row execute function prevent_self_admin_escalation();

-- rooms: nur Spieler die selbst mitspielen dürfen lesen/schreiben
create policy "rooms for players" on rooms for select
  using (auth.jwt()->>'sub' = any(players));
create policy "create room as player" on rooms for insert
  with check (auth.jwt()->>'sub' = any(players));
create policy "update room as player" on rooms for update
  using (auth.jwt()->>'sub' = any(players));

-- scores: jeder eingeloggte darf lesen, nur eigene Scores einreichen
create policy "read scores" on scores for select using (auth.jwt() is not null);
create policy "insert own score" on scores for insert
  with check (firebase_uid = auth.jwt()->>'sub' and score >= 0 and score < 100000);

-- match_results: jeder eingeloggte darf lesen, nur wenn man selbst mitgespielt hat
create policy "read match_results" on match_results for select using (auth.jwt() is not null);
create policy "insert match_result as player" on match_results for insert
  with check (auth.jwt()->>'sub' = any(players));

-- invites: nur Absender/Empfänger dürfen lesen/ändern, nur Absender darf erstellen
create policy "read own invites" on invites for select
  using (auth.jwt()->>'sub' in (from_uid, to_uid));
create policy "create invite as sender" on invites for insert
  with check (from_uid = auth.jwt()->>'sub');
create policy "update own invites" on invites for update
  using (auth.jwt()->>'sub' in (from_uid, to_uid));
create policy "delete own invites" on invites for delete
  using (auth.jwt()->>'sub' in (from_uid, to_uid));

-- gc_favorites: nur die eigene Zeile
create policy "own favorites" on gc_favorites for all
  using (firebase_uid = auth.jwt()->>'sub')
  with check (firebase_uid = auth.jwt()->>'sub');

-- tournaments: jeder eingeloggte darf lesen/updaten, nur Host darf erstellen
create policy "read tournaments" on tournaments for select using (auth.jwt() is not null);
create policy "create tournament as host" on tournaments for insert
  with check (host = auth.jwt()->>'sub');
create policy "update tournaments" on tournaments for update using (auth.jwt() is not null);

-- site_status: öffentlich lesbar (auch ohne Login, z.B. für Kill-Switch-Anzeige
-- auf ausgeloggten Seiten), nur Staff darf schreiben
create policy "read site_status public" on site_status for select using (true);
create policy "staff write site_status" on site_status for all
  using (is_illegalo_staff()) with check (is_illegalo_staff());

-- gc_config: öffentlich lesbar, nur Staff darf schreiben
create policy "read gc_config public" on gc_config for select using (true);
create policy "staff write gc_config" on gc_config for all
  using (is_illegalo_staff()) with check (is_illegalo_staff());

-- audit_log: öffentlich lesbar (Transparenz), nur Staff darf schreiben
create policy "read audit_log public" on audit_log for select using (true);
create policy "staff write audit_log" on audit_log for insert with check (is_illegalo_staff());

-- voucher_log: jeder eingeloggte darf lesen, nur EIGENE Einträge schreiben
create policy "read voucher_log" on voucher_log for select using (auth.jwt() is not null);
create policy "insert own voucher_log" on voucher_log for insert
  with check (firebase_uid = auth.jwt()->>'sub');

-- error_log: öffentlich (auch für ausgeloggte/fehlerhafte Sessions wichtig)
create policy "read error_log public" on error_log for select using (true);
create policy "write error_log public" on error_log for insert with check (true);

-- blocked_users: öffentlich lesbar, nur Staff darf schreiben
create policy "read blocked_users public" on blocked_users for select using (true);
create policy "staff write blocked_users" on blocked_users for all
  using (is_illegalo_staff()) with check (is_illegalo_staff());

-- presence: jeder eingeloggte darf alle sehen (wer online ist), nur die eigene
-- Zeile schreiben
create policy "read presence" on presence for select using (auth.jwt() is not null);
create policy "write own presence" on presence for all
  using (firebase_uid = auth.jwt()->>'sub')
  with check (firebase_uid = auth.jwt()->>'sub');

-- Realtime aktivieren für Live-Sync (ersetzt Firestore onSnapshot)
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table invites;
alter publication supabase_realtime add table site_status;
alter publication supabase_realtime add table gc_config;
alter publication supabase_realtime add table presence;
alter publication supabase_realtime add table users;
