-- CoDevProperty — Legal queries, versioned counsel report, and transactions/completion
-- Completes the legal-framework journey (§2.2 review queries, §2.5 transaction, §2.6 completion, §3 report).
-- Depends on DOCUMENTS.sql + DEALROOM.sql (helpers owns_property, can_legal_review, is_verified_buyer).
-- Safe to run more than once. Run in the Supabase SQL editor.

-- 1) Legal queries thread (counsel <-> developer during review) -------------------
create table if not exists public.legal_queries (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  author_id    uuid,
  author_email text,
  author_kind  text not null check (author_kind in ('counsel','developer')),
  body         text not null,
  status       text not null default 'open' check (status in ('open','resolved')),
  created_at   timestamptz not null default now()
);
create index if not exists legal_queries_property_idx on public.legal_queries(property_id);

alter table public.legal_queries enable row level security;
-- Developer (owner) reads their listing's thread and posts developer replies.
drop policy if exists lq_owner_read on public.legal_queries;
create policy lq_owner_read on public.legal_queries for select to authenticated using ( public.owns_property(property_id) );
drop policy if exists lq_owner_insert on public.legal_queries;
create policy lq_owner_insert on public.legal_queries for insert to authenticated
  with check ( public.owns_property(property_id) and author_kind = 'developer' and author_id = auth.uid() );
-- Legal / admin read, post (as counsel) and resolve.
drop policy if exists lq_legal_read on public.legal_queries;
create policy lq_legal_read on public.legal_queries for select to authenticated using ( public.can_legal_review() );
drop policy if exists lq_legal_insert on public.legal_queries;
create policy lq_legal_insert on public.legal_queries for insert to authenticated with check ( public.can_legal_review() );
drop policy if exists lq_legal_update on public.legal_queries;
create policy lq_legal_update on public.legal_queries for update to authenticated using ( public.can_legal_review() ) with check ( public.can_legal_review() );

-- 2) Versioned counsel report (scoped legal decision) ----------------------------
create table if not exists public.legal_reports (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  version     integer not null default 1,
  scope       text,
  disposition text not null check (disposition in ('cleared','conditional','material_issue','rejected')),
  summary     text,
  conditions  text,
  issued_by   uuid,
  issued_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists legal_reports_property_idx on public.legal_reports(property_id);

alter table public.legal_reports enable row level security;
-- Readable by the owner, legal/admin, and a buyer verified for the listing (assurance transparency).
drop policy if exists lr_read on public.legal_reports;
create policy lr_read on public.legal_reports for select to authenticated
  using ( public.owns_property(property_id) or public.can_legal_review() or public.is_verified_buyer(property_id) );
-- Only legal/admin issue reports (append-only versions).
drop policy if exists lr_write on public.legal_reports;
create policy lr_write on public.legal_reports for insert to authenticated with check ( public.can_legal_review() );

-- 3) Transactions & completion (reservation / sale / subscription / JV) -----------
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties(id) on delete cascade,
  user_id          uuid not null,           -- the buyer
  user_email       text,
  user_name        text,
  tx_type          text not null check (tx_type in ('reservation','sale','subscription','jv')),
  status           text not null default 'initiated'
                   check (status in ('initiated','documents_issued','buyer_signed','countersigned','funded','completed','cancelled')),
  amount           numeric,
  currency         text default 'NGN',
  documents        jsonb not null default '[]'::jsonb,   -- [{docType,title,fileData,fileName,status,issuedAt}]
  funding_evidence text,                    -- base64 data URL of proof of funds/payment
  funding_note     text,
  completion_ref   text,
  completion_note  text,
  completed_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists transactions_property_idx on public.transactions(property_id);
create index if not exists transactions_user_idx on public.transactions(user_id);

alter table public.transactions enable row level security;
-- Legal / admin (CoDev) manage transactions end to end.
drop policy if exists tx_legal_all on public.transactions;
create policy tx_legal_all on public.transactions for all to authenticated
  using ( public.can_legal_review() ) with check ( public.can_legal_review() );
-- Buyer reads their own transactions and may attach signed docs / funding evidence.
drop policy if exists tx_buyer_read on public.transactions;
create policy tx_buyer_read on public.transactions for select to authenticated using ( user_id = auth.uid() );
drop policy if exists tx_buyer_update on public.transactions;
create policy tx_buyer_update on public.transactions for update to authenticated
  using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
-- Developer (owner) sees transactions on their own listings.
drop policy if exists tx_owner_read on public.transactions;
create policy tx_owner_read on public.transactions for select to authenticated using ( public.owns_property(property_id) );
-- (No anon policy → transactions are never exposed publicly.)

-- 4) Reload PostgREST schema cache ----------------------------------------------
notify pgrst, 'reload schema';
