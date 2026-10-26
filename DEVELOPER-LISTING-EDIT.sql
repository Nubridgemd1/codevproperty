-- DEVELOPER-LISTING-EDIT.sql
-- Lets a DEVELOPER fully edit THEIR OWN listing (title, location, address, properties/units,
-- prices, units count, delivery date, summary, photos, construction stage, and the construction
-- milestone schedule) in one place — mirroring the existing dev_update_listing_pricing pattern.
--
-- Safe by design (SECURITY DEFINER + ownership gate):
--   * only the owner (properties.submitted_by = auth.uid()) can edit.
--   * developers CANNOT set status, legal_status, assigned_*, submitted_by, sold, ref, verified_at.
--   * milestones are accepted for the SCHEDULE only (name, pct, targetDate); their certification
--     status is forced to 'pending' and releasedDate cleared, so a developer cannot self-certify
--     or inflate funding. Certification stays with CoDev (admin). Milestones are only touched when
--     p_milestones is provided (NULL = leave existing milestones/certifications untouched).
--
-- Run this once in the Supabase SQL editor, then deploy the frontend.

create or replace function public.dev_update_listing_details(
  p_id            uuid,
  p_title         text    default null,
  p_location      text    default null,
  p_address       text    default null,
  p_summary       text    default null,
  p_units         integer default null,
  p_delivery_date text    default null,
  p_stage         text    default null,
  p_price_from    numeric default null,
  p_items         jsonb   default null,
  p_images        jsonb   default null,
  p_milestones    jsonb   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ms jsonb;
begin
  if not exists (
    select 1 from public.properties
    where id = p_id and submitted_by = auth.uid()
  ) then
    raise exception 'Not authorized to edit this listing';
  end if;

  update public.properties set
    title          = coalesce(p_title,         title),
    location       = coalesce(p_location,      location),
    address        = coalesce(p_address,       address),
    summary        = coalesce(p_summary,       summary),
    units          = coalesce(p_units,         units),
    delivery_date  = coalesce(p_delivery_date, delivery_date),
    stage          = coalesce(p_stage,         stage),
    price_from     = coalesce(p_price_from,    price_from),
    property_items = coalesce(p_items,         property_items),
    images         = coalesce(p_images,        images)
  where id = p_id and submitted_by = auth.uid();

  -- Milestones: schedule only; strip certification so a developer can't self-certify.
  if p_milestones is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name',        coalesce(e->>'name', ''),
             'pct',         coalesce((e->>'pct')::numeric, 0),
             'targetDate',  coalesce(e->>'targetDate', ''),
             'status',      'pending',
             'releasedDate', null
           )), '[]'::jsonb)
      into v_ms
      from jsonb_array_elements(p_milestones) e;

    update public.properties set milestones = v_ms
    where id = p_id and submitted_by = auth.uid();
  end if;
end;
$$;

grant execute on function public.dev_update_listing_details(
  uuid, text, text, text, text, integer, text, text, numeric, jsonb, jsonb, jsonb
) to authenticated;
