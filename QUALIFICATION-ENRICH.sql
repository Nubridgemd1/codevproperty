-- ============================================================================
-- CoDev — Enrich the per-listing qualification with the fuller buyer data set.
-- Adds the richer fields so the "Start qualification" form (on a listing) and
-- the public buyer EOI capture consistent information.
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- Until this runs, the qualification still saves — the app simply omits these
-- new fields (graceful, zero disruption).
-- ============================================================================

alter table public.qualifications add column if not exists phone              text;
alter table public.qualifications add column if not exists country            text;
alter table public.qualifications add column if not exists interest           text;
alter table public.qualifications add column if not exists preferred_location text;
alter table public.qualifications add column if not exists comments           text;

-- Done. New qualifications now store phone, country, interest, preferred
-- location and comments; they show in the admin "Review qualification" sheet.
-- ============================================================================
