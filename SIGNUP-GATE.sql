-- ============================================================================
-- CoDev — Invitation-only signup gate  (OPTIONAL hardening)
-- Guarantees AT THE SERVER that an account can only be created for an email that
-- has an APPROVED / INVITED expression of interest (or was pre-approved by an
-- admin). Public self-signup is already removed in the UI; this makes it airtight.
--
-- FAIL-OPEN BY DESIGN: if the check errors for any unexpected reason, the signup
-- is ALLOWED — a problem here can never lock everyone out. Only a deliberate
-- "not invited" case is blocked.
--
-- Run ONCE in the Supabase SQL editor AFTER EOI-APPLICATIONS.sql. Safe to re-run.
-- To DISABLE later:  drop trigger trg_signup_gate on auth.users;
-- ============================================================================

-- 1) Admin pre-approval RPC — the console "Add account" / "Create admin" flows
--    call this first so the gate allows admin-created accounts. Admin-only.
create or replace function public.admin_preapprove_signup(e text, nm text default null, k text default 'buyer')
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only admins may pre-approve signups';
  end if;
  if exists (select 1 from public.eoi_applications where lower(email) = lower(e)) then
    update public.eoi_applications set status = 'approved'
      where lower(email) = lower(e) and status not in ('approved','invited','activated');
  else
    insert into public.eoi_applications (kind, status, full_name, email, admin_notes)
      values (case when k = 'developer' then 'developer' else 'buyer' end, 'approved', nm, e, 'Admin-created account');
  end if;
end; $$;

revoke all on function public.admin_preapprove_signup(text, text, text) from public, anon;
grant execute on function public.admin_preapprove_signup(text, text, text) to authenticated;

-- 2) The gate: block an auth.users insert whose email has no approved/invited EOI.
create or replace function public.enforce_invite_only_signup() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allow boolean := true;
begin
  -- Fail-open: any error while checking → allow the signup (never lock people out).
  begin
    allow := exists (
      select 1 from public.eoi_applications e
      where lower(e.email) = lower(NEW.email) and e.status in ('approved','invited','activated'));
  exception when others then allow := true;
  end;
  if allow then return NEW; end if;
  raise exception 'Account creation on CoDev is by invitation only. Please submit an expression of interest at codevproperty.com.'
        using errcode = 'P0001';
end; $$;

drop trigger if exists trg_signup_gate on auth.users;
create trigger trg_signup_gate before insert on auth.users
  for each row execute function public.enforce_invite_only_signup();

-- Done. Only emails with an approved/invited EOI (or admin pre-approval) can now
-- create an account. TEST BEFORE RELYING ON IT:
--   • an approved/invited applicant's email  -> signup succeeds
--   • a random email with no EOI             -> signup refused with the message
--   • admin "Add account" in the console     -> still works (it pre-approves first)
-- ============================================================================
