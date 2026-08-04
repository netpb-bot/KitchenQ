-- Pickleball club app — initial schema.
-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type member_role  as enum ('owner', 'admin', 'member');
create type skill_tier   as enum ('beginner', 'novice', 'bridge', 'advanced', 'pro');
create type session_status as enum ('draft', 'live', 'ended');
create type player_status as enum ('waiting', 'playing', 'resting', 'left');
create type payment_status as enum ('unpaid', 'partial', 'paid');
create type rsvp_status  as enum ('going', 'maybe', 'out');

-- ---------------------------------------------------------------- tables

create table clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  currency    text not null default 'PHP',
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now()
);

create table club_members (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references clubs (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  display_name  text not null,
  skill_tier    skill_tier not null default 'bridge',
  role          member_role not null default 'member',
  created_at    timestamptz not null default now(),
  -- One membership per signed-in user per club. Guests (user_id null) are exempt.
  unique (club_id, user_id)
);
create index on club_members (club_id);
create index on club_members (user_id);

create table sessions (
  id                   uuid primary key default gen_random_uuid(),
  club_id              uuid not null references clubs (id) on delete cascade,
  name                 text not null,
  join_code            text not null unique,
  status               session_status not null default 'draft',
  court_count          int  not null default 2 check (court_count between 1 and 12),
  target_score         int  not null default 11 check (target_score between 7 and 25),
  win_by               int  not null default 2  check (win_by between 1 and 2),
  fee_amount           numeric(10, 2) not null default 0 check (fee_amount >= 0),
  allow_player_scoring boolean not null default false,
  attendance_cap       int check (attendance_cap > 0),
  scheduled_at         timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz not null default now()
);
create index on sessions (club_id, status);

create table session_players (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions (id) on delete cascade,
  club_member_id uuid not null references club_members (id) on delete cascade,
  status         player_status not null default 'waiting',
  -- Bumped to now() on every requeue; the queue orders by this ascending.
  queued_at      timestamptz not null default now(),
  games_played   int not null default 0,
  joined_at      timestamptz not null default now(),
  unique (session_id, club_member_id)
);
create index on session_players (session_id, status, queued_at);

create table matches (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id) on delete cascade,
  court_number int  not null check (court_number > 0),
  team_a_ids   uuid[] not null check (array_length(team_a_ids, 1) = 2),
  team_b_ids   uuid[] not null check (array_length(team_b_ids, 1) = 2),
  score_a      int check (score_a >= 0),
  score_b      int check (score_b >= 0),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  -- A finished match has both scores; an in-progress match has neither.
  constraint scores_complete_together
    check ((score_a is null) = (score_b is null)),
  constraint ended_matches_are_scored
    check (ended_at is null or score_a is not null)
);
create index on matches (session_id, ended_at);
-- One live match per court.
create unique index one_live_match_per_court
  on matches (session_id, court_number) where ended_at is null;

create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions (id) on delete cascade,
  club_member_id uuid not null references club_members (id) on delete cascade,
  amount_due     numeric(10, 2) not null default 0 check (amount_due >= 0),
  amount_paid    numeric(10, 2) not null default 0 check (amount_paid >= 0),
  status         payment_status not null default 'unpaid',
  note           text,
  updated_by     uuid references auth.users (id),
  updated_at     timestamptz not null default now(),
  unique (session_id, club_member_id)
);
create index on ledger_entries (club_member_id, status);

create table rsvps (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions (id) on delete cascade,
  club_member_id uuid not null references club_members (id) on delete cascade,
  status         rsvp_status not null default 'going',
  updated_at     timestamptz not null default now(),
  unique (session_id, club_member_id)
);

-- ---------------------------------------------------------------- helpers
--
-- SECURITY DEFINER so these can read club_members without re-triggering the
-- policies that call them (which would recurse infinitely).

create or replace function is_club_member(target_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_members
    where club_id = target_club and user_id = auth.uid()
  );
$$;

create or replace function is_club_admin(target_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_members
    where club_id = target_club
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function session_club(target_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select club_id from sessions where id = target_session;
$$;

-- ---------------------------------------------------------------- RLS

alter table clubs           enable row level security;
alter table club_members    enable row level security;
alter table sessions        enable row level security;
alter table session_players enable row level security;
alter table matches         enable row level security;
alter table ledger_entries  enable row level security;
alter table rsvps           enable row level security;

-- clubs
create policy clubs_read   on clubs for select using (is_club_member(id));
create policy clubs_create on clubs for insert with check (created_by = auth.uid());
create policy clubs_update on clubs for update using (is_club_admin(id));

-- club_members. Read is deliberately open to any authenticated user so the
-- join-by-code flow can resolve names before the joiner is a member yet;
-- writes stay admin-only except for self-updates.
create policy members_read on club_members
  for select using (auth.uid() is not null);
create policy members_admin_write on club_members
  for all using (is_club_admin(club_id)) with check (is_club_admin(club_id));
create policy members_self_update on club_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sessions. Same reasoning: a player must be able to look up a session by its
-- join code before they belong to the club.
create policy sessions_read  on sessions for select using (auth.uid() is not null);
create policy sessions_write on sessions
  for all using (is_club_admin(club_id)) with check (is_club_admin(club_id));

-- session_players
create policy sp_read on session_players
  for select using (is_club_member(session_club(session_id)));
create policy sp_admin_write on session_players
  for all using (is_club_admin(session_club(session_id)))
  with check (is_club_admin(session_club(session_id)));
create policy sp_self_join on session_players
  for insert with check (
    club_member_id in (select id from club_members where user_id = auth.uid())
  );

-- matches
create policy matches_read on matches
  for select using (is_club_member(session_club(session_id)));
create policy matches_admin_write on matches
  for all using (is_club_admin(session_club(session_id)))
  with check (is_club_admin(session_club(session_id)));

-- ledger. Members read their own entries; admins read and write all.
create policy ledger_read_own on ledger_entries
  for select using (
    club_member_id in (select id from club_members where user_id = auth.uid())
  );
create policy ledger_admin_all on ledger_entries
  for all using (is_club_admin(session_club(session_id)))
  with check (is_club_admin(session_club(session_id)));

-- rsvps
create policy rsvps_read on rsvps
  for select using (is_club_member(session_club(session_id)));
create policy rsvps_self on rsvps
  for all using (
    club_member_id in (select id from club_members where user_id = auth.uid())
  ) with check (
    club_member_id in (select id from club_members where user_id = auth.uid())
  );
create policy rsvps_admin on rsvps
  for all using (is_club_admin(session_club(session_id)))
  with check (is_club_admin(session_club(session_id)));

-- ---------------------------------------------------------------- rpc
--
-- A club and its owner membership must be created together. Insert the club
-- alone and clubs_read (which requires membership) immediately hides the row
-- from the person who just made it.

create or replace function create_club(club_name text, club_slug text, owner_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_club uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  insert into clubs (name, slug, created_by)
  values (club_name, club_slug, auth.uid())
  returning id into new_club;

  insert into club_members (club_id, user_id, display_name, role)
  values (new_club, auth.uid(), owner_name, 'owner');

  return new_club;
end;
$$;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table session_players;
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table ledger_entries;
