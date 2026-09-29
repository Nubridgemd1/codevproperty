-- ============================================================================
-- CoDev — Platform settings (super-admin editable) + FX rates
-- Stores currency conversion rates used to display investor amount bands.
-- Public read (the qualification form converts bands); write is restricted to a
-- SUPER ADMIN (the primary admin, or an admin with the manage_admins right).
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table public.platform_settings enable row level security;

-- Anyone may read settings (the public form needs the FX rates).
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings
  for select using (true);

-- Only a super admin may create/update/delete settings.
drop policy if exists platform_settings_write on public.platform_settings;
create policy platform_settings_write on public.platform_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin'
                   and (lower(coalesce(p.email,'')) = 'admin@codevproperty.com'
                        or p.permissions::text like '%manage_admins%')))
  with check (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin'
                   and (lower(coalesce(p.email,'')) = 'admin@codevproperty.com'
                        or p.permissions::text like '%manage_admins%')));

-- Seed the default FX rates (1 USD -> currency). Super admin can edit in the console.
insert into public.platform_settings(key, value)
values ('fx', '{"USD":1,"NGN":1600,"GBP":0.79}'::jsonb)
on conflict (key) do nothing;
-- ============================================================================
