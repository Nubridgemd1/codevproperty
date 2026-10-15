-- ============================================================================
-- CoDev — Expression of Interest (EOI) applications  (production)
-- Controlled onboarding: developers and buyers submit a qualifying EOI BEFORE
-- any account exists. A record is stored here, the team is emailed a structured
-- summary, and the applicant gets an acknowledgement. Admins review in the
-- console and approve/decline/invite. Submitting an EOI never creates an account.
--
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Safe to re-run (idempotent).
-- Requires public._resend_key() from ADMIN-NOTIFICATIONS.sql (run that first).
-- ============================================================================

-- 1) Table -------------------------------------------------------------------
create table if not exists public.eoi_applications (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  kind        text not null check (kind in ('developer','buyer')),
  status      text not null default 'new'
              check (status in ('new','under_review','info_requested','approved','declined','invited','activated')),
  full_name   text,
  email       text,
  phone       text,
  company     text,           -- developer: company / trading name
  country     text,           -- buyer: country of residence
  details     jsonb not null default '{}'::jsonb,   -- all remaining role-specific fields
  consent     boolean not null default false,
  admin_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.eoi_applications enable row level security;

-- 2) RLS ---------------------------------------------------------------------
-- Public submission: anyone (anon or signed-in) may INSERT a brand-new EOI.
-- They can only create a 'new' record and cannot set review fields; a honeypot
-- is enforced client-side. No public SELECT, so submissions are never readable
-- by the public.
drop policy if exists eoi_insert_public on public.eoi_applications;
create policy eoi_insert_public on public.eoi_applications
  for insert to anon, authenticated
  with check (status = 'new' and admin_notes is null and reviewed_by is null);

-- Admins may read and update every EOI (review workflow).
drop policy if exists eoi_admin_read on public.eoi_applications;
create policy eoi_admin_read on public.eoi_applications
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists eoi_admin_update on public.eoi_applications;
create policy eoi_admin_update on public.eoi_applications
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 3) Reference number (EOI-XXXXXX, unambiguous alphabet) ----------------------
create or replace function public.eoi_set_ref() returns trigger
  language plpgsql as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text := ''; i int;
begin
  if NEW.ref is null or NEW.ref = '' then
    for i in 1..6 loop s := s || substr(a, 1 + floor(random()*length(a))::int, 1); end loop;
    NEW.ref := 'EOI-' || s;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_eoi_set_ref on public.eoi_applications;
create trigger trg_eoi_set_ref before insert on public.eoi_applications
  for each row execute function public.eoi_set_ref();

-- 4) Notify admin + acknowledge applicant on a new EOI (pg_net -> Resend) ------
create or replace function public.notify_new_eoi() returns trigger
  language plpgsql security definer set search_path = public as $$
declare rolelbl text := case when NEW.kind = 'developer' then 'Developer' else 'Buyer / Co-Developer' end;
begin
  -- a) structured summary to the team (no uploaded documents in the email)
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from','CoDev <noreply@codevproperty.com>',
      'to',  jsonb_build_array('admin@codevproperty.com'),
      'subject','New '||rolelbl||' Expression of Interest · '||coalesce(NEW.ref,''),
      'html','<p>A new '||rolelbl||' expression of interest was submitted on CoDev.</p>'||
             '<p><b>Reference:</b> '||coalesce(NEW.ref,'—')||'<br>'||
             '<b>Applicant role:</b> '||rolelbl||'<br>'||
             '<b>Name:</b> '||coalesce(NEW.full_name,'—')||'<br>'||
             '<b>Company:</b> '||coalesce(NEW.company,'—')||'<br>'||
             '<b>Email:</b> '||coalesce(NEW.email,'—')||'<br>'||
             '<b>Phone:</b> '||coalesce(NEW.phone,'—')||'<br>'||
             '<b>Country:</b> '||coalesce(NEW.country,'—')||'<br>'||
             '<b>Status:</b> New — Awaiting Review</p>'||
             '<p><b>Details:</b><br>'||coalesce(replace(NEW.details::text,',',',<br>'),'—')||'</p>'||
             '<p>Review and approve, request more information or decline in the '||
             '<a href="https://codevproperty.com/admin.html">admin console</a>.</p>'));
  -- b) acknowledgement to the applicant
  if NEW.email is not null and NEW.email <> '' then
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
      body    := jsonb_build_object(
        'from','CoDev <noreply@codevproperty.com>',
        'to',  jsonb_build_array(NEW.email),
        'subject','We received your expression of interest — CoDev',
        'html','<p>Hello '||coalesce(NEW.full_name,'')||',</p>'||
               '<p>Thank you for your interest in CoDev. We have received your '||rolelbl||
               ' expression of interest (reference <b>'||coalesce(NEW.ref,'')||'</b>).</p>'||
               '<p>Our team will review it and be in touch with the next steps. '||
               'You do not have an account yet — if approved, you will receive a secure invitation to set one up.</p>'||
               '<p>— The CoDev team</p>'));
  end if;
  return NEW;
exception when others then return NEW;   -- never block a submission on a mail error
end; $$;

drop trigger if exists trg_notify_new_eoi on public.eoi_applications;
create trigger trg_notify_new_eoi after insert on public.eoi_applications
  for each row execute function public.notify_new_eoi();

-- 5) When an admin marks an application 'invited', email the applicant a secure
--    link to create their account. Fires only on the transition into 'invited'.
create or replace function public.notify_eoi_invited() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'invited' and coalesce(OLD.status,'') <> 'invited'
     and NEW.email is not null and NEW.email <> '' then
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
      body    := jsonb_build_object(
        'from','CoDev <noreply@codevproperty.com>',
        'to',  jsonb_build_array(NEW.email),
        'subject','You''re approved — activate your CoDev account',
        'html','<p>Hello '||coalesce(NEW.full_name,'')||',</p>'||
               '<p>Good news — your expression of interest (reference <b>'||coalesce(NEW.ref,'')||'</b>) has been approved.</p>'||
               '<p>You can now create your CoDev account using this email address:</p>'||
               '<p><a href="https://codevproperty.com/#/activate">Activate my account</a></p>'||
               '<p>For your security, please sign up with the same email address ('||NEW.email||').</p>'||
               '<p>— The CoDev team</p>'));
  end if;
  return NEW;
exception when others then return NEW;
end; $$;

drop trigger if exists trg_notify_eoi_invited on public.eoi_applications;
create trigger trg_notify_eoi_invited after update on public.eoi_applications
  for each row execute function public.notify_eoi_invited();

-- Done. The landing "Submit Developer Interest" / "Register Your Interest"
-- buttons now record to public.eoi_applications, email admin@codevproperty.com
-- a structured summary, and acknowledge the applicant. Admins review in the
-- console (Applications tab).
--
-- OPTIONAL HARDENING (recommended, separate step): to GUARANTEE at the server
-- that only an approved applicant can ever create an account, add a Supabase
-- "before user created" auth hook (edge function, service role) that rejects a
-- signup whose email has no eoi_applications row with status in
-- ('approved','invited'). Until then, the public sign-up entry point is removed
-- and the existing admin-approval gate keeps un-approved accounts from any
-- platform access.
-- ============================================================================
