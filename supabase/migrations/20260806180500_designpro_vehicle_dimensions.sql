-- Standalone GENIE dimension grounding/cache used by panelizer-step-validate.
-- Duplicate grounded rows are intentionally permitted; the validator owns
-- deterministic selection and cache refresh behavior.

CREATE TABLE IF NOT EXISTS public.designpro_vehicle_dimensions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  make text NOT NULL CHECK (btrim(make)<>''),
  model text NOT NULL CHECK (btrim(model)<>''),
  year_range text,
  year_start integer,
  year_end integer,
  side_width numeric,
  side_height numeric,
  hood_width numeric,
  hood_length numeric,
  roof_width numeric,
  roof_length numeric,
  front_width numeric,
  front_height numeric,
  rear_width numeric,
  rear_height numeric,
  back_width numeric,
  back_height numeric,
  total_sqft numeric,
  overall_length numeric,
  recommended_size text,
  CONSTRAINT designpro_vehicle_year_order CHECK (
    year_start IS NULL OR year_end IS NULL OR year_start<=year_end
  ),
  CONSTRAINT designpro_vehicle_dimensions_positive CHECK (
    (side_width IS NULL OR side_width>0) AND (side_height IS NULL OR side_height>0)
    AND (hood_width IS NULL OR hood_width>0) AND (hood_length IS NULL OR hood_length>0)
    AND (roof_width IS NULL OR roof_width>0) AND (roof_length IS NULL OR roof_length>0)
    AND (front_width IS NULL OR front_width>0) AND (front_height IS NULL OR front_height>0)
    AND (rear_width IS NULL OR rear_width>0) AND (rear_height IS NULL OR rear_height>0)
    AND (back_width IS NULL OR back_width>0) AND (back_height IS NULL OR back_height>0)
    AND (total_sqft IS NULL OR total_sqft>0) AND (overall_length IS NULL OR overall_length>0)
  )
);

CREATE INDEX IF NOT EXISTS designpro_vehicle_dimensions_make_model_idx
  ON public.designpro_vehicle_dimensions (lower(btrim(make)),lower(btrim(model)));
CREATE INDEX IF NOT EXISTS designpro_vehicle_dimensions_lookup_idx
  ON public.designpro_vehicle_dimensions (lower(btrim(make)),lower(btrim(model)),year_start,year_end,id);

ALTER TABLE public.designpro_vehicle_dimensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_vehicle_dimensions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.designpro_vehicle_dimensions TO service_role;
