-- CoDevProperty — let admins / legal partners UPLOAD assurance documents
-- (e.g. from the admin "Edit · milestones" modal), not just review status.
-- Adds an INSERT policy so can_legal_review() users can create/upsert documents.
-- The existing developer (owner) insert and legal/admin update policies remain.
-- Depends on DOCUMENTS.sql. Idempotent. Run in the Supabase SQL editor.

drop policy if exists ld_legal_insert on public.listing_documents;
create policy ld_legal_insert on public.listing_documents for insert to authenticated
  with check ( public.can_legal_review() );

notify pgrst, 'reload schema';
