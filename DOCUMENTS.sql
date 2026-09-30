-- CoDevProperty — Assurance & Verification documents
-- Per-listing key documents submitted by the developer, reviewed by the legal partner.
-- Files (file_data) are confidential: only the owning developer + legal/admin can read them
-- (RLS). Buyers see only the file-free verification status via a security-definer view.
-- Safe to run more than once. Run in the Supabase SQL editor.

-- 1) Documents table -------------------------------------------------------------
create table if not exists public.listing_documents (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  doc_key      text not null,
  doc_label    text not null,
  file_data    text,            -- base64 data URL (MVP). Swap for Supabase Storage for large files.
  file_name    text,
  file_type    text,
  status       text not null default 'awaiting'
               check (status in ('awaiting','under_review','cleared','rejected')),
  note         text,            -- legal partner's review note / reason
  submitted_by uuid,
  submitted_at timestamptz,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (property_id, doc_key)
);
create index if not exists listing_documents_property_idx on public.listing_documents(property_id);

-- 2) Helper functions (SECURITY DEFINER → read profiles/properties without RLS recursion) ----
create or replace function public.owns_property(pid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.properties pr where pr.id = pid and pr.submitted_by = auth.uid());
$$;

create or replace function public.can_legal_review()
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and ( p.role in ('admin','legal')
             or coalesce(p.permissions, '[]'::jsonb) ? 'legal_review' )
  );
$$;

-- 3) Row-level security ----------------------------------------------------------
alter table public.listing_documents enable row level security;

-- Owner (developer) manages their own listing's documents, but may NOT self-verify:
-- their writes are limited to 'awaiting' / 'under_review'.
drop policy if exists ld_owner_all on public.listing_documents;
create policy ld_owner_all on public.listing_documents for all to authenticated
  using ( public.owns_property(property_id) )
  with check ( public.owns_property(property_id) and status in ('awaiting','under_review') );

-- Legal partner / admin: read every document and set the review decision.
drop policy if exists ld_legal_read on public.listing_documents;
create policy ld_legal_read on public.listing_documents for select to authenticated
  using ( public.can_legal_review() );

drop policy if exists ld_legal_write on public.listing_documents;
create policy ld_legal_write on public.listing_documents for update to authenticated
  using ( public.can_legal_review() )
  with check ( public.can_legal_review() );

-- No anon policy is defined → the anon API can never read listing_documents (file bytes stay private).

-- 4) Public, file-free status checklist -----------------------------------------
-- security_invoker = false → runs as the (postgres) view owner and bypasses the table's RLS,
-- exposing ONLY these non-sensitive columns. file_data is deliberately excluded.
drop view if exists public.listing_document_status;
create view public.listing_document_status with (security_invoker = false) as
  select property_id, doc_key, doc_label, status, reviewed_at
    from public.listing_documents;
grant select on public.listing_document_status to anon, authenticated;

-- 5) Reload PostgREST schema cache ----------------------------------------------
notify pgrst, 'reload schema';
