-- Only the people on the court may end the match.
--
-- `allow_player_scoring` was read as "anyone may score", not "the players may
-- score their own game". end_match is security definer, so it bypasses
-- matches_admin_write and that one flag was the whole gate: with the toggle on,
-- any authenticated user holding a match uuid could end that match and set the
-- score — a bystander in the session, or someone not in the club at all. The
-- four people mid-rally found their game over.
--
-- Same body as 0006, one gate rewritten. The two failures stay separate because
-- they mean different things to whoever hits them: the toggle is off, versus
-- the toggle is on and this isn't your court.

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

  -- Hoisted above the check; the requeue below reads it too.
  lineup := m.team_a_ids || m.team_b_ids;

  select * into target from sessions where id = m.session_id;
  if not is_club_admin(target.club_id) then
    if not target.allow_player_scoring then
      raise exception 'only the host can record the score';
    end if;
    -- The lineup holds club_members.id. A guest's row has user_id null, so it
    -- can never match auth.uid() — a court of guests stays the host's to score,
    -- which is how the host already does everything else for a guest.
    if not exists (
      select 1 from club_members
      where id = any (lineup) and user_id = auth.uid()
    ) then
      raise exception 'only the players on this court can record the score';
    end if;
  end if;

  perform check_score(target.target_score, target.win_by, score_a, score_b);

  update matches
     set score_a = end_match.score_a,
         score_b = end_match.score_b,
         ended_at = now()
   where id = target_match;

  -- Full rotation: winners and losers both go to the back of the queue.
  update session_players
     set status = 'waiting',
         queued_at = now(),
         games_played = games_played + 1
   where session_id = m.session_id
     and club_member_id = any (lineup);
end;
$$;

notify pgrst, 'reload schema';
