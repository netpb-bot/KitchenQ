-- M4 payments ledger.
--
-- The ledger is kept by the database, not the client. A player can arrive
-- through join_session, through the host's "add player", or by being typed in
-- as a guest, and the fee applies identically in all three — so the entry is
-- created by a trigger on session_players rather than repeated at every call
-- site, where one missed path silently loses money.
--
-- All four functions are SECURITY DEFINER: whether a fee is owed cannot depend
-- on which player happened to trip the trigger.

-- ------------------------------------------------------------------- status
--
-- `status` is derived, never written by the client — it is what the
-- (club_member_id, status) index is for, and two sources for one fact drift.
create or replace function ledger_derive_status()
returns trigger language plpgsql as $$
begin
  -- A zero fee settles itself, so a free session shows everyone square rather
  -- than everyone unpaid.
  if new.amount_paid >= new.amount_due then
    new.status := 'paid';
  elsif new.amount_paid > 0 then
    new.status := 'partial';
  else
    new.status := 'unpaid';
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' or new.amount_paid is distinct from old.amount_paid then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_status on ledger_entries;
create trigger ledger_status
  before insert or update on ledger_entries
  for each row execute function ledger_derive_status();

-- ------------------------------------------------------- arriving and leaving
--
-- One trigger for both directions, on INSERT *and* UPDATE. Rejoining is not an
-- insert — join_session upserts a player who left back to 'waiting' — so an
-- insert-only trigger would let anyone the host removed come back and play the
-- rest of the night for free.
--
-- Removing someone who never showed should not leave them owing. But once cash
-- has changed hands the entry is a record of that, and deleting it would lose
-- the money — so a paid or part-paid entry survives being removed.
create or replace function ledger_sync_player()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A requeue after every match rewrites this row; only a change of status
  -- can change what is owed.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'left' then
    delete from ledger_entries
     where session_id = new.session_id
       and club_member_id = new.club_member_id
       and amount_paid = 0;
  else
    insert into ledger_entries (session_id, club_member_id, amount_due)
    select new.session_id, new.club_member_id, s.fee_amount
      from sessions s where s.id = new.session_id
    on conflict (session_id, club_member_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists sp_creates_ledger_entry on session_players;
drop trigger if exists sp_removes_ledger_entry on session_players;
drop trigger if exists sp_syncs_ledger_entry on session_players;
create trigger sp_syncs_ledger_entry
  after insert or update on session_players
  for each row execute function ledger_sync_player();

-- --------------------------------------------------------------- fee changes
--
-- The host setting the fee after players have arrived is the normal case, not
-- an edge one. Entries already part-paid are left alone: the amount collected
-- against them was agreed at the old price.
create or replace function ledger_on_fee_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ledger_entries
     set amount_due = new.fee_amount
   where session_id = new.id
     and amount_paid = 0;
  return new;
end;
$$;

drop trigger if exists session_fee_updates_ledger on sessions;
create trigger session_fee_updates_ledger
  after update of fee_amount on sessions
  for each row when (old.fee_amount is distinct from new.fee_amount)
  execute function ledger_on_fee_change();

-- ------------------------------------------------------------------ backfill
--
-- Anyone already in a session predates the triggers. Idempotent, so re-running
-- the migration is harmless.
insert into ledger_entries (session_id, club_member_id, amount_due)
select sp.session_id, sp.club_member_id, s.fee_amount
  from session_players sp
  join sessions s on s.id = sp.session_id
 where sp.status <> 'left'
on conflict (session_id, club_member_id) do nothing;

notify pgrst, 'reload schema';
