-- ============================================================================
-- CoDevProperty — Admin creates listings & assigns them to a developer,
-- with an automatic email to that developer.
--
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Safe to re-run (idempotent).
--
-- PREREQUISITE: ADMIN-NOTIFICATIONS.sql must already have been run — this reuse
-- its public._resend_key() function (DO NOT redefine the key here; keep it where
-- the owner set the real value). pg_net + Resend sender domain are already set up.
--
-- What this adds:
--   1. Assignment columns on public.properties (assigned_to, assigned_to_email,
--      assigned_by, assigned_at).
--   2. An admin INSERT policy so an admin can create a listing attributed to a
--      developer (submitted_by = that developer), which the existing
--      properties_insert_approved policy forbids (it forces submitted_by = self).
--   3. A trigger that emails the assigned developer the moment a listing is
--      created for them, or re-assigned to them.
--
--   (The developer is ALSO emailed when the listing is published, via the
--    existing trg_notify_listing_status in ADMIN-NOTIFICATIONS.sql, because the
--    admin-created listing's submitted_by_email is the developer's address.)
-- ============================================================================

-- 1) Assignment columns -------------------------------------------------------
alter table public.properties
  add column if not exists assigned_to        uuid,
  add column if not exists assigned_to_email  text,
  add column if not exists assigned_by        text,
  add column if not exists assigned_at         timestamptz;

comment on column public.properties.assigned_to       is 'Developer (profiles.id) an admin assigned this listing to; listing ownership (submitted_by) is also set to this id so it shows in the developer portal.';
comment on column public.properties.assigned_to_email is 'Email of the assigned developer (notification recipient).';
comment on column public.properties.assigned_by       is 'Admin email that created/assigned the listing.';
comment on column public.properties.assigned_at        is 'When the listing was assigned.';

-- 2) Admin INSERT policy ------------------------------------------------------
-- The verification gate's properties_insert_approved forces submitted_by = auth.uid(),
-- so an admin cannot create a row owned by a developer. This permissive policy is
-- OR'd with it: an admin may insert any properties row (incl. attributed to a dev).
drop policy if exists properties_insert_admin on public.properties;
create policy properties_insert_admin on public.properties
  for insert to authenticated
  with check ( public.is_admin() );

-- 3) Notify the assigned developer -------------------------------------------
create or replace function public.notify_developer_assigned() returns trigger
  language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := coalesce(NEW.assigned_to_email, '');
  -- Fire when a listing is newly assigned to a developer: on INSERT (admin created
  -- it for them) or on UPDATE when the assignee changes. Never re-fire for an
  -- unchanged assignee, and never for developer self-listings (assigned_to_email NULL).
  if who <> '' and ( TG_OP = 'INSERT'
                     or coalesce(OLD.assigned_to_email,'') is distinct from who ) then
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),
                                    'Content-Type','application/json'),
      body    := jsonb_build_object(
        'from','CoDev <noreply@codevproperty.com>',
        'to',  jsonb_build_array(who),
        'subject','A development has been assigned to you on CoDev: '||coalesce(NEW.title,'(untitled)'),
        'html','<p>Hello,</p>'||
               '<p>A development listing has been created for you on CoDev and added to your developer portal.</p>'||
               '<p><b>Listing:</b> '||coalesce(NEW.title,'—')||'<br>'||
               '<b>Reference:</b> '||coalesce(NEW.ref,'(assigned on publish)')||'<br>'||
               '<b>Location:</b> '||coalesce(NEW.location,'—')||'<br>'||
               '<b>Address:</b> '||coalesce(NEW.address,'—')||'<br>'||
               '<b>Status:</b> '||coalesce(NEW.status,'pending')||'</p>'||
               '<p>Sign in to review and manage it from your portal.</p>'||
               '<p><a href="https://codevproperty.com/#/developer">Open your developer portal</a></p>'));
  end if;
  return NEW;
exception when others then return NEW;  -- never block the write on a mail error
end; $$;

drop trigger if exists trg_notify_developer_assigned_ins on public.properties;
create trigger trg_notify_developer_assigned_ins
  after insert on public.properties for each row
  execute function public.notify_developer_assigned();

drop trigger if exists trg_notify_developer_assigned_upd on public.properties;
create trigger trg_notify_developer_assigned_upd
  after update of assigned_to_email on public.properties for each row
  execute function public.notify_developer_assigned();

-- 4) Reload PostgREST schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';
-- ============================================================================
