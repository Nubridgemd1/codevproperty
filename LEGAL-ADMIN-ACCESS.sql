-- CoDevProperty — give super admins explicit legal-review access
-- Admins (role='admin') already pass can_legal_review() and can review documents / set statuses.
-- This backfills the 'legal_review' permission into every admin's permission set so it also shows
-- on their rights chips and satisfies any permission-based check. Idempotent.
-- Run in the Supabase SQL editor.

update public.profiles
   set permissions = coalesce(permissions, '[]'::jsonb) || '["legal_review"]'::jsonb
 where role = 'admin'
   and not (coalesce(permissions, '[]'::jsonb) ? 'legal_review');

-- Re-affirm the helper so admins AND legal partners can read & change document review status.
-- (SECURITY DEFINER avoids RLS recursion; matches DOCUMENTS.sql.)
create or replace function public.can_legal_review()
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and ( p.role in ('admin','legal')
             or coalesce(p.permissions, '[]'::jsonb) ? 'legal_review' )
  );
$$;

notify pgrst, 'reload schema';
