-- ============================================================================
-- CoDevProperty — Per-deal payment calls + unit/asset reference on transactions.
-- Moves payment calls & payment status OFF the listing and INTO the deal:
-- each transaction already links a BUYER + a PROPERTY; this adds the specific
-- UNIT/ASSET and the deal's PAYMENT CALLS (tracked by CoDev/developer).
--
-- Run ONCE in the Supabase SQL editor as the project owner. Idempotent.
-- Depends on TRANSACTIONS.sql (the transactions table + its RLS already exist).
-- ============================================================================

alter table public.transactions
  add column if not exists unit_ref  text,                                   -- e.g. CDV-XXXXXX-U005 (the specific unit this deal is for)
  add column if not exists payments  jsonb not null default '[]'::jsonb;     -- [{label, amount, dueDate, status}]  status: due | paid | overdue | waived

comment on column public.transactions.unit_ref is 'Implicit unit tag for the specific asset in this deal (CDV-XXXXXX-U###).';
comment on column public.transactions.payments is 'Payment calls / schedule for THIS deal — label, amount, due date, status. Tracked per buyer + unit, never on the public listing.';

-- The existing transactions RLS already covers these columns at row level:
--   tx_legal_all   : CoDev admin/legal manage transactions (incl. payments/unit_ref)
--   tx_owner_read  : the developer who owns the listing can READ its deals
--   tx_buyer_read/update : the buyer reads (and may attach to) their own deal
-- No new policy is required for admin-managed payment calls.

notify pgrst, 'reload schema';
-- ============================================================================
