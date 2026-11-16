-- LISTING-VIDEO.sql
-- Adds an optional VIDEO walkthrough to a listing. A lister can either paste a
-- video link (YouTube / Vimeo / any direct URL) or upload a short clip (stored
-- inline as a data URL, like photos). Stored in one text column: properties.video.
--
-- The developer self-service editor (dev_update_listing_details) is extended with
-- p_video so a developer can set/replace/clear the video on their OWN listing only.
-- Admin create/edit paths write properties.video directly via PostgREST.
--
-- Run this once in the Supabase SQL editor, then deploy the frontend.

-- 1) Column (safe to re-run)
alter table public.properties add column if not exists video text;

-- 2) Replace the owner-gated self-edit function, adding p_video.
--    Drop the old 12-arg signature first so there is a single canonical function.
drop function if exists public.dev_update_listing_details(
  uuid, text, text, text, text, integer, text, text, numeric, jsonb, jsonb, jsonb);

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
  p_milestones    jsonb   default null,
  p_video         text    default null
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
    images         = coalesce(p_images,        images),
    -- empty string clears the video; null leaves it unchanged
    video          = case when p_video is null then video
                          when p_video = ''   then null
                          else p_video end
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
  uuid, text, text, text, text, integer, text, text, numeric, jsonb, jsonb, jsonb, text
) to authenticated;
