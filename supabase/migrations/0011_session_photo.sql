-- One photo per session, behind its cards.
--
-- A session card is a white rectangle with a name and a join code on it. The
-- night it describes had twelve people and a group shot; this puts that photo
-- behind the card and behind the session header.
--
-- Stored as a URL on sessions, matching avatar_url in 0010: every read of a
-- session already selects these columns, so the photo costs no extra round trip
-- and there is one convention in the codebase rather than two.

alter table sessions add column if not exists photo_url text;

-- -------------------------------------------------------------------- bucket
--
-- Public read, like avatars. sessions_read (0001) is already open to any
-- authenticated user so the join-by-code flow can resolve a session before the
-- joiner is a member — signing URLs for the photo would guard nothing the row
-- beside it does not already hand over.
--
-- JPEG rather than the avatars bucket's webp: this is a full-width photo, not a
-- 256px square, so it wants the format every browser can encode without a
-- fallback path. The size and mime limits are the enforcement — the client
-- downscales first (src/lib/image.ts), but a client is a suggestion.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('session-photos', 'session-photos', true, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------- RLS
--
-- Objects are named `<session_id>/photo.jpg`, so the folder segment is the
-- authorisation key: it names the session, session_club names the club, and
-- is_club_admin decides. The same gate as sessions_write — a co-host is a club
-- admin, and this schema has no session-level role.
--
-- Wrapped in a function rather than inlined into three policies: the uuid cast
-- raises on a name like `nonsense/photo.jpg`, and a policy that errors instead
-- of returning false is a 500 where a 403 belongs.
create or replace function session_photo_admin(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return is_club_admin(session_club((storage.foldername(object_name))[1]::uuid));
exception when others then
  return false;
end;
$$;

drop policy if exists session_photos_read on storage.objects;
create policy session_photos_read on storage.objects
  for select using (bucket_id = 'session-photos');

-- Upsert is an insert *or* an update depending on whether the object is there,
-- so replacing a photo needs both policies. Without the update one, the second
-- upload of a session's photo is the one that fails.
drop policy if exists session_photos_insert on storage.objects;
create policy session_photos_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'session-photos' and session_photo_admin(name));

drop policy if exists session_photos_update on storage.objects;
create policy session_photos_update on storage.objects
  for update to authenticated using (
    bucket_id = 'session-photos' and session_photo_admin(name));

drop policy if exists session_photos_delete on storage.objects;
create policy session_photos_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'session-photos' and session_photo_admin(name));

notify pgrst, 'reload schema';
