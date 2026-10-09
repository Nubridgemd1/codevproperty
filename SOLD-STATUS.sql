-- SOLD-STATUS.sql
-- Adds a "sold" flag to listings so an admin can mark a development as sold and a
-- SOLD badge shows everywhere it appears. Sold listings stay visible (status is
-- unchanged) — the badge just marks them sold. Run once in the Supabase SQL editor,
-- then merge the frontend.

alter table public.properties add column if not exists sold boolean not null default false;
alter table public.properties add column if not exists sold_at timestamptz;

comment on column public.properties.sold    is 'Admin-set: the development has been sold; shows a SOLD badge. Listing stays visible.';
comment on column public.properties.sold_at is 'When the listing was marked sold.';
