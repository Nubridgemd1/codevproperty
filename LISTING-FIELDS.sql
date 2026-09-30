-- CoDevProperty — add per-listing entry fields
-- Adds: full address, property type, number of units, proposed delivery date.
-- (Project name = existing `title`; construction stage = existing `stage`.)
-- Safe to run more than once. Run in the Supabase SQL editor.

alter table public.properties
  add column if not exists address        text,
  add column if not exists property_type  text,
  add column if not exists units          integer,
  add column if not exists delivery_date  text,   -- ISO date string (yyyy-mm-dd); text keeps it flexible
  add column if not exists ref            text;   -- unique listing reference (e.g. CDV-XXXXXX), assigned once at submission

comment on column public.properties.address       is 'Full project address (street, area, city, state)';
comment on column public.properties.property_type is 'Property type, e.g. Residential — apartments, Mixed-use, Commercial';
comment on column public.properties.units         is 'Number of units in the development';
comment on column public.properties.delivery_date is 'Proposed delivery date (yyyy-mm-dd)';
comment on column public.properties.ref           is 'Unique listing reference (CDV-XXXXXX); generated once when the listing is submitted. Each unit is tagged REF-U001, REF-U002, …';

-- Enforce uniqueness of the listing reference (allows multiple NULLs for unpublished listings).
create unique index if not exists properties_ref_key on public.properties (ref);

-- Ask PostgREST to reload its schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';
