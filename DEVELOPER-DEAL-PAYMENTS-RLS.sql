-- ============================================================================
-- CoDevProperty — Let a developer self-manage PAYMENT CALLS on their own deals.
-- Adds an owner UPDATE policy on transactions, constrained by a guard trigger so
-- the developer may change ONLY payments + unit_ref (nothing else on the deal).
-- RLS alone is row-level and cannot limit columns, so the trigger is required.
--
-- Run ONCE as the project owner. Idempotent. Depends on TRANSACTIONS.sql +
-- DEAL-PAYMENTS.sql (unit_ref/payments columns) and the owns_property /
-- can_legal_review helpers.
-- ============================================================================

-- 1) Allow the listing owner (developer) to UPDATE their listing's transactions.
drop policy if exists tx_owner_update on public.transactions;
create policy tx_owner_update on public.transactions for update to authenticated
  using ( public.owns_property(property_id) )
  with check ( public.owns_property(property_id) );

-- 2) Guard: on the developer-owner path, freeze every column except
--    payments + unit_ref. Admin/legal keep full control; the buyer path is
--    unchanged (buyers may still update their own row as before).
create or replace function public.guard_tx_owner_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if public.can_legal_review() then return NEW; end if;   -- admin / legal: unrestricted
  if NEW.user_id = auth.uid() then return NEW; end if;     -- buyer updating own deal: unchanged
  if public.owns_property(OLD.property_id) then             -- developer/owner: payments + unit_ref only
    NEW.id               := OLD.id;
    NEW.property_id      := OLD.property_id;
    NEW.user_id          := OLD.user_id;
    NEW.user_email       := OLD.user_email;
    NEW.user_name        := OLD.user_name;
    NEW.tx_type          := OLD.tx_type;
    NEW.status           := OLD.status;
    NEW.amount           := OLD.amount;
    NEW.currency         := OLD.currency;
    NEW.documents        := OLD.documents;
    NEW.funding_evidence := OLD.funding_evidence;
    NEW.funding_note     := OLD.funding_note;
    NEW.completion_ref   := OLD.completion_ref;
    NEW.completion_note  := OLD.completion_note;
    NEW.completed_at     := OLD.completed_at;
    NEW.created_by       := OLD.created_by;
    NEW.created_at       := OLD.created_at;
    -- payments, unit_ref and updated_at remain changeable.
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_guard_tx_owner_update on public.transactions;
create trigger trg_guard_tx_owner_update
  before update on public.transactions for each row
  execute function public.guard_tx_owner_update();

notify pgrst, 'reload schema';
-- ============================================================================
