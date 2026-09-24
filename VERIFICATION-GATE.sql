-- ============================================================================
-- CoDevProperty — Admin account-verification gate
-- Run in the Supabase SQL editor / Management API as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Apply this BEFORE (or together with) the
-- app.js / admin.html deploy so new sign-ups land as 'pending'.
-- ============================================================================

-- 1) New sign-ups start as 'pending'; grandfather EXISTING accounts as 'approved'
--    so nobody currently active is locked out.
alter table public.profiles alter column status set default 'pending';

update public.profiles
   set status = 'approved'
 where status is null or lower(status) = 'active';

-- keep admins usable regardless
update public.profiles
   set status = 'approved'
 where role = 'admin' and (status is null or lower(status) <> 'suspended');

-- 2) Ensure the sign-up trigger creates profiles as 'pending'.
--    Adjust to your real handle_new_user() — the key is to set status = 'pending'
--    (or simply omit status from the INSERT so the column DEFAULT from step 1 applies).
--    Typical pattern:
--
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer as $$
-- begin
--   insert into public.profiles (id, name, email, role, status)
--   values (new.id,
--           coalesce(new.raw_user_meta_data->>'name',''),
--           new.email,
--           coalesce(new.raw_user_meta_data->>'role','visitor'),
--           'pending');
--   return new;
-- end; $$;

-- 3) RLS — only an APPROVED account may LIST a development (server-side; a tampered
--    client cannot bypass this).
alter table public.properties enable row level security;

drop policy if exists properties_insert_approved on public.properties;
create policy properties_insert_approved on public.properties
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and lower(p.status) = 'approved'
    )
  );

-- 4) A user must NOT be able to approve themselves. Restrict who can change status.
--    If you have an owner self-update policy on profiles, make sure it CANNOT change
--    status (only name, etc.). Example owner policy that freezes status/role:
--
-- drop policy if exists profiles_self_update on public.profiles;
-- create policy profiles_self_update on public.profiles
--   for update to authenticated
--   using (id = auth.uid())
--   with check (
--     id = auth.uid()
--     and status = (select status from public.profiles where id = auth.uid())
--     and role   = (select role   from public.profiles where id = auth.uid())
--   );
--
--   Admin status changes are made via the admin console using the service role /
--   an admin-only policy — never by the account holder.

-- 5) (Optional) index for the queue lookups the admin console runs.
create index if not exists profiles_status_idx on public.profiles (status);
