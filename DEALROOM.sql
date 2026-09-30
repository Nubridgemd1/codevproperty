-- CoDevProperty — Deal Room (verified-buyer document access)
-- A CoDev-verified buyer, after acknowledging the confidentiality/NDA terms, may view the
-- CLEARED documents for that listing. Access is logged and can be revoked or expired by
-- legal/admin. Depends on DOCUMENTS.sql (listing_documents, can_legal_review()).
-- Safe to run more than once. Run in the Supabase SQL editor.

-- 1) Access grants (one row per verified buyer per listing) -----------------------
create table if not exists public.deal_room_access (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  user_id         uuid not null,
  user_email      text,
  user_name       text,
  status          text not null default 'active' check (status in ('active','revoked','expired')),
  nda_version     text,
  acknowledged_at timestamptz,
  granted_at      timestamptz default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  created_at      timestamptz not null default now(),
  unique (property_id, user_id)
);
create index if not exists deal_room_access_property_idx on public.deal_room_access(property_id);

-- 2) Access log ------------------------------------------------------------------
create table if not exists public.deal_room_events (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id     uuid,
  user_email  text,
  event       text not null,   -- acknowledged | opened | viewed | downloaded | revoked | granted
  doc_key     text,
  created_at  timestamptz not null default now()
);
create index if not exists deal_room_events_property_idx on public.deal_room_events(property_id);

-- 3) Helper functions (SECURITY DEFINER → avoid RLS recursion) --------------------
create or replace function public.is_verified_buyer(pid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.qualifications q
                  where q.property_id = pid and q.user_id = auth.uid() and q.status = 'codev_verified');
$$;

create or replace function public.has_dealroom_access(pid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_verified_buyer(pid)
     and exists (select 1 from public.deal_room_access a
                  where a.property_id = pid and a.user_id = auth.uid()
                    and a.status = 'active' and a.acknowledged_at is not null
                    and (a.expires_at is null or a.expires_at > now()));
$$;

-- 4) RLS: deal_room_access -------------------------------------------------------
alter table public.deal_room_access enable row level security;

-- Buyer reads their own grant.
drop policy if exists dra_self_read on public.deal_room_access;
create policy dra_self_read on public.deal_room_access for select to authenticated
  using ( user_id = auth.uid() );

-- Buyer creates their own grant only when CoDev-verified for the listing (status starts 'active').
drop policy if exists dra_self_insert on public.deal_room_access;
create policy dra_self_insert on public.deal_room_access for insert to authenticated
  with check ( user_id = auth.uid() and public.is_verified_buyer(property_id) and status = 'active' );

-- Buyer may (re)acknowledge only a row that is currently active — cannot revive a revoked/expired grant.
drop policy if exists dra_self_update on public.deal_room_access;
create policy dra_self_update on public.deal_room_access for update to authenticated
  using ( user_id = auth.uid() and status = 'active' )
  with check ( user_id = auth.uid() and status = 'active' );

-- Legal / admin: see every grant and revoke / expire it.
drop policy if exists dra_legal_read on public.deal_room_access;
create policy dra_legal_read on public.deal_room_access for select to authenticated
  using ( public.can_legal_review() );
drop policy if exists dra_legal_write on public.deal_room_access;
create policy dra_legal_write on public.deal_room_access for update to authenticated
  using ( public.can_legal_review() ) with check ( public.can_legal_review() );

-- (No anon policy → grants are never exposed publicly. No buyer DELETE → revocation sticks.)

-- 5) RLS: deal_room_events -------------------------------------------------------
alter table public.deal_room_events enable row level security;
drop policy if exists dre_self_insert on public.deal_room_events;
create policy dre_self_insert on public.deal_room_events for insert to authenticated
  with check ( user_id = auth.uid() );
drop policy if exists dre_self_read on public.deal_room_events;
create policy dre_self_read on public.deal_room_events for select to authenticated
  using ( user_id = auth.uid() );
drop policy if exists dre_legal_read on public.deal_room_events;
create policy dre_legal_read on public.deal_room_events for select to authenticated
  using ( public.can_legal_review() );

-- 6) Buyers may read CLEARED documents once they hold Deal Room access -----------
drop policy if exists ld_buyer_read on public.listing_documents;
create policy ld_buyer_read on public.listing_documents for select to authenticated
  using ( status = 'cleared' and public.has_dealroom_access(property_id) );

-- 7) Reload PostgREST schema cache ----------------------------------------------
notify pgrst, 'reload schema';
