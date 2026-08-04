-- Joining a session by code.
--
-- `members_admin_write` means a non-member cannot insert their own club_members
-- row, so the join flow is blocked by RLS unless it runs as SECURITY DEFINER —
-- the same reason `create_club` exists. This does both writes in one call:
-- create the club membership if it's the player's first time, then enter them
-- into the session.

create or replace function join_session(code text, player_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target   sessions%rowtype;
  member   uuid;
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
  on conflict (session_id, club_member_id) do nothing;

  return target.id;
end;
$$;

grant execute on function join_session(text, text) to anon, authenticated;

-- The owner must stay the owner: an admin promoted by the owner must not be
-- able to demote them. Enforced in the database rather than the UI, because the
-- UI is not the security boundary.
create or replace function guard_owner_role() returns trigger
language plpgsql as $$
begin
  if old.role = 'owner' and new.role <> 'owner' then
    raise exception 'the club owner cannot be demoted';
  end if;
  return new;
end;
$$;

drop trigger if exists club_members_guard_owner on club_members;
create trigger club_members_guard_owner
  before update on club_members
  for each row execute function guard_owner_role();

-- club_members drives the member directory in realtime. Already-in-publication
-- is not an error worth failing the run over.
do $$
begin
  alter publication supabase_realtime add table club_members;
exception when duplicate_object then null;
end;
$$;

-- PostgREST caches the schema; a new function is invisible until it reloads.
notify pgrst, 'reload schema';
