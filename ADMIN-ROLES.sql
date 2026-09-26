-- ============================================================================
-- CoDevProperty — Admin Role-Based Access Control (RBAC)
-- Run in the Supabase SQL editor / Management API as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Run this BEFORE merging the RBAC front-end,
-- so creating/editing admins persists and privilege-escalation is blocked server-side.
-- Builds on the verification-gate policies (VERIFICATION-GATE.sql).
-- ============================================================================

-- 1) Permission set per admin — a jsonb array of permission keys.
--    Keys used by the console: manage_admins, verify_accounts, manage_listings, manage_accounts.
alter table public.profiles add column if not exists permissions jsonb not null default '[]'::jsonb;

-- 2) Grandfather existing admins to FULL rights so no current admin loses access.
update public.profiles
   set permissions = '["manage_admins","verify_accounts","manage_listings","manage_accounts"]'::jsonb
 where role = 'admin' and (permissions is null or permissions = '[]'::jsonb);

-- 3) Super-admin helper: an admin whose permissions include "manage_admins".
--    SECURITY DEFINER so it can read profiles without tripping RLS recursion.
create or replace function public.is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and coalesce(p.permissions, '[]'::jsonb) ? 'manage_admins'
  );
$$;

-- 4) Only a SUPER-admin may change a profile's role or permissions.
--    Regular admins keep their operational rights (e.g. verify_accounts sets status)
--    but cannot elevate role/permissions. Replaces the admin UPDATE policy.
drop policy if exists "prof update admin" on public.profiles;
create policy "prof update admin" on public.profiles for update to authenticated
  using ( is_admin() )
  with check (
    is_super_admin()
    OR (
      role = (select p.role from public.profiles p where p.id = profiles.id)
      and coalesce(permissions,'[]'::jsonb)
          = coalesce((select p.permissions from public.profiles p where p.id = profiles.id), '[]'::jsonb)
    )
  );

-- 5) A user must not grant themselves role/permissions (freezes role, status & permissions
--    on self-update; refreshes the self policy from the verification gate).
drop policy if exists "prof update self" on public.profiles;
create policy "prof update self" on public.profiles for update to authenticated
  using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role   = (select p.role   from public.profiles p where p.id = auth.uid())
    and status = (select p.status from public.profiles p where p.id = auth.uid())
    and coalesce(permissions,'[]'::jsonb)
        = coalesce((select p.permissions from public.profiles p where p.id = auth.uid()), '[]'::jsonb)
  );

-- Note: the verification gate's "prop insert" policy (only approved accounts may list),
-- "prof read", "prof insert", "prof update admin/self", plus is_admin() must already exist.
-- After running this, merge the RBAC front-end (app.js unchanged; admin.html + data.js).
