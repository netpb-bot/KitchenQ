-- M3 scoring.
--
-- Two changes. Score validation moves into its own function so the correction
-- path cannot drift from the entry path — a score the host fixes has to obey
-- exactly the rules the score they typed first did. And `correct_match` lets
-- the host repair a score that was already recorded, which matters most when
-- `allow_player_scoring` is on and a player typed it.

-- ---------------------------------------------------------------- validation

-- Was inline in end_match. Raises on the first rule broken; the message is the
-- one the player sees, so it is written for a phone screen, not a log.
create or replace function check_score(
  target_score int,
  win_by int,
  score_a int,
  score_b int
)
returns void language plpgsql immutable as $$
declare
  winner int := greatest(score_a, score_b);
  loser  int := least(score_a, score_b);
begin
  if loser < 0 then
    raise exception 'scores cannot be negative';
  end if;
  if winner < target_score then
    raise exception 'the winner must reach %', target_score;
  end if;
  if winner - loser < win_by then
    raise exception 'the winner must win by %', win_by;
  end if;
  -- Past the target the game ends the moment the lead reaches win_by, so any
  -- larger margin means the score was mistyped.
  if winner > target_score and winner - loser <> win_by then
    raise exception 'a game past % ends as soon as the lead reaches %',
      target_score, win_by;
  end if;
end;
$$;

-- -------------------------------------------------------------------- ending

-- Replaces the 0003 version. Identical behaviour; the rules now live in
-- check_score so correct_match enforces the same ones.
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

  perform check_score(target.target_score, target.win_by, score_a, score_b);

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

-- ---------------------------------------------------------------- correcting

-- Host only, even when allow_player_scoring is on: letting a player record the
-- score is a convenience, letting them rewrite a finished one after the fact is
-- not. The match stays finished and nobody's games_played moves — the same four
-- people played the same game; only the number was wrong.
create or replace function correct_match(
  target_match uuid,
  score_a int,
  score_b int
)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches%rowtype;
  target sessions%rowtype;
begin
  select * into m from matches where id = target_match;
  if m.id is null then
    raise exception 'no such match';
  end if;
  if m.ended_at is null then
    raise exception 'that match has not finished yet';
  end if;

  select * into target from sessions where id = m.session_id;
  if not is_club_admin(target.club_id) then
    raise exception 'only the host can correct a score';
  end if;

  perform check_score(target.target_score, target.win_by, score_a, score_b);

  update matches
     set score_a = correct_match.score_a,
         score_b = correct_match.score_b
   where id = target_match;
end;
$$;

grant execute on function check_score(int, int, int, int) to authenticated;
grant execute on function correct_match(uuid, int, int)   to authenticated;

notify pgrst, 'reload schema';
