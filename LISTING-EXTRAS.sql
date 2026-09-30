-- CoDevProperty — bedrooms + property price on listings
-- Adds the Bedrooms selection (residential only) and the property Price.
-- Safe to run more than once. Run in the Supabase SQL editor.

alter table public.properties
  add column if not exists bedrooms        text,                        -- legacy single-type fields (kept for back-compat)
  add column if not exists price           numeric,
  add column if not exists property_items  jsonb not null default '[]'::jsonb;  -- [{type,bedrooms,landSqm,landSqft,price}]

comment on column public.properties.bedrooms       is 'Legacy single bedroom value; superseded by property_items[].bedrooms';
comment on column public.properties.price          is 'Legacy single price; superseded by property_items[].price';
comment on column public.properties.property_items is 'Array of properties/units in the development: {type, bedrooms (residential), landSqm/landSqft (land), price}';

notify pgrst, 'reload schema';
