-- "Play with me next game."
--
-- A player asks another player to partner up; the other accepts; the queue then
-- puts the two of them on the same team for one match and forgets the whole
-- thing. One table carries the request from ask to consumed — the inbox and the
-- live pairing are the same row at different points in its life, and splitting
-- them into two tables would only mean keeping them in step.
--
-- The pairing itself is enforced client-side, in the matchmaker (src/lib/queue.ts):
-- lineups are already chosen there and start_match only validates what it is
-- handed. What must be enforced here is *who may ask whom* and *who may answer*,
-- because those are the parts a crafted request could otherwise forge.

create type pair_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'consumed');

create table pair_requests (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id) on delete cascade,
  from_member  uuid not null references club_members (id) on delete cascade,
  to_member    uuid not null references club_members (id) on delete cascade,
  status       pair_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint no_pairing_with_yourself check (from_member <> to_member)
);

-- One outstanding ask per direction. Nothing stops B asking A back while A's
-- ask is still open — two people reaching for each other at once is a race the
-- app should let them win, not an error.
create unique index pair_requests_one_pending
  on pair_requests (session_id, from_member, to_member)
  where status = 'pending';

-- The live screen reads the open rows for one session on every refresh.
create index on pair_requests (session_id, status);

alter table pair_requests enable row level security;

-- Read only. Every write goes through the two functions below, the same shape
-- as `matches`: the rules about who may ask and who may answer are the feature,
-- and a policy cannot express "accepting also declines the others".
create policy pair_requests_read on pair_requests
  for select using (is_club_member(session_club(session_id)));

-- ------------------------------------------------------------------- asking

create or replace function request_pair(target_session uuid, target_member uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target  sessions%rowtype;
  me      uuid;
  request uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select * into target from sessions where id = target_session;
  if target.id is null then
    raise exception 'no such session';
  end if;
  if target.status <> 'live' then
    raise exception 'the session is not live';
  end if;

  select id into me
    from club_members
   where club_id = target.club_id and user_id = auth.uid();
  if me is null then
    raise exception 'you are not in this session';
  end if;
  if me = target_member then
    raise exception 'you cannot pair with yourself';
  end if;

  -- Both of you have to be in the queue right now. Asking someone mid-match to
  -- partner up is a different feature; asking while you yourself are on court
  -- would let you skip the queue by proxy.
  if not exists (
    select 1 from session_players
     where session_id = target_session and club_member_id = me and status = 'waiting'
  ) then
    raise exception 'you have to be in the queue to ask';
  end if;

  -- A guest is someone the host typed in — no account, no device, no way to
  -- ever answer. Offering the ask would be offering a request that can only
  -- expire. Same reasoning as the scoring gate in 0009.
  if not exists (
    select 1 from session_players sp
      join club_members cm on cm.id = sp.club_member_id
     where sp.session_id = target_session
       and sp.club_member_id = target_member
       and sp.status = 'waiting'
       and cm.user_id is not null
  ) then
    raise exception 'that player cannot be asked right now';
  end if;

  if exists (
    select 1 from pair_requests
     where session_id = target_session
       and status = 'accepted'
       and (from_member in (me, target_member) or to_member in (me, target_member))
  ) then
    raise exception 'one of you is already paired up';
  end if;

  insert into pair_requests (session_id, from_member, to_member)
  values (target_session, me, target_member)
  on conflict (session_id, from_member, to_member) where status = 'pending'
  do nothing
  returning id into request;

  -- Conflict means the ask is already open. A double-tap is not an error.
  if request is null then
    select id into request from pair_requests
     where session_id = target_session
       and from_member = me
       and to_member = target_member
       and status = 'pending';
  end if;

  return request;
end;
$$;

-- ----------------------------------------------------------------- answering

-- One function rather than accept/decline/cancel, because which side of the row
-- you are on is what decides the legal move, and that check is the same check
-- three times over.
create or replace function respond_pair(target_request uuid, next_status pair_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  r       pair_requests%rowtype;
  mine    boolean;
  theirs  boolean;
begin
  select * into r from pair_requests where id = target_request;
  if r.id is null then
    raise exception 'no such request';
  end if;

  select exists (select 1 from club_members where id = r.from_member and user_id = auth.uid())
    into mine;
  select exists (select 1 from club_members where id = r.to_member and user_id = auth.uid())
    into theirs;
  if not (mine or theirs) then
    raise exception 'that request is not yours';
  end if;

  if r.status = 'pending' then
    if next_status = 'cancelled' then
      null;                                   -- either side may call it off
    elsif next_status in ('accepted', 'declined') then
      if not theirs then
        raise exception 'only the player who was asked can answer';
      end if;
    else
      raise exception 'a pending request cannot become %', next_status;
    end if;
  elsif r.status = 'accepted' then
    -- Unpairing before the match starts. Either of them may back out.
    if next_status <> 'cancelled' then
      raise exception 'an accepted pairing can only be cancelled';
    end if;
  else
    raise exception 'that request is already %', r.status;
  end if;

  -- Re-checked here and not only in request_pair: two pending asks accepted at
  -- the same moment would otherwise leave one player partnered twice.
  if next_status = 'accepted' and exists (
    select 1 from pair_requests
     where session_id = r.session_id
       and status = 'accepted'
       and (from_member in (r.from_member, r.to_member)
         or to_member in (r.from_member, r.to_member))
  ) then
    raise exception 'one of you is already paired up';
  end if;

  update pair_requests
     set status = next_status, responded_at = now()
   where id = target_request;

  -- Saying yes to one is saying no to the rest. Done here so the two writes
  -- cannot come apart, which is the reason this is a function and not a policy.
  if next_status = 'accepted' then
    update pair_requests
       set status = 'declined', responded_at = now()
     where session_id = r.session_id
       and id <> target_request
       and status = 'pending'
       and (from_member in (r.from_member, r.to_member)
         or to_member in (r.from_member, r.to_member));
  end if;
end;
$$;

grant execute on function request_pair(uuid, uuid)         to authenticated;
grant execute on function respond_pair(uuid, pair_status)  to authenticated;

-- -------------------------------------------------------- spending the pairing

-- Same body as 0009, one statement added: a pairing is good for one game, and
-- the game it was good for is over.
--
-- Cleared on end, not on start, so cancel_match — which puts the four back with
-- their queued_at untouched, costing them nothing — does not quietly cost them
-- the arrangement too.
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

  lineup := m.team_a_ids || m.team_b_ids;

  select * into target from sessions where id = m.session_id;
  if not is_club_admin(target.club_id) then
    if not target.allow_player_scoring then
      raise exception 'only the host can record the score';
    end if;
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

  -- Both of them have to have been on this court. A host who hand-substituted
  -- one of them out never gave them their game, so they keep the pairing for
  -- the next one.
  update pair_requests
     set status = 'consumed', responded_at = now()
   where session_id = m.session_id
     and status = 'accepted'
     and from_member = any (lineup)
     and to_member = any (lineup);
end;
$$;

alter publication supabase_realtime add table pair_requests;

notify pgrst, 'reload schema';
