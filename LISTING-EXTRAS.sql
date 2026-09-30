-- CoDevProperty — bedrooms + property price on listings
-- Adds the Bedrooms selection (residential only) and the property Price.
-- Safe to run more than once. Run in the Supabase SQL editor.

alter table public.properties
  add column if not exists bedrooms text,      -- e.g. 'Studio', '3 Bedrooms' (residential types only)
  add column if not exists price    numeric;   -- property price (distinct from price_from = participation-from)

comment on column public.properties.bedrooms is 'Bedroom count for residential dwellings (Studio / 1..6+ Bedrooms); null for land/commercial';
comment on column public.properties.price    is 'Property price. Separate from price_from (minimum participation amount).';

notify pgrst, 'reload schema';
