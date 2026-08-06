-- "No, put Ana on court 2 next."
--
-- The next-up lineup on every court has always been a forecast: `forecast()` in
-- src/lib/queue.ts recomputes it from the queue on every tick, so a host who
-- disagreed with it had nowhere to say so. The one place a lineup could be
-- edited was an empty court, and that edit lived in a React useState — gone on
-- refresh, and never seen by the co-host standing on the other side of the net.
--
-- This table is that missing place: the host's decision, persisted, so the
-- forecast has something to obey.
--
-- One row per *slot*, not per lineup, which is what makes the awkward cases
-- ordinary. A half-filled court is just two rows. A pinned player who goes home
-- is one row the client ignores while the engine refills the gap around it —
-- no all-or-nothing invalidation, which is what the useState version had to do.

create table court_pins (
  session_id   uuid not null references sessions (id) on delete cascade,
  court_number int  not null check (court_number > 0),
  -- 0 and 1 are team A, 2 and 3 are team B. Which slot a player is in *is* the
  -- host's answer to "who partners whom", so the slot is the data.
  slot         int  not null check (slot between 0 and 3),
  member_id    uuid not null references club_members (id) on delete cascade,
  pinned_at    timestamptz not null default now(),
  primary key (session_id, court_number, slot),
  -- Pinned in one place or nowhere. This is the whole implementation of "move a
  -- player from court 1's next-up to court 2's": pinning them here has to
  -- unpin them there, and the constraint makes forgetting it an error rather
  -- than a player who is somehow up next twice.
  unique (session_id, member_id)
);

-- The live screen reads every pin for one session on each refresh.
create index on court_pins (session_id);

alter table court_pins enable row level security;

-- Read only, same shape as `pair_requests` in 0012: the rules about who may pin
-- and what happens to the pins they displace are the feature, and a policy
-- cannot express "pinning here also unpins there".
create policy court_pins_read on court_pins
  for select using (is_club_member(session_club(session_id)));

-- ------------------------------------------------------------------- pinning

-- Takes all four, never a delta. A host who looked at the lineup and changed
-- one name has endorsed the other three; asking the client to report which slot
-- it touched would be bookkeeping in exchange for nothing.
create or replace function set_court_lineup(
  target_session uuid,
  court int,
  member_ids uuid[]
)
returns void language plpgsql security definer set search_path = public as $$
declare
  target  sessions%rowtype;
  waiting int;
begin
  select * into target from sessions where id = target_session;
  if target.id is null then
    raise exception 'no such session';
  end if;
  if not is_club_admin(target.club_id) then
    raise exception 'only the host can set a lineup';
  end if;
  if target.status <> 'live' then
    raise exception 'the session is not live';
  end if;
  if court < 1 or court > target.court_count then
    raise exception 'court % is not in this session', court;
  end if;
  if array_length(member_ids, 1) <> 4 then
    raise exception 'a match needs four players';
  end if;
  if (select count(distinct p) from unnest(member_ids) p) <> 4 then
    raise exception 'a player cannot be on court twice';
  end if;

  -- The same check start_match makes, for the same reason: two hosts editing at
  -- once must not be able to pin someone who is already on court.
  select count(*) into waiting
    from session_players
   where session_id = target_session
     and club_member_id = any (member_ids)
     and status = 'waiting';
  if waiting <> 4 then
    raise exception 'those players are no longer all in the queue';
  end if;

  -- Wherever these four were pinned before, they are not pinned there now.
  -- Deleting by member rather than by court is what moves a player across.
  delete from court_pins
   where session_id = target_session
     and member_id = any (member_ids);

  insert into court_pins (session_id, court_number, slot, member_id)
  select target_session, court, i - 1, member_ids[i]
    from generate_series(1, 4) i
  on conflict (session_id, court_number, slot)
  do update set member_id = excluded.member_id, pinned_at = now();
end;
$$;

-- Hand the court back to the queue engine. Without this a host who overrode a
-- lineup could never stop overriding it.
create or replace function clear_court_lineup(target_session uuid, court int)
returns void language plpgsql security definer set search_path = public as $$
declare
  target sessions%rowtype;
begin
  select * into target from sessions where id = target_session;
  if target.id is null then
    raise exception 'no such session';
  end if;
  if not is_club_admin(target.club_id) then
    raise exception 'only the host can set a lineup';
  end if;

  delete from court_pins
   where session_id = target_session and court_number = court;
end;
$$;

grant execute on function set_court_lineup(uuid, int, uuid[]) to authenticated;
grant execute on function clear_court_lineup(uuid, int)       to authenticated;

-- -------------------------------------------------------- spending the pins

-- Same body as 0003, one statement added: the lineup the host pinned is on
-- court now, so the pins have done their job.
--
-- Both halves of the delete matter. `court_number` clears this court even if
-- the host started someone other than who was pinned; `member_id` covers the
-- player who was pinned for court 2 and just got started on court 1, whose pin
-- would otherwise sit there holding a slot for someone mid-match.
create or replace function start_match(
  target_session uuid,
  court int,
  team_a uuid[],
  team_b uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target sessions%rowtype;
  lineup uuid[] := team_a || team_b;
  new_match uuid;
  playing int;
begin
  select * into target from sessions where id = target_session;
  if target.id is null then
    raise exception 'no such session';
  end if;
  if not is_club_admin(target.club_id) then
    raise exception 'only the host can start a match';
  end if;
  if target.status <> 'live' then
    raise exception 'the session is not live';
  end if;
  if court < 1 or court > target.court_count then
    raise exception 'court % is not in this session', court;
  end if;
  if array_length(lineup, 1) <> 4 then
    raise exception 'a match needs four players';
  end if;
  if (select count(distinct p) from unnest(lineup) p) <> 4 then
    raise exception 'a player cannot be on court twice';
  end if;

  -- Every player must currently be waiting in THIS session. This is what stops
  -- a stale client from putting someone on two courts at once.
  select count(*) into playing
    from session_players
   where session_id = target_session
     and club_member_id = any (lineup)
     and status = 'waiting';
  if playing <> 4 then
    raise exception 'those players are no longer all in the queue';
  end if;

  insert into matches (session_id, court_number, team_a_ids, team_b_ids)
  values (target_session, court, team_a, team_b)
  returning id into new_match;

  update session_players
     set status = 'playing'
   where session_id = target_session
     and club_member_id = any (lineup);

  delete from court_pins
   where session_id = target_session
     and (court_number = start_match.court or member_id = any (lineup));

  return new_match;
end;
$$;

alter publication supabase_realtime add table court_pins;

notify pgrst, 'reload schema';
