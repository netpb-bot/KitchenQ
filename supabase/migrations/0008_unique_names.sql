-- One name, one player, within a club.
--
-- Nothing stopped two "Mike" rows before this. That is not untidiness: MatchRow,
-- ScoreEntry and CourtDiagram all render the first name only, Avatar derives the
-- same initials for both, and the fee ledger lists two lines nobody can tell
-- apart. AddGuestForm clears and refocuses after every add — repeat submission is
-- the designed-for case — so the collision arrives on an ordinary Tuesday.
--
-- The client checks first and explains better, but only this index survives two
-- phones submitting at the same instant.

-- ------------------------------------------------------------- normalisation
--
-- Canonicalising on write means the index can stay a plain lower(display_name),
-- the stored value always equals what gets displayed, and create_club's
-- never-trimmed owner_name is fixed without touching that function.

create or replace function normalize_member_name() returns trigger
language plpgsql as $$
begin
  -- Non-breaking space is translated before the \s pass: Postgres's \s does not
  -- match it and JavaScript's does, and the client-side check has to agree with
  -- this index exactly or it blocks names the database would have accepted.
  new.display_name := regexp_replace(
    btrim(translate(new.display_name, chr(160), ' ')), '\s+', ' ', 'g');

  if new.display_name = '' then
    raise exception 'a name is required';
  end if;
  return new;
end $$;

-- `of display_name` so an ordinary role or skill_tier update skips this entirely.
-- Fires alongside club_members_guard_owner; they touch different columns.
drop trigger if exists club_members_normalize_name on club_members;
create trigger club_members_normalize_name
  before insert or update of display_name on club_members
  for each row execute function normalize_member_name();

-- ------------------------------------------------------------------ backfill

-- Existing rows, through the trigger. " Mike " becomes "Mike" before anything
-- below compares it to anyone.
update club_members set display_name = display_name;

-- Then the duplicates. Oldest row keeps the plain name; the rest take a suffix.
--
-- ponytail: loops because a rename can collide too — a club containing "Mike",
-- "Mike" and a literal "Mike (2)" needs a second pass, which yields "Mike (2) (2)".
-- Ugly and rare, but it terminates and the index is never left uncreated. Hosts
-- rename properly from the roster afterwards.
do $$
begin
  loop
    with ranked as (
      select id,
             display_name,
             row_number() over (
               partition by club_id,
                            lower(regexp_replace(
                              btrim(translate(display_name, chr(160), ' ')), '\s+', ' ', 'g'))
               order by created_at, id
             ) as n
        from club_members
    )
    update club_members m
       set display_name = r.display_name || ' (' || r.n || ')'
      from ranked r
     where m.id = r.id
       and r.n > 1;

    exit when not found;
  end loop;
end $$;

-- ---------------------------------------------------------------- constraint

-- Scoped to club_id: the same person in two clubs is two rows, and both are
-- legal. Not partial — guests and signed-in members share one namespace, which
-- is what "unique within the club" has to mean for the court diagram to work.
create unique index club_members_unique_name
  on club_members (club_id, lower(display_name));

notify pgrst, 'reload schema';
