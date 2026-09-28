-- ============================================================================
-- CoDev — Developer profile & brochure
-- Adds profile fields and lets a signed-in member edit their OWN profile
-- (about / website / phone / brochure / name) — while a guard trigger blocks
-- non-admins from changing role, status or permissions (anti-privilege-escalation).
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Safe to re-run (idempotent).
-- ============================================================================

-- 1) Columns -----------------------------------------------------------------
alter table public.profiles add column if not exists about    text;
alter table public.profiles add column if not exists website  text;
alter table public.profiles add column if not exists phone    text;
alter table public.profiles add column if not exists brochure text;   -- data URL (PDF/image, <=5MB)

-- 2) Let a user update their OWN profile row ---------------------------------
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3) Guard: non-admins cannot change role / status / permissions / email / id
--    (they may only edit name / about / website / phone / brochure).
create or replace function public.guard_profile_self_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare is_admin boolean;
begin
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') into is_admin;
  if not coalesce(is_admin, false) then
    NEW.id          := OLD.id;
    NEW.email       := OLD.email;
    NEW.role        := OLD.role;
    NEW.status      := OLD.status;
    NEW.permissions := OLD.permissions;
    NEW.created_at  := OLD.created_at;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_guard_profile_self_update on public.profiles;
create trigger trg_guard_profile_self_update
  before update on public.profiles for each row
  execute function public.guard_profile_self_update();

-- Done. Developers can now save their profile & brochure from the Developer
-- portal; role/status/permissions remain admin-only and cannot be self-edited.
-- ============================================================================
