-- Match lifecycle.
--
-- Starting a match writes a `matches` row AND flips four `session_players` to
-- 'playing'; ending one writes the score AND requeues all four. Split across
-- two client calls, a dropped connection between them leaves the session in a
-- state no screen can render. Both run here, in one transaction.
--
-- SECURITY DEFINER bypasses RLS, so each function re-checks admin rights itself.

-- ------------------------------------------------------------------ starting

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

  return new_match;
end;
$$;

-- ------------------------------------------------------------------- ending

create or replace function end_match(
  target_match uuid,
  score_a int,
  score_b int
)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches%rowtype;
  target sessions%rowtype;
  lineup uuid[];
  winner int;
  loser  int;
begin
  select * into m from matches where id = target_match;
  if m.id is null then
    raise exception 'no such match';
  end if;
  if m.ended_at is not null then
    raise exception 'that match is already finished';
  end if;

  select * into target from sessions where id = m.session_id;
  if not (is_club_admin(target.club_id) or target.allow_player_scoring) then
    raise exception 'only the host can record the score';
  end if;

  -- Score rules live here, not in the client: the client is not the boundary,
  -- and a wrong score corrupts every standing derived from it.
  winner := greatest(score_a, score_b);
  loser  := least(score_a, score_b);
  if loser < 0 then
    raise exception 'scores cannot be negative';
  end if;
  if winner < target.target_score then
    raise exception 'the winner must reach %', target.target_score;
  end if;
  if winner - loser < target.win_by then
    raise exception 'the winner must win by %', target.win_by;
  end if;
  -- Past the target the game ends the moment the lead reaches win_by, so any
  -- larger margin means the score was mistyped.
  if winner > target.target_score and winner - loser <> target.win_by then
    raise exception 'a game past % ends as soon as the lead reaches %',
      target.target_score, target.win_by;
  end if;

  update matches
     set score_a = end_match.score_a,
         score_b = end_match.score_b,
         ended_at = now()
   where id = target_match;

  -- Full rotation: winners and losers both go to the back of the queue.
  lineup := m.team_a_ids || m.team_b_ids;
  update session_players
     set status = 'waiting',
         queued_at = now(),
         games_played = games_played + 1
   where session_id = m.session_id
     and club_member_id = any (lineup);
end;
$$;

-- ---------------------------------------------------------------- cancelling

-- Undo a mis-start. The players go back to the queue with their original
-- queued_at intact, so a cancelled match costs them nothing in wait order.
create or replace function cancel_match(target_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches%rowtype;
  club uuid;
begin
  select * into m from matches where id = target_match;
  if m.id is null then
    raise exception 'no such match';
  end if;
  if m.ended_at is not null then
    raise exception 'a finished match cannot be cancelled';
  end if;

  club := session_club(m.session_id);
  if not is_club_admin(club) then
    raise exception 'only the host can cancel a match';
  end if;

  update session_players
     set status = 'waiting'
   where session_id = m.session_id
     and club_member_id = any (m.team_a_ids || m.team_b_ids);

  delete from matches where id = target_match;
end;
$$;

grant execute on function start_match(uuid, int, uuid[], uuid[]) to authenticated;
grant execute on function end_match(uuid, int, int)             to authenticated;
grant execute on function cancel_match(uuid)                    to authenticated;

-- ------------------------------------------------------------------ rejoining

-- Replaces the 0002 version. A player who left and came back should re-enter
-- the queue at the back rather than silently staying 'left'; anyone already
-- waiting or playing is untouched, so a double-tap cannot reset their wait.
create or replace function join_session(code text, player_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target sessions%rowtype;
  member uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if coalesce(trim(player_name), '') = '' then
    raise exception 'a name is required';
  end if;

  select * into target from sessions where join_code = upper(trim(code));
  if target.id is null then
    raise exception 'no session with that code';
  end if;
  if target.status = 'ended' then
    raise exception 'that session has already ended';
  end if;

  select id into member
    from club_members
   where club_id = target.club_id and user_id = auth.uid();

  if member is null then
    insert into club_members (club_id, user_id, display_name)
    values (target.club_id, auth.uid(), trim(player_name))
    returning id into member;
  end if;

  insert into session_players (session_id, club_member_id)
  values (target.id, member)
  on conflict (session_id, club_member_id) do update
    set status = 'waiting', queued_at = now()
    where session_players.status = 'left';

  return target.id;
end;
$$;

-- A player may sit out and come back without the host doing it for them.
drop policy if exists sp_self_update on session_players;
create policy sp_self_update on session_players
  for update using (
    club_member_id in (select id from club_members where user_id = auth.uid())
  ) with check (
    club_member_id in (select id from club_members where user_id = auth.uid())
  );

-- ------------------------------------------------------------ deleting a club

-- 0001 gave clubs select/insert/update but no delete, so a club created by
-- mistake could never be removed. Owner only — an admin must not be able to
-- delete the club out from under the person who made it.
create or replace function is_club_owner(target_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_members
    where club_id = target_club and user_id = auth.uid() and role = 'owner'
  );
$$;

drop policy if exists clubs_delete on clubs;
create policy clubs_delete on clubs for delete using (is_club_owner(id));

notify pgrst, 'reload schema';
