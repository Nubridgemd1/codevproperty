-- ============================================================================
-- CoDev — Development legal-review status (assurance gateway)
-- Adds the legal-review status used by the admin editor and the public
-- "CoDev Legal Verified" badge. Run ONCE in the Supabase SQL editor as the
-- PROJECT-OWNING account (project ref zfjwbdfaxgvdwepmkwce). Idempotent.
--
-- Values: not_submitted | under_review | information_required |
--         conditionally_cleared | cleared | material_issue | rejected
-- The public badge shows ONLY for 'cleared' or 'conditionally_cleared'.
-- Admins set this via the existing property editor (properties UPDATE policy
-- already covers these columns — no extra policy needed).
-- ============================================================================

alter table public.properties add column if not exists legal_status      text default 'not_submitted';
alter table public.properties add column if not exists legal_reviewed_at  timestamptz;

-- Backfill any existing rows that predate the column.
update public.properties set legal_status = 'not_submitted' where legal_status is null;
-- ============================================================================
