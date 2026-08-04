-- Three skill levels, not five.
--
-- 0001 shipped a five-value ladder borrowed from badminton grading
-- (beginner / novice / bridge / advanced / pro). "Bridge" means nothing to a
-- pickleball club, and five levels is more precision than a host can judge
-- honestly while people are waiting to play. Collapsing to three keeps the
-- matchmaking signal and drops the guesswork.
--
-- Existing rows are folded in: novice joins beginner, bridge becomes
-- intermediate, pro joins advanced.

do $$
begin
  -- Only run on the old five-value type, so re-running this file is harmless.
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'skill_tier' and e.enumlabel = 'bridge'
  ) then
    execute 'alter table club_members alter column skill_tier drop default';
    execute 'alter type skill_tier rename to skill_tier_old';
    execute $ddl$create type skill_tier as enum ('beginner', 'intermediate', 'advanced')$ddl$;
    execute $ddl$
      alter table club_members
        alter column skill_tier type skill_tier
        using case skill_tier::text
          when 'novice' then 'beginner'
          when 'bridge' then 'intermediate'
          when 'pro'    then 'advanced'
          else skill_tier::text
        end::skill_tier
    $ddl$;
    execute $ddl$alter table club_members alter column skill_tier set default 'intermediate'$ddl$;
    execute 'drop type skill_tier_old';
  end if;
end;
$$;

notify pgrst, 'reload schema';
