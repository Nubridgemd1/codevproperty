-- ============================================================================
-- CoDev — Platform email notifications (complete setup)
-- Emails on the key platform events, via pg_net -> Resend (same setup as
-- send_welcome_if_needed). Run ONCE in the Supabase SQL editor as the
-- PROJECT-OWNING account (project ref zfjwbdfaxgvdwepmkwce).
--
-- Events covered:
--   ADMIN gets:  new account (developer/owner onboarding), new listing submitted
--   USER  gets:  account approved / rejected, listing verified / rejected
--
-- BEFORE RUNNING: put your Resend API key in _resend_key() below (the ONLY line
-- to edit). Creating a NEW Resend key does not disrupt existing keys — just
-- don't delete the key the welcome email uses. Sender domain codevproperty.com
-- is already verified in Resend. pg_net is already enabled (welcome emails use it).
--
-- NOTE: never commit the real key to git — keep the placeholder here and set the
-- real value only in the Supabase SQL editor.
-- ============================================================================

-- 0) Resend key (edit this one line in the SQL editor; keep the placeholder in git)
create or replace function public._resend_key() returns text
  language sql immutable as $$ select 're_XXXXXXXXXXXXXXXXXXXX'::text $$;
revoke execute on function public._resend_key() from public, anon, authenticated;

-- ---- ADMIN: new account (developer / owner onboarding, etc.) ----------------
create or replace function public.notify_admin_new_account() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),
                                  'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from','CoDev <noreply@codevproperty.com>',
      'to',  jsonb_build_array('admin@codevproperty.com'),
      'subject','New '||coalesce(NEW.role,'member')||' account: '||coalesce(NEW.name,NEW.email),
      'html','<p>A new account was created on CoDev.</p>'||
             '<p><b>Name:</b> '||coalesce(NEW.name,'—')||'<br>'||
             '<b>Email:</b> '||coalesce(NEW.email,'—')||'<br>'||
             '<b>Role:</b> '||coalesce(NEW.role,'—')||'<br>'||
             '<b>Status:</b> '||coalesce(NEW.status,'pending')||'</p>'||
             '<p><a href="https://codevproperty.com/admin.html">Open the admin console</a></p>'));
  return NEW;
exception when others then return NEW;  -- never block the signup on a mail error
end; $$;
drop trigger if exists trg_notify_admin_new_account on public.profiles;
create trigger trg_notify_admin_new_account
  after insert on public.profiles for each row
  execute function public.notify_admin_new_account();

-- ---- ADMIN: new development / listing submitted ----------------------------
create or replace function public.notify_admin_new_listing() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||public._resend_key(),
                                  'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from','CoDev <noreply@codevproperty.com>',
      'to',  jsonb_build_array('admin@codevproperty.com'),
      'subject','New listing awaiting verification: '||coalesce(NEW.title,'(untitled)'),
      'html','<p>A new development/listing was submitted and awaits verification.</p>'||
             '<p><b>Title:</b> '||coalesce(NEW.title,'—')||'<br>'||
             '<b>Location:</b> '||coalesce(NEW.location,'—')||'<br>'||
             '<b>Developer/owner:</b> '||coalesce(NEW.developer,'—')||'<br>'||
             '<b>Submitted by:</b> '||coalesce(NEW.submitted_by_email,'—')||'<br>'||
             '<b>From:</b> ₦'||coalesce(NEW.price_from::text,'—')||'</p>'||
             '<p><a href="https://codevproperty.com/admin.html">Verify in the admin console</a></p>'));
  return NEW;
exception when others then return NEW;
end; $$;
drop trigger if exists trg_notify_admin_new_listing on public.properties;
create trigger trg_notify_admin_new_listing
  after insert on public.properties for each row
  execute function public.notify_admin_new_listing();

-- ---- USER: account approved / activated / rejected -------------------------
create or replace function public.notify_account_status() returns trigger
  language plpgsql security definer set search_path = public as $$
declare subj text; msg text;
begin
  if OLD.status is distinct from NEW.status then
    if NEW.status in ('approved','active') then
      subj := 'Your CoDev account is verified';
      msg  := '<p>Good news — your CoDev account has been verified and activated.</p>'||
              '<p>You can now sign in and '||
              (case NEW.role when 'developer' then 'list developments and raise co-development capital'
                             when 'investor'  then 'browse verified opportunities and express interest'
                             else 'list your property' end)||'.</p>'||
              '<p><a href="https://codevproperty.com">Go to CoDev</a></p>';
    elsif NEW.status = 'rejected' then
      subj := 'Update on your CoDev account';
      msg  := '<p>Thank you for your interest in CoDev. Your account was not approved at this time.</p>'||
              '<p>If you think this is an error, please reply to this email.</p>';
    else
      return NEW;
    end if;
    perform net.http_post(
      url:='https://api.resend.com/emails',
      headers:=jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
      body:=jsonb_build_object('from','CoDev <noreply@codevproperty.com>',
                               'to',jsonb_build_array(NEW.email),'subject',subj,'html',msg));
  end if;
  return NEW;
exception when others then return NEW;
end; $$;
drop trigger if exists trg_notify_account_status on public.profiles;
create trigger trg_notify_account_status
  after update of status on public.profiles for each row
  execute function public.notify_account_status();

-- ---- USER: listing verified / rejected -------------------------------------
create or replace function public.notify_listing_status() returns trigger
  language plpgsql security definer set search_path = public as $$
declare subj text; msg text; who text;
begin
  who := coalesce(NEW.submitted_by_email,'');
  if who <> '' and OLD.status is distinct from NEW.status then
    if NEW.status = 'verified' then
      subj := 'Your development is now live on CoDev';
      msg  := '<p>Your development <b>'||coalesce(NEW.title,'')||'</b> has been verified and is now live on CoDev.</p>'||
              '<p><a href="https://codevproperty.com/#/opportunities">View it on the marketplace</a></p>';
    elsif NEW.status = 'rejected' then
      subj := 'Update on your CoDev listing';
      msg  := '<p>Your development <b>'||coalesce(NEW.title,'')||'</b> was not approved for publishing yet. '||
              'Please review and resubmit, or reply for guidance.</p>';
    else
      return NEW;
    end if;
    perform net.http_post(
      url:='https://api.resend.com/emails',
      headers:=jsonb_build_object('Authorization','Bearer '||public._resend_key(),'Content-Type','application/json'),
      body:=jsonb_build_object('from','CoDev <noreply@codevproperty.com>',
                               'to',jsonb_build_array(who),'subject',subj,'html',msg));
  end if;
  return NEW;
exception when others then return NEW;
end; $$;
drop trigger if exists trg_notify_listing_status on public.properties;
create trigger trg_notify_listing_status
  after update of status on public.properties for each row
  execute function public.notify_listing_status();

-- To notify more recipients on the ADMIN emails, add addresses to the
-- jsonb_build_array('admin@codevproperty.com', ...) 'to' lists above.
-- ============================================================================
