-- ============================================================================
-- CoDev — Investor / Buyer Qualification pipeline
-- Stores each investor's qualification against a development (investor type,
-- intent, capacity, source of funds, declaration) and lets CoDev admins record
-- identity/KYC gates and an overall status (→ CoDev Verified before Deal Room).
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Idempotent — safe to re-run.
-- Requires public._resend_key() from ADMIN-NOTIFICATIONS.sql for the email.
-- ============================================================================

-- 1) Table -------------------------------------------------------------------
create table if not exists public.qualifications (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid references public.properties(id) on delete set null,
  property_title    text,
  developer         text,
  user_id           uuid references auth.users(id) on delete set null,
  user_email        text,
  user_name         text,
  investor_type     text,
  unit_type         text,
  amount_band       text,
  currency          text,
  objective         text,
  readiness         text,
  funding_method    text,
  capacity_range    text,
  mortgage_required boolean default false,
  source_of_funds   text,
  declaration       boolean default false,
  gate_identity     text default 'pending',   -- pending / passed / review / failed
  gate_kyc          text default 'pending',   -- pending / passed / review / failed
  status            text default 'qualification_in_progress',
  verified_by       text,
  verified_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.qualifications enable row level security;

-- 2) RLS ---------------------------------------------------------------------
-- A signed-in member may create their OWN qualification.
drop policy if exists qualifications_insert_own on public.qualifications;
create policy qualifications_insert_own on public.qualifications
  for insert to authenticated with check (auth.uid() = user_id);

-- A member may read the qualifications they submitted.
drop policy if exists qualifications_read_own on public.qualifications;
create policy qualifications_read_own on public.qualifications
  for select to authenticated using (auth.uid() = user_id);

-- Admins may read all.
drop policy if exists qualifications_admin_read on public.qualifications;
create policy qualifications_admin_read on public.qualifications
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Admins may update the gates / status / verification.
drop policy if exists qualifications_admin_update on public.qualifications;
create policy qualifications_admin_update on public.qualifications
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 3) Email CoDev when a new qualification arrives (pg_net -> Resend) ----------
create or replace function public.notify_admin_new_qualification() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),
                                  'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from','CoDev <noreply@codevproperty.com>',
      'to',  jsonb_build_array('admin@codevproperty.com'),
      'subject','New investor qualification: '||coalesce(NEW.property_title,'a development'),
      'html','<p>A new investor qualification was submitted on CoDev.</p>'||
             '<p><b>Investor:</b> '||coalesce(NEW.user_name,'—')||' ('||coalesce(NEW.user_email,'—')||')<br>'||
             '<b>Type:</b> '||coalesce(NEW.investor_type,'—')||'<br>'||
             '<b>Development:</b> '||coalesce(NEW.property_title,'—')||'<br>'||
             '<b>Amount:</b> '||coalesce(NEW.amount_band,'—')||' '||coalesce(NEW.currency,'')||'<br>'||
             '<b>Capacity:</b> '||coalesce(NEW.capacity_range,'—')||'<br>'||
             '<b>Readiness:</b> '||coalesce(NEW.readiness,'—')||'<br>'||
             '<b>Source of funds:</b> '||coalesce(NEW.source_of_funds,'—')||'</p>'||
             '<p><a href="https://codevproperty.com/admin.html">Review in the Investors pipeline</a></p>'));
  return NEW;
exception when others then return NEW;
end; $$;

drop trigger if exists trg_notify_admin_new_qualification on public.qualifications;
create trigger trg_notify_admin_new_qualification
  after insert on public.qualifications for each row
  execute function public.notify_admin_new_qualification();
-- ============================================================================
