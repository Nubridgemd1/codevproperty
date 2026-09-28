-- ============================================================================
-- CoDev — Express Interest (production)
-- Stores a signed-in member's expression of interest in a verified development,
-- and emails the team (admin@codevproperty.com) when one comes in.
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Safe to re-run (idempotent).
--
-- Requires public._resend_key() from ADMIN-NOTIFICATIONS.sql (run that first).
-- ============================================================================

-- 1) Table -------------------------------------------------------------------
create table if not exists public.interests (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid references public.properties(id) on delete set null,
  property_title text,
  developer      text,
  message        text,
  user_id        uuid references auth.users(id) on delete set null,
  user_email     text,
  user_name      text,
  created_at     timestamptz not null default now()
);

alter table public.interests enable row level security;

-- 2) RLS ---------------------------------------------------------------------
-- A signed-in member may create their OWN interest (user_id must be themselves).
drop policy if exists interests_insert_own on public.interests;
create policy interests_insert_own on public.interests
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Admins may read all interests (for follow-up).
drop policy if exists interests_admin_read on public.interests;
create policy interests_admin_read on public.interests
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- A member may read the interests they submitted.
drop policy if exists interests_read_own on public.interests;
create policy interests_read_own on public.interests
  for select to authenticated
  using (auth.uid() = user_id);

-- 3) Email notification on a new interest (pg_net -> Resend) ------------------
create or replace function public.notify_admin_new_interest() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),
                                  'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from','CoDev <noreply@codevproperty.com>',
      'to',  jsonb_build_array('admin@codevproperty.com'),
      'subject','New interest: '||coalesce(NEW.property_title,'a development'),
      'html','<p>A member expressed interest in a development on CoDev.</p>'||
             '<p><b>Development:</b> '||coalesce(NEW.property_title,'—')||'<br>'||
             '<b>Developer:</b> '||coalesce(NEW.developer,'—')||'<br>'||
             '<b>From:</b> '||coalesce(NEW.user_name,'—')||' ('||coalesce(NEW.user_email,'—')||')</p>'||
             '<p><b>Message:</b><br>'||coalesce(nullif(NEW.message,''),'<i>(none)</i>')||'</p>'||
             '<p><a href="https://codevproperty.com/admin.html">Open the admin console</a></p>'));
  return NEW;
exception when others then return NEW;   -- never block the interest on a mail error
end; $$;

drop trigger if exists trg_notify_admin_new_interest on public.interests;
create trigger trg_notify_admin_new_interest
  after insert on public.interests for each row
  execute function public.notify_admin_new_interest();

-- Done. The public "Express interest" button now records to public.interests
-- and emails admin@codevproperty.com. Add more recipients to the jsonb 'to'
-- array above if needed.
-- ============================================================================
