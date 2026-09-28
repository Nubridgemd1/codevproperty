-- ============================================================================
-- CoDev — Admin event notifications
-- Emails admin@codevproperty.com when a KEY PLATFORM EVENT happens:
--   1) a new account is created (incl. developer / property-owner onboarding)
--   2) a new development / listing is submitted (awaiting verification)
--
-- Mechanism: pg_net -> Resend (the same setup already used by
-- send_welcome_if_needed). Run this ONCE in the Supabase SQL editor as the
-- PROJECT-OWNING account (project ref zfjwbdfaxgvdwepmkwce).
--
-- BEFORE RUNNING: replace <<RESEND_API_KEY>> below with your Resend API key
-- (use the same key that send_welcome_if_needed already uses). Sender domain
-- codevproperty.com is already verified in Resend.
-- ============================================================================

-- pg_net is already enabled (welcome emails use it). If not:
-- create extension if not exists pg_net with schema extensions;

-- ---- 1) New account (developer onboarding etc.) ----------------------------
create or replace function public.notify_admin_new_account() returns trigger
  language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer <<RESEND_API_KEY>>',
                                  'Content-Type',  'application/json'),
    body    := jsonb_build_object(
      'from',    'CoDev <noreply@codevproperty.com>',
      'to',      jsonb_build_array('admin@codevproperty.com'),
      'subject', 'New ' || coalesce(NEW.role, 'member') || ' account: ' || coalesce(NEW.name, NEW.email),
      'html',    '<p>A new account was created on CoDev.</p>' ||
                 '<p><b>Name:</b> '   || coalesce(NEW.name, '—')            || '<br>' ||
                 '<b>Email:</b> '     || coalesce(NEW.email, '—')           || '<br>' ||
                 '<b>Role:</b> '      || coalesce(NEW.role, '—')            || '<br>' ||
                 '<b>Status:</b> '    || coalesce(NEW.status, 'pending')    || '</p>' ||
                 '<p>Review &amp; verify in the admin console: ' ||
                 '<a href="https://codevproperty.com/admin.html">codevproperty.com/admin.html</a></p>'
    )
  );
  return NEW;
exception when others then
  return NEW;  -- never block the signup if the mail call errors
end; $$;

drop trigger if exists trg_notify_admin_new_account on public.profiles;
create trigger trg_notify_admin_new_account
  after insert on public.profiles
  for each row execute function public.notify_admin_new_account();

-- ---- 2) New development / listing submitted --------------------------------
create or replace function public.notify_admin_new_listing() returns trigger
  language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer <<RESEND_API_KEY>>',
                                  'Content-Type',  'application/json'),
    body    := jsonb_build_object(
      'from',    'CoDev <noreply@codevproperty.com>',
      'to',      jsonb_build_array('admin@codevproperty.com'),
      'subject', 'New listing awaiting verification: ' || coalesce(NEW.title, '(untitled)'),
      'html',    '<p>A new development / listing was submitted and is awaiting verification.</p>' ||
                 '<p><b>Title:</b> '           || coalesce(NEW.title, '—')                 || '<br>' ||
                 '<b>Location:</b> '           || coalesce(NEW.location, '—')              || '<br>' ||
                 '<b>Developer / owner:</b> '  || coalesce(NEW.developer, '—')             || '<br>' ||
                 '<b>Submitted by:</b> '       || coalesce(NEW.submitted_by_email, '—')    || '<br>' ||
                 '<b>Participation from:</b> ₦'|| coalesce(NEW.price_from::text, '—')       || '<br>' ||
                 '<b>Status:</b> '             || coalesce(NEW.status, 'pending')          || '</p>' ||
                 '<p>Verify in the admin console: ' ||
                 '<a href="https://codevproperty.com/admin.html">codevproperty.com/admin.html</a></p>'
    )
  );
  return NEW;
exception when others then
  return NEW;
end; $$;

drop trigger if exists trg_notify_admin_new_listing on public.properties;
create trigger trg_notify_admin_new_listing
  after insert on public.properties
  for each row execute function public.notify_admin_new_listing();

-- Done. New signups and new listings now email admin@codevproperty.com.
-- To send to more recipients, add addresses to the jsonb_build_array(...) 'to' lists.
