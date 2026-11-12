-- ============================================================================
-- CoDev — Admin: update a registered account holder's email  (production)
-- Lets a SuperAdmin correct the sign-in email of an existing account (e.g. a
-- developer created with the wrong address) and re-notify the correct inbox.
--
-- The login email lives in auth.users, which the client (anon key) cannot change.
-- This SECURITY DEFINER function performs the change server-side, gated so that
-- ONLY an admin (public.profiles.role = 'admin') can call it. It updates:
--   • auth.users.email  (+ marks it confirmed, clears any pending email-change)
--   • auth.identities    (email-provider identity_data, best-effort)
--   • public.profiles.email
-- and (optionally) emails the new address via Resend.
--
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account.
-- Requires public._resend_key() from ADMIN-NOTIFICATIONS.sql (run that first).
-- Safe to re-run (idempotent).
-- ============================================================================

create or replace function public.admin_update_account_email(
  p_user   uuid,
  p_email  text,
  p_notify boolean default true
) returns json
  language plpgsql
  security definer
  set search_path = public, auth
as $$
declare
  v_norm  text := lower(trim(p_email));
  v_clash int;
begin
  -- 1) Caller must be an admin ------------------------------------------------
  if not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role = 'admin'
  ) then
    raise exception 'Not authorised: admin only';
  end if;

  -- 2) Validate the new email -------------------------------------------------
  if v_norm is null or v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter a valid email address';
  end if;

  -- 3) Must not already belong to a different account -------------------------
  select count(*) into v_clash
  from auth.users u
  where lower(u.email) = v_norm and u.id <> p_user;
  if v_clash > 0 then
    raise exception 'That email is already in use by another account';
  end if;

  -- 4) Update the auth login email (confirmed; clear any pending change) -------
  update auth.users
     set email                       = v_norm,
         email_confirmed_at          = now(),
         email_change                = '',
         email_change_token_new      = '',
         email_change_token_current  = '',
         email_change_confirm_status = 0,
         updated_at                  = now()
   where id = p_user;
  if not found then
    raise exception 'Account not found';
  end if;

  -- 5) Keep the email-provider identity in step (best-effort; column shapes
  --    vary across Supabase versions, so never fail the change on this) -------
  begin
    update auth.identities
       set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_norm), true),
           updated_at    = now()
     where user_id = p_user
       and provider = 'email';
  exception when others then
    null;
  end;

  -- 6) Mirror onto the profile row -------------------------------------------
  update public.profiles set email = v_norm where id = p_user;

  -- 7) Notify the corrected address (best-effort; never block on a mail error)-
  if p_notify then
    begin
      perform net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
        body    := jsonb_build_object(
          'from','CoDev <noreply@codevproperty.com>',
          'to',  jsonb_build_array(v_norm),
          'subject','Your CoDev account email has been set',
          'html','<p>Hello,</p>'||
                 '<p>An administrator has set this email address for your CoDev account.</p>'||
                 '<p>You can sign in at <a href="https://codevproperty.com/">codevproperty.com</a> using this address. '||
                 'To set or reset your password, choose <b>Forgot password</b> on the sign-in screen and we will email a secure code to this inbox.</p>'||
                 '<p>If you were not expecting this, please contact us at admin@codevproperty.com.</p>'||
                 '<p>— The CoDev team</p>'));
    exception when others then
      null;
    end;
  end if;

  return json_build_object('ok', true, 'email', v_norm);
end;
$$;

-- Only signed-in admins may execute (the body re-checks admin via auth.uid()).
revoke all on function public.admin_update_account_email(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_account_email(uuid, text, boolean) to authenticated;

-- Done. The admin console “Accounts → ✎ Email” action now corrects a registered
-- account holder’s sign-in email and (by default) emails the new address.
-- ============================================================================
