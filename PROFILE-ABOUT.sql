-- ============================================================================
-- CoDev — "About developer" profile section
-- Adds optional credential/document fields to the developer profile:
--   registration (CAC/RC) number, year established, head-office address,
--   company-profile document, CAC/incorporation documents, references, and a
--   flexible list of extra "additional information" items (label + note + file).
--
-- All fields are OPTIONAL. No RLS change is needed — the existing
-- profiles_update_own policy + guard_profile_self_update trigger (PROFILE-FIELDS.sql)
-- already let a signed-in member edit their OWN non-privileged columns while
-- blocking changes to role/status/permissions.
--
-- Run ONCE in the Supabase SQL editor as the PROJECT-OWNING account
-- (project ref zfjwbdfaxgvdwepmkwce). Safe to re-run (idempotent).
-- The app degrades gracefully until this runs: the profile still saves its
-- long-standing fields (name/about/website/phone/brochure); the new fields
-- simply aren't stored yet. No disruption either way.
-- ============================================================================

alter table public.profiles add column if not exists reg_number          text;        -- CAC / RC number
alter table public.profiles add column if not exists year_established     text;
alter table public.profiles add column if not exists hq_address           text;
alter table public.profiles add column if not exists company_profile_doc  text;        -- data URL (PDF/image, <=5MB)
alter table public.profiles add column if not exists cac_doc              text;        -- data URL (PDF/image, <=5MB)
alter table public.profiles add column if not exists references_doc       text;        -- data URL (PDF/image, <=5MB)
alter table public.profiles add column if not exists dev_extras           jsonb not null default '[]'::jsonb;  -- [{label,note,file}]

-- Done. Developers can now complete the "About developer" section from the
-- Developer portal; role/status/permissions remain admin-only (unchanged).
-- ============================================================================
