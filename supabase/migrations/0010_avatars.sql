-- Profile photos.
--
-- One photo per person, not per membership: the same face at every club, even
-- though the name and skill tier beside it are per-club. The URL is still
-- stored on club_members rather than in a profiles table, because every read
-- in the app already selects from club_members — a profiles table would have to
-- be joined through auth.users, which PostgREST cannot embed, costing an extra
-- round trip on every screen. "One per person" is held by the write path
-- (one UPDATE ... WHERE user_id = auth.uid(), so all your rows move together)
-- plus the inherit trigger below, rather than by the shape of the table.

alter table club_members add column if not exists avatar_url text;

-- ------------------------------------------------------------------- inherit
--
-- Joining a second club, or claiming a guest row you were queued as, should not
-- lose the photo you already uploaded — the new row is created by join_session
-- or create_club, neither of which knows anything about avatars.
--
-- Fires on UPDATE OF user_id too: claim_member turns a guest row into yours by
-- setting user_id, which is an update, not an insert.
create or replace function inherit_member_avatar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.avatar_url is null then
    select avatar_url into new.avatar_url
      from club_members
     where user_id = new.user_id
       and avatar_url is not null
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists club_members_inherit_avatar on club_members;
create trigger club_members_inherit_avatar
  before insert or update of user_id on club_members
  for each row execute function inherit_member_avatar();

-- No new policy on club_members: members_self_update (0001) is column-agnostic,
-- so a player can already write their own row. Guests (user_id is null) fail
-- that policy, which is exactly the intent — nobody sets someone else's face.

-- -------------------------------------------------------------------- bucket
--
-- Public read: a roster of sixteen avatars would otherwise need sixteen signed
-- URLs refreshed on a timer, for photos people are holding up to each other
-- across a gym anyway. The paths are uuid-prefixed, so they are not walkable.
--
-- The size and mime limits live on the bucket, not in the client: anyone with
-- the anon key can call storage directly, so client-side checks are a courtesy
-- to the user, never the enforcement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Everyone here signs in anonymously, so every real user carries the
-- `authenticated` role. The folder check is what separates them: you may only
-- write under <your uid>/.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
