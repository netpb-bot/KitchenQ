-- The queue has to be right, not just fast.
--
-- A player reads one number off this screen and plans the next twenty minutes
-- of their night around it. Three things could make that number a lie, and all
-- three live here rather than in the client:
--
--   1. Coming back into the queue kept the wait you didn't do. `end_match` and
--      `join_session` stamp `queued_at`; nothing else did, so sitting out for
--      three rounds and tapping "I'm back" put you at the front of the list.
--   2. A row could say `waiting` while its player was mid-match, and
--      `start_match` only checks that all four are waiting — so the same person
--      could be started onto a second court.
--   3. `queued_at` and `games_played` are the entire sort key, and both were
--      writable by the player they belong to.
--
-- Two triggers and a column grant, all at the one place every caller meets. The
-- alternative was four call sites in db.ts that a fifth would eventually skip.

-- ------------------------------------------------------- coming back into line

-- The wait you actually did, not the one your row remembers.
--
-- `playing -> waiting` is excluded deliberately: `end_match` sets `queued_at`
-- itself, and `cancel_match` is documented as *not* setting it — a match that
-- never happened must not cost the four their place in line. Every other route
-- back — the host's undo, "I'm back", a re-add, a rejoin — is someone
-- re-entering a queue they had stepped out of, and starts from now.
--
-- `games_played` is untouched on purpose. Somebody who sat out genuinely has
-- played fewer games, and fewest-games-first is the fairness rule the whole
-- engine rests on. All they lose is the stale timestamp inside their tier.
create or replace function requeue_on_return()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'waiting' and old.status in ('resting', 'left') then
    new.queued_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists sp_requeue_on_return on session_players;
create trigger sp_requeue_on_return
  before update of status on session_players
  for each row when (old.status is distinct from new.status)
  execute function requeue_on_return();

-- --------------------------------------------------- nobody is in two places

-- `waiting` while on court is not a state that exists in the world, and it is
-- the one `start_match` trusts. The way in was `addPlayer`'s upsert, which
-- unlike `join_session` carries no `where status = 'left'` guard: a stale client
-- re-adding somebody flips a live row back to `waiting`, and the next court
-- start puts them on two courts at once.
--
-- Guarding here rather than in the upsert because `setPlayerStatus` can do it
-- too, and so can anything added later.
create or replace function refuse_waiting_mid_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'waiting' and exists (
    select 1 from matches m
     where m.session_id = new.session_id
       and m.ended_at is null
       and new.club_member_id = any (m.team_a_ids || m.team_b_ids)
  ) then
    raise exception 'that player is on court right now';
  end if;
  return new;
end;
$$;

drop trigger if exists sp_no_waiting_mid_match on session_players;
create trigger sp_no_waiting_mid_match
  before insert or update on session_players
  for each row execute function refuse_waiting_mid_match();

-- Same body as 0003, two statements swapped. The match row has to be gone
-- before the four go back to `waiting`, or the guard above refuses the undo.
-- `m` was read into the row variable at the top, so deleting first costs
-- nothing.
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

  delete from matches where id = target_match;

  -- Still no `queued_at` here. A cancelled match costs them nothing in wait
  -- order, which is the whole reason cancel exists.
  update session_players
     set status = 'waiting'
   where session_id = m.session_id
     and club_member_id = any (m.team_a_ids || m.team_b_ids);
end;
$$;

-- ------------------------------------------------- the sort key is not yours

-- `sp_self_update` exists so a player can sit out and come back without the
-- host doing it for them, and `status` is all that needs. But the policy is
-- column-unqualified and RLS has no way to say otherwise, so a PATCH on
-- `queued_at` or `games_played` — the two columns `queueOrder` sorts on, and
-- nothing else — moved you up the list. `games_played = -1` is a permanent
-- first place.
--
-- Column grants are the tool that does exist. `session_id` and `club_member_id`
-- stay writable because `addPlayer` upserts on them; both are the conflict key,
-- so writing them is a no-op, and both policies pin them anyway. Everything the
-- fairness rules read is now the security-definer RPCs' to set.
-- `anon` is already stopped by every policy on the table needing an auth.uid(),
-- but this is the one migration whose whole subject is defence in depth on two
-- columns, so it takes the grant away there too.
revoke update on session_players from authenticated, anon;
grant update (status, session_id, club_member_id) on session_players to authenticated;

notify pgrst, 'reload schema';
