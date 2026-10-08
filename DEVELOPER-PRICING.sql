-- DEVELOPER-PRICING.sql
-- Let a developer update ONLY the pricing of their OWN listings from their portal,
-- without granting a broad properties UPDATE policy (which could let them change
-- status / self-verify). A SECURITY DEFINER function touches only the price fields
-- (property_items + price_from) and is gated on ownership (submitted_by = auth.uid()).
--
-- Run this once in the Supabase SQL editor, then merge the frontend.

create or replace function public.dev_update_listing_pricing(
  p_id uuid,
  p_items jsonb,
  p_price_from numeric
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare r public.properties;
begin
  update public.properties
     set property_items = coalesce(p_items, property_items),
         price_from     = p_price_from
   where id = p_id
     and submitted_by = auth.uid()   -- caller must own the listing
  returning * into r;

  if r.id is null then
    raise exception 'Not allowed: you can only update pricing on your own listing.';
  end if;
  return r;
end;
$$;

revoke all on function public.dev_update_listing_pricing(uuid, jsonb, numeric) from public;
grant execute on function public.dev_update_listing_pricing(uuid, jsonb, numeric) to authenticated;
