-- Guest players.
--
-- A guest is a club_members row the host typed in: real member, no auth user.
-- The schema already allows it — user_id is nullable and `unique (club_id,
-- user_id)` treats NULLs as distinct — and `members_admin_write` already lets a
-- host insert one. Creating, renaming and queueing guests therefore needs no
-- SQL at all.
--
-- Claiming does. The person taking over a guest row is not a member yet, so
-- `members_self_update` (user_id = auth.uid()) matches nothing and
-- `members_admin_write` denies them. Same reason create_club and join_session
-- exist.

create or replace function claim_member(code text, target_member uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_club uuid;
  guest       club_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  -- The join code is required, not just the member id. Without it, anyone who
  -- learns a club id could take over a regular's identity and inherit their
  -- whole record; with it, claiming means being at tonight's session.
  select club_id into target_club from sessions where join_code = upper(trim(code));
  if target_club is null then
    raise exception 'no session with that code';
  end if;

  -- Serialises two people tapping the same name at the same moment.
  select * into guest from club_members where id = target_member for update;

  if guest.id is null or guest.club_id <> target_club then
    raise exception 'that player is not in this club';
  end if;
  if guest.user_id is not null then
    raise exception 'that player has already been claimed';
  end if;
  -- user_id also goes null when an auth user is deleted (on delete set null),
  -- so an orphaned owner or co-host row must never be claimable into its role.
  if guest.role <> 'member' then
    raise exception 'that player cannot be claimed';
  end if;

  if exists (
    select 1 from club_members
     where club_id = target_club and user_id = auth.uid()
  ) then
    raise exception 'you are already in this club under another name';
  end if;

  update club_members set user_id = auth.uid() where id = target_member;

  return target_club;
end;
$$;

grant execute on function claim_member(text, uuid) to authenticated;

notify pgrst, 'reload schema';
