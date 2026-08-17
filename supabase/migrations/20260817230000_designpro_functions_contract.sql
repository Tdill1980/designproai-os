-- Minimum schema/data contract required by the 17 migrated DesignPro edge
-- functions and the ported worker. Every table and function body below is
-- extracted verbatim from the proven predecessor production database via
-- pg_catalog -- nothing is guessed. Scope is the exact .from()/.rpc()
-- surface of the migrated code plus the helpers those RPC bodies call
-- (sync_workflow_run_status, get_tier_limit) and the tables those helpers
-- touch (render_usage, token_transactions, workflow_resource_leases).
-- Unrelated predecessor product schema is NOT migrated. Non-unique indexes,
-- triggers, and RLS policies are deliberately deferred: the chain runs
-- service-role.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user','tester','designer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text,
  blocked_at timestamp with time zone DEFAULT now(),
  blocked_by text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.color_visualizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  customer_email text NOT NULL,
  organization_id uuid,
  subscription_tier text DEFAULT 'free'::text,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_year integer NOT NULL,
  vehicle_type text,
  color_hex text NOT NULL,
  color_name text NOT NULL,
  finish_type text NOT NULL,
  has_metallic_flakes boolean DEFAULT false,
  infusion_color_id text,
  custom_swatch_url text,
  uses_custom_design boolean DEFAULT false,
  custom_design_url text,
  design_file_name text,
  render_urls jsonb DEFAULT '{}'::jsonb,
  generation_status text DEFAULT 'processing'::text,
  is_saved boolean DEFAULT false,
  admin_notes text,
  emailed_at timestamp with time zone,
  mode_type text,
  has_360_spin boolean DEFAULT false,
  spin_view_count integer DEFAULT 0,
  is_featured_hero boolean DEFAULT false,
  custom_styling_prompt_key text,
  source_photo_url text,
  tool_source text,
  shop_id uuid,
  show_on_quote_pdf boolean NOT NULL DEFAULT false,
  lineage_root_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.design_generation_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL,
  iteration_index integer NOT NULL DEFAULT 0,
  parent_asset_id uuid,
  is_current boolean NOT NULL DEFAULT true,
  user_id uuid,
  shop_id uuid,
  organization_id uuid,
  source text NOT NULL DEFAULT 'designpro'::text,
  background_url text,
  overlay_pngs jsonb NOT NULL DEFAULT '[]'::jsonb,
  panel_zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  layer_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  proof_2d_url text,
  proof_3d_url text,
  view_urls jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  qc_status text NOT NULL DEFAULT 'pending'::text,
  qc_stamped_by text,
  qc_stamped_at timestamp with time zone,
  source_prompt text,
  layer_layout jsonb DEFAULT '[]'::jsonb,
  alternate_overlays jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_scrubbed boolean,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.design_version_commits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id text NOT NULL,
  version_number integer NOT NULL,
  user_id uuid,
  shop_id uuid,
  user_prompt text,
  system_prompt_snapshot text,
  master_artboard_url text,
  hero_render_url text,
  angle_renders_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_type text NOT NULL DEFAULT 'generate'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  designiq_generation_id uuid,
  source_visualization_id uuid,
  revision_snapshot jsonb,
  revision_snapshot_hash text,
  frozen_at timestamp with time zone,
  workflow_run_id uuid,
  entice_pack_id uuid,
  entice_status text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.designiq_generations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  mode text NOT NULL,
  raw_prompt text NOT NULL,
  enhanced_prompt text,
  style_preset text,
  company_name text,
  mascot text,
  industry_type text,
  brand_keywords text[],
  finish text DEFAULT 'Gloss'::text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  panel_url text,
  panel_id uuid,
  panel_mime_type text,
  hero_render_url text,
  render_urls jsonb DEFAULT '{}'::jsonb,
  spin_urls jsonb DEFAULT '[]'::jsonb,
  proof_pdf_url text,
  engine_version text DEFAULT '1.1'::text,
  truespec_metadata jsonb DEFAULT '{}'::jsonb,
  generation_status text DEFAULT 'started'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  panel_completed_at timestamp with time zone,
  render_completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  design_config jsonb,
  visionboard_image_refs text[],
  concept_fingerprint text,
  prompt_fingerprint text,
  design_equity_id text,
  prompt_hash text,
  shop_id uuid,
  quote_id uuid,
  flat_proof_url text,
  pt text,
  design_name text,
  master_artboard_url text,
  master_artboard_clean_url text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.designpro_entice_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  design_id text NOT NULL,
  designiq_generation_id uuid NOT NULL,
  source_visualization_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  dimension_manifest_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  tenant_key text NOT NULL,
  trigger_key text NOT NULL,
  definition_version text NOT NULL DEFAULT 'designpro.entice_pack.v2'::text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'building'::text,
  submission_hash text NOT NULL,
  canonical_input_hash text,
  dimension_basis_hash text,
  manifest_hash text,
  pack_identity_hash text,
  source_contract_hash text,
  surface_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  proof_artifact jsonb NOT NULL DEFAULT '{}'::jsonb,
  panel_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  logo_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  pack_version text,
  workflow_run_id uuid,
  failure jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamp with time zone,
  activated_at timestamp with time zone,
  superseded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.designpro_production_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  panelizer_job_id text NOT NULL,
  generation_id text NOT NULL,
  order_number text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued'::text,
  stage text NOT NULL DEFAULT 'created'::text,
  blocked jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  revision_id uuid,
  entice_pack_id uuid,
  dimension_manifest_id uuid,
  source_contract_hash text,
  order_request_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.manufacturer_colors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  series text,
  product_code text NOT NULL,
  official_name text NOT NULL,
  official_hex text,
  official_swatch_url text,
  lab_l numeric,
  lab_a numeric,
  lab_b numeric,
  finish text NOT NULL DEFAULT 'Gloss'::text,
  is_ppf boolean DEFAULT false,
  is_verified boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  hex_source text DEFAULT 'ai_guessed'::text,
  hex_confidence integer DEFAULT 0,
  registry_version text,
  source_file text,
  grounded_description text,
  grounded_base_color text,
  grounded_effect text,
  show_in_picker boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.moderation_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  blocked_term text NOT NULL,
  attempted_content text,
  ip_address text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.panel_artboard_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  kind text NOT NULL,
  label text,
  panel_label text,
  width_inches numeric,
  height_inches numeric,
  dpi integer,
  scale_pct numeric,
  box jsonb,
  storage_path text,
  url text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  qc jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.panel_artboard_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  status text NOT NULL DEFAULT 'running'::text,
  mode text,
  prompt text,
  reference_image_url text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  body_type text,
  finish text,
  bleed_inches numeric DEFAULT 2,
  dims_source text,
  panels jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  production_ctx jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.panelizer_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generation_id uuid,
  purchase_id uuid,
  order_number text,
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  approved_render_url text,
  all_view_urls jsonb DEFAULT '[]'::jsonb,
  concept_json jsonb,
  status text NOT NULL DEFAULT 'pending_payment'::text,
  current_stage integer DEFAULT 0,
  stage_progress jsonb DEFAULT '{}'::jsonb,
  panels jsonb DEFAULT '[]'::jsonb,
  qa_results jsonb DEFAULT '{}'::jsonb,
  qa_passed boolean,
  qa_issues_count integer DEFAULT 0,
  qa_requires_input boolean DEFAULT false,
  customer_inputs jsonb DEFAULT '[]'::jsonb,
  extracted_elements jsonb DEFAULT '[]'::jsonb,
  upsells_offered jsonb DEFAULT '[]'::jsonb,
  upsells_purchased jsonb DEFAULT '[]'::jsonb,
  upsell_revenue numeric(10,2) DEFAULT 0,
  zip_storage_path text,
  zip_signed_url text,
  zip_expires_at timestamp with time zone,
  delivered_at timestamp with time zone,
  delivery_email_sent boolean DEFAULT false,
  processing_time_ms integer,
  error_message text,
  error_stage text,
  retry_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  job_type text DEFAULT 'production_pack'::text,
  shop_id uuid,
  quote_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.production_flow_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  side character varying(50) NOT NULL,
  version text NOT NULL DEFAULT 'v1'::character varying,
  dimensions_inches jsonb NOT NULL,
  background_url text NOT NULL,
  branding_url text NOT NULL,
  depth_mask_url text NOT NULL,
  final_pack_url text NOT NULL,
  is_passenger_flipped boolean DEFAULT false,
  meta_metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  revision_id uuid,
  entice_pack_id uuid,
  designiq_generation_id uuid,
  dimension_manifest_id uuid,
  manifest_hash text,
  source_contract_hash text,
  artifact_hash text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.production_panel_dispatches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL,
  production_job_id uuid NOT NULL,
  panelizer_job_id uuid NOT NULL,
  source_hash text NOT NULL,
  pack_version text NOT NULL,
  run_key text NOT NULL,
  panel_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  request_id bigint,
  available_at timestamp with time zone NOT NULL DEFAULT now(),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_hash text,
  error text,
  dispatched_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.production_panels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  render_id uuid NOT NULL,
  panel_name text,
  dimensions_summary text NOT NULL,
  mapping_payload jsonb NOT NULL,
  storage_path text,
  preview_path text,
  status text NOT NULL DEFAULT 'queued'::text,
  user_id uuid DEFAULT auth.uid(),
  operator_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.proof_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  proof_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_role text,
  actor_user_id uuid,
  ip inet,
  user_agent text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.render_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  tool text NOT NULL,
  mode text,
  engine_version text,
  gemini_model text,
  gemini_finish_reason text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_canonical text,
  view_type text,
  finish text,
  raw_prompt text,
  enhanced_prompt_chars integer,
  enhanced_prompt_hash text,
  render_url text,
  thumbnail_url text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  latency_ms integer,
  source_table text,
  source_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.render_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prompt_signature text NOT NULL,
  vehicle_signature text NOT NULL,
  source_visualization_id uuid,
  render_urls jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_golden_template boolean DEFAULT true,
  rating integer DEFAULT 5,
  use_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.render_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  tier text NOT NULL,
  render_type text NOT NULL,
  billing_cycle_start timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.token_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  reason text,
  action_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  billing_cycle_start timestamp with time zone NOT NULL DEFAULT now(),
  billing_cycle_end timestamp with time zone NOT NULL DEFAULT (now() + '1 mon'::interval),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_item_extra text,
  stripe_price_id text,
  render_count integer DEFAULT 0,
  render_reset_date timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  woo_customer_id bigint,
  alacarte_renders_remaining integer NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_tokens (
  user_id uuid NOT NULL,
  balance integer NOT NULL DEFAULT 0,
  total_purchased integer NOT NULL DEFAULT 0,
  total_used integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  unlimited_revisions boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_dimensions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  year_range text,
  year_start integer,
  year_end integer,
  side_width numeric,
  side_height numeric,
  side_sqft numeric,
  back_width numeric,
  back_height numeric,
  back_sqft numeric,
  hood_width numeric,
  hood_length numeric,
  hood_sqft numeric,
  roof_width numeric,
  roof_length numeric,
  roof_sqft numeric,
  total_sqft numeric,
  corrected_sqft numeric,
  recommended_size text,
  created_at timestamp with time zone DEFAULT now(),
  overall_length numeric,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_renders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_year text NOT NULL,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  mode_type text NOT NULL,
  render_url text NOT NULL,
  color_data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  quality_verified boolean DEFAULT false,
  reference_count integer DEFAULT 0,
  is_canonical_demo boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_specs_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  year_range text NOT NULL,
  side_w numeric,
  side_h numeric,
  hood_w numeric,
  hood_l numeric,
  back_w numeric,
  back_h numeric,
  roof_w numeric,
  roof_l numeric,
  total_sqft numeric,
  wheelbase_inches numeric,
  source text DEFAULT 'google_grounding'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.vinyl_reference_images (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  swatch_id uuid,
  manufacturer text NOT NULL,
  color_name text NOT NULL,
  product_code text,
  image_url text NOT NULL,
  source_url text,
  image_type text DEFAULT 'vehicle_installation'::text,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  color_characteristics jsonb,
  search_query text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  score double precision,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.vinyl_swatches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  series text,
  name text NOT NULL,
  code text,
  finish text NOT NULL,
  material_type text,
  hex text NOT NULL,
  metallic boolean DEFAULT false,
  flake_level text,
  pearl boolean DEFAULT false,
  chrome boolean DEFAULT false,
  ppf boolean DEFAULT false,
  media_url text,
  media_type text,
  ai_confidence numeric,
  verified boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  color_type text,
  popularity_score integer DEFAULT 0,
  search_count integer DEFAULT 0,
  last_verified_at timestamp with time zone DEFAULT now(),
  source text DEFAULT 'seeded'::text,
  has_reference_bundle boolean DEFAULT false,
  is_flip_film boolean DEFAULT false,
  needs_reference_review boolean DEFAULT false,
  reference_image_count integer DEFAULT 0,
  lab jsonb,
  reflectivity double precision,
  metallic_flake double precision,
  finish_profile jsonb,
  material_validated boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.workflow_resource_leases (
  resource_key text NOT NULL,
  lease_owner text NOT NULL,
  lease_token uuid NOT NULL,
  lease_expires_at timestamp with time zone NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acquired_at timestamp with time zone NOT NULL DEFAULT now(),
  heartbeat_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_key)
);

CREATE TABLE IF NOT EXISTS public.workflow_stage_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_key text NOT NULL,
  scope_key text NOT NULL DEFAULT ''::text,
  sequence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  idempotency_key text NOT NULL,
  input_hash text,
  output_hash text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  error_code text,
  error_message text,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  wait_reason text,
  wait_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  deferred_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.workforce_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'sweep'::text,
  dry_run boolean NOT NULL DEFAULT false,
  sends_enabled boolean NOT NULL DEFAULT false,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workflow_type text,
  tenant_key text,
  domain_job_type text,
  domain_job_id uuid,
  workflow_status text,
  idempotency_key text,
  requested_by uuid,
  input_hash text,
  cancel_requested_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

DO $ADDC$ BEGIN
  ALTER TABLE public.blocked_users ADD CONSTRAINT blocked_users_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.design_generation_assets ADD CONSTRAINT design_generation_assets_gen_iter_uniq UNIQUE (generation_id, iteration_index);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.design_version_commits ADD CONSTRAINT design_version_commits_job_version_unique UNIQUE (job_id, version_number);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.designpro_entice_packs ADD CONSTRAINT designpro_entice_packs_idempotency_unique UNIQUE (tenant_key, idempotency_key);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.designpro_entice_packs ADD CONSTRAINT designpro_entice_packs_revision_definition_unique UNIQUE (revision_id, definition_version);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.designpro_entice_packs ADD CONSTRAINT designpro_entice_packs_workflow_run_id_key UNIQUE (workflow_run_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.designpro_production_jobs ADD CONSTRAINT designpro_production_jobs_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.manufacturer_colors ADD CONSTRAINT manufacturer_colors_manufacturer_product_code_key UNIQUE (manufacturer, product_code);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.manufacturer_colors ADD CONSTRAINT manufacturer_colors_product_code_unique UNIQUE (product_code);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.production_panel_dispatches ADD CONSTRAINT production_panel_dispatches_production_job_id_source_hash_p_key UNIQUE (production_job_id, source_hash, pack_version, run_key, panel_key);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.vehicle_specs_cache ADD CONSTRAINT vehicle_specs_cache_make_model_year_range_key UNIQUE (make, model, year_range);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.vinyl_reference_images ADD CONSTRAINT vinyl_reference_images_swatch_id_image_url_key UNIQUE (swatch_id, image_url);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.workflow_stage_runs ADD CONSTRAINT workflow_stage_runs_idempotency UNIQUE (run_id, idempotency_key);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

DO $ADDC$ BEGIN
  ALTER TABLE public.workflow_stage_runs ADD CONSTRAINT workflow_stage_runs_logical_key UNIQUE (run_id, stage_key, scope_key);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $ADDC$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_templates_signature ON public.render_templates USING btree (prompt_signature, vehicle_signature);

CREATE UNIQUE INDEX IF NOT EXISTS render_events_source_unique_idx ON public.render_events USING btree (source_table, source_id) WHERE ((source_table IS NOT NULL) AND (source_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_design_version_commits_generation_version ON public.design_version_commits USING btree (designiq_generation_id, version_number) WHERE (designiq_generation_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designpro_entice_packs_active_design ON public.designpro_entice_packs USING btree (design_id) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designpro_entice_packs_saved_source ON public.designpro_entice_packs USING btree (tenant_key, design_id, source_visualization_id, submission_hash, definition_version) WHERE (source_visualization_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_panels_render_panel ON public.production_panels USING btree (render_id, COALESCE(panel_name, ''::text));

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_flow_assets_entice_pack_side ON public.production_flow_assets USING btree (entice_pack_id, upper(btrim((side)::text))) WHERE (entice_pack_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_runs_workflow_idempotency ON public.workforce_runs USING btree (workflow_type, COALESCE(tenant_key, ''::text), idempotency_key) WHERE ((workflow_type IS NOT NULL) AND (idempotency_key IS NOT NULL));

CREATE OR REPLACE FUNCTION public.activate_designpro_entice_pack(p_stage_id uuid, p_lease_token uuid, p_pack_id uuid, p_pack_identity_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage public.workflow_stage_runs%ROWTYPE;
  v_run public.workforce_runs%ROWTYPE;
  v_pack public.designpro_entice_packs%ROWTYPE;
  v_revision public.design_version_commits%ROWTYPE;
  v_visualization public.color_visualizations%ROWTYPE;
  v_previous uuid[];
  v_source_saved_at timestamptz;
  v_updated integer;
  v_completed boolean;
BEGIN
  SELECT * INTO v_stage
  FROM public.workflow_stage_runs
  WHERE id = p_stage_id
    AND stage_key = 'pack.activate'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_activation_lease_lost';
  END IF;

  SELECT * INTO v_run
  FROM public.workforce_runs
  WHERE id = v_stage.run_id
    AND workflow_type = 'designpro.entice_pack'
    AND domain_job_type = 'designpro_entice_packs'
    AND domain_job_id = p_pack_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_workflow_binding_invalid';
  END IF;

  SELECT * INTO v_pack
  FROM public.designpro_entice_packs
  WHERE id = p_pack_id
    AND workflow_run_id = v_run.id
    AND status = 'verified'
    AND pack_identity_hash = p_pack_identity_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_not_verified';
  END IF;

  SELECT * INTO v_revision
  FROM public.design_version_commits
  WHERE id = v_pack.revision_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_revision.workflow_run_id IS DISTINCT FROM v_run.id
     OR v_revision.entice_pack_id IS DISTINCT FROM v_pack.id
     OR v_revision.designiq_generation_id
          IS DISTINCT FROM v_pack.designiq_generation_id
     OR v_revision.source_visualization_id
          IS DISTINCT FROM v_pack.source_visualization_id THEN
    RAISE EXCEPTION 'entice_pack_revision_binding_invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'designpro.entice_pack.activate:' || v_pack.design_id,
      0
    )
  );

  SELECT *
  INTO v_visualization
  FROM public.color_visualizations
  WHERE id = v_pack.source_visualization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_source_visualization_missing';
  END IF;
  BEGIN
    v_source_saved_at :=
      (v_revision.revision_snapshot->>'savedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'entice_pack_revision_saved_at_invalid';
  END;
  IF v_source_saved_at IS NULL
     OR v_visualization.updated_at IS DISTINCT FROM v_source_saved_at THEN
    RAISE EXCEPTION 'entice_pack_source_changed_after_freeze';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.design_version_commits newer
    WHERE newer.designiq_generation_id = v_pack.designiq_generation_id
      AND newer.version_number > v_revision.version_number
      AND newer.frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'newer_design_revision_exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_stage_runs verified
    WHERE verified.run_id = v_run.id
      AND verified.stage_key = 'pack.verify'
      AND verified.status = 'completed'
      AND verified.output_hash = p_pack_identity_hash
      AND verified.verification @> '{"verified":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'entice_pack_verification_checkpoint_missing';
  END IF;

  PERFORM 1
  FROM public.designpro_entice_packs
  WHERE design_id = v_pack.design_id
    AND status = 'active'
    AND id <> v_pack.id
  FOR UPDATE;

  SELECT array_agg(id) INTO v_previous
  FROM public.designpro_entice_packs
  WHERE design_id = v_pack.design_id
    AND status = 'active'
    AND id <> v_pack.id;

  UPDATE public.designpro_entice_packs
  SET status = 'superseded',
      superseded_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE design_id = v_pack.design_id
    AND status = 'active'
    AND id <> v_pack.id;

  UPDATE public.design_version_commits
  SET entice_status = 'superseded'
  WHERE entice_pack_id = ANY(COALESCE(v_previous, ARRAY[]::uuid[]));

  UPDATE public.designpro_entice_packs
  SET status = 'active',
      activated_at = COALESCE(activated_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE id = v_pack.id;

  UPDATE public.design_version_commits
  SET entice_status = 'active'
  WHERE id = v_revision.id;

  UPDATE public.designiq_generations
  SET flat_proof_url = v_pack.proof_artifact->>'url',
      master_artboard_clean_url = COALESCE(
        NULLIF(v_pack.proof_artifact->>'cleanArtboardUrl', ''),
        master_artboard_clean_url
      ),
      master_artboard_url = COALESCE(
        NULLIF(v_pack.proof_artifact->>'brandedArtboardUrl', ''),
        master_artboard_url
      )
  WHERE id = v_pack.designiq_generation_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'entice_pack_generation_pointer_update_failed';
  END IF;

  -- Do not update color_visualizations here. Its updated_at value is the
  -- immutable saved-pixel fence used by revision submission and retry. The
  -- table's generic updated_at trigger also fires for metadata-only admin_notes
  -- writes, which would make an unchanged activated revision look newly edited.
  -- The active pointer is authoritative in designpro_entice_packs; the legacy
  -- proof/artboard compatibility pointers above remain on designiq_generations.

  IF EXISTS (
       SELECT 1
       FROM public.designpro_entice_packs active_pack
       WHERE active_pack.design_id = v_pack.design_id
         AND active_pack.status = 'active'
         AND active_pack.id <> v_pack.id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.designpro_entice_packs active_pack
       WHERE active_pack.id = v_pack.id
         AND active_pack.status = 'active'
         AND active_pack.pack_identity_hash = p_pack_identity_hash
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.design_version_commits active_revision
       WHERE active_revision.id = v_revision.id
         AND active_revision.entice_status = 'active'
         AND active_revision.entice_pack_id = v_pack.id
     )
  THEN
    RAISE EXCEPTION 'entice_pack_activation_postcondition_failed';
  END IF;

  SELECT public.complete_workflow_stage(
    p_stage_id,
    p_lease_token,
    jsonb_build_object(
      'packId', v_pack.id,
      'revisionId', v_pack.revision_id,
      'active', true,
      'supersededPackIds', COALESCE(to_jsonb(v_previous), '[]'::jsonb)
    ),
    jsonb_build_object(
      'verified', true,
      'kind', 'designpro_entice_pack_activation',
      'atomic', true,
      'packIdentityHash', p_pack_identity_hash
    ),
    p_pack_identity_hash
  ) INTO v_completed;
  IF v_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'entice_pack_activation_completion_fenced';
  END IF;

  RETURN jsonb_build_object(
    'activated', true,
    'packId', v_pack.id,
    'revisionId', v_pack.revision_id,
    'supersededPackIds', COALESCE(to_jsonb(v_previous), '[]'::jsonb)
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.add_user_tokens(p_user_id uuid, p_amount integer, p_reason text DEFAULT 'Token Purchase'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_new_balance INT;
BEGIN
  INSERT INTO user_tokens (user_id, balance, total_purchased, total_used)
  VALUES (p_user_id, p_amount, p_amount, 0)
  ON CONFLICT (user_id) DO UPDATE
  SET balance = user_tokens.balance + p_amount,
      total_purchased = user_tokens.total_purchased + p_amount,
      updated_at = NOW();
  
  SELECT balance INTO v_new_balance
  FROM user_tokens WHERE user_id = p_user_id;
  
  INSERT INTO token_transactions (user_id, amount, balance_after, reason)
  VALUES (p_user_id, p_amount, v_new_balance, p_reason);
  
  RETURN jsonb_build_object(
    'success', true,
    'added', p_amount,
    'balance', v_new_balance
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.begin_production_panel_dispatch(p_dispatch_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_changed integer;
BEGIN
  UPDATE public.production_panel_dispatches
  SET status = 'processing',
      lease_expires_at = clock_timestamp() + make_interval(
        secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 900), 30), 1800)
      ),
      updated_at = clock_timestamp()
  WHERE id = p_dispatch_id
    AND status = 'dispatched'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.can_generate_render(user_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  subscription_record RECORD;
  usage_count INTEGER;
  tier_limit INTEGER;
  is_privileged BOOLEAN := false;
  found_user_id UUID;
BEGIN
  -- FIRST: Check admin/tester role directly via auth.users email (no subscription required)
  SELECT u.id INTO found_user_id
  FROM auth.users u
  WHERE u.email = user_email
  LIMIT 1;

  IF found_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 
      FROM public.user_roles 
      WHERE user_id = found_user_id 
      AND role IN ('admin', 'tester')
    ) INTO is_privileged;

    IF is_privileged THEN
      RETURN jsonb_build_object(
        'can_generate', true,
        'tier', 'agency',
        'limit', 999999,
        'used', 0,
        'remaining', 999999,
        'message', 'Privileged Access - Unlimited Renders'
      );
    END IF;
  END IF;

  -- Get subscription record
  SELECT * INTO subscription_record
  FROM public.user_subscriptions
  WHERE email = user_email
    AND status = 'active'
    AND billing_cycle_end > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no subscription, return free tier limits (0)
  IF subscription_record IS NULL THEN
    RETURN jsonb_build_object(
      'can_generate', false,
      'tier', 'none',
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'message', 'No active subscription. Please subscribe to generate renders.'
    );
  END IF;

  -- Get tier limit
  tier_limit := public.get_tier_limit(subscription_record.tier);

  -- Count renders in current billing cycle
  SELECT COUNT(*) INTO usage_count
  FROM public.render_usage
  WHERE email = user_email
    AND billing_cycle_start = subscription_record.billing_cycle_start;

  -- Check if can generate
  IF usage_count >= tier_limit THEN
    RETURN jsonb_build_object(
      'can_generate', false,
      'tier', subscription_record.tier,
      'limit', tier_limit,
      'used', usage_count,
      'remaining', 0,
      'message', 'Monthly render limit reached. Upgrade your plan or wait for next billing cycle.'
    );
  ELSE
    RETURN jsonb_build_object(
      'can_generate', true,
      'tier', subscription_record.tier,
      'limit', tier_limit,
      'used', usage_count,
      'remaining', tier_limit - usage_count,
      'message', 'OK'
    );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_production_package_dispatch(p_panelizer_job_id uuid, p_source_hash text, p_pack_version text, p_run_key text, p_worker text, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_job public.designpro_production_jobs%ROWTYPE;
  v_run public.workforce_runs%ROWTYPE;
  v_dispatch public.production_panel_dispatches%ROWTYPE;
  v_run_id uuid;
  v_token uuid;
  v_payload_hash text;
  v_lease_seconds integer :=
    LEAST(GREATEST(COALESCE(p_lease_seconds, 900), 30), 1800);
BEGIN
  IF lower(COALESCE(p_source_hash, '')) !~ '^[0-9a-f]{64}$'
     OR lower(COALESCE(p_pack_version, ''))
          <> 'v2:' || left(lower(p_source_hash), 24)
     OR NULLIF(btrim(p_run_key), '') IS NULL
     OR NULLIF(btrim(p_worker), '') IS NULL THEN
    RAISE EXCEPTION 'package source identity is malformed';
  END IF;

  SELECT *
  INTO v_job
  FROM public.designpro_production_jobs
  WHERE panelizer_job_id = p_panelizer_job_id::text
    AND lower(COALESCE(result->>'sourceHash', '')) = lower(p_source_hash)
    AND lower(COALESCE(result->>'packVersion', '')) = lower(p_pack_version)
    AND lower(COALESCE(result->>'runKey', '')) = lower(p_run_key)
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package domain binding is invalid'; END IF;

  v_run_id := NULLIF(v_job.result->>'workflowRunId', '')::uuid;
  SELECT *
  INTO v_run
  FROM public.workforce_runs
  WHERE id = v_run_id
      AND workflow_type = 'designpro.production_pack'
      AND domain_job_id = v_job.id
      AND workflow_status IN ('queued', 'running', 'waiting')
      AND cancel_requested_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_run.id IS NULL THEN
    RAISE EXCEPTION 'package workflow binding is invalid';
  END IF;

  v_payload_hash := encode(
    digest(
      jsonb_build_object(
        'panelizerJobId', p_panelizer_job_id,
        'sourceHash', lower(p_source_hash),
        'packVersion', lower(p_pack_version),
        'runKey', lower(p_run_key)
      )::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.production_panel_dispatches (
    workflow_run_id, production_job_id, panelizer_job_id,
    source_hash, pack_version, run_key, panel_key, payload_hash
  ) VALUES (
    v_run_id, v_job.id, p_panelizer_job_id,
    lower(p_source_hash), lower(p_pack_version), lower(p_run_key),
    '__package__', v_payload_hash
  )
  ON CONFLICT (
    production_job_id, source_hash, pack_version, run_key, panel_key
  ) DO NOTHING;

  SELECT *
  INTO v_dispatch
  FROM public.production_panel_dispatches
  WHERE production_job_id = v_job.id
    AND source_hash = lower(p_source_hash)
    AND pack_version = lower(p_pack_version)
    AND run_key = lower(p_run_key)
    AND panel_key = '__package__'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package claim was not persisted';
  END IF;
  IF v_dispatch.workflow_run_id IS DISTINCT FROM v_run_id
     OR v_dispatch.panelizer_job_id IS DISTINCT FROM p_panelizer_job_id
     OR v_dispatch.payload_hash <> v_payload_hash THEN
    RAISE EXCEPTION 'package_payload_conflict';
  END IF;
  IF v_dispatch.status = 'completed' OR (
    v_dispatch.status IN ('pending', 'dispatched', 'processing') AND
    v_dispatch.lease_expires_at > clock_timestamp()
  ) THEN
    RETURN jsonb_build_object(
      'dispatchId', v_dispatch.id,
      'status', v_dispatch.status,
      'claimed', false
    );
  END IF;
  IF v_dispatch.status = 'failed'
     AND v_dispatch.available_at > clock_timestamp() THEN
    RETURN jsonb_build_object(
      'dispatchId', v_dispatch.id,
      'status', 'failed',
      'claimed', false,
      'availableAt', v_dispatch.available_at
    );
  END IF;
  IF v_dispatch.attempt >= v_dispatch.max_attempts THEN
    RAISE EXCEPTION 'package_attempts_exhausted';
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.production_panel_dispatches
  SET status = 'processing',
      attempt = attempt + 1,
      lease_owner = p_worker,
      lease_token = v_token,
      lease_expires_at = clock_timestamp() +
        make_interval(secs => v_lease_seconds),
      available_at = clock_timestamp(),
      error = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_dispatch.id;

  RETURN jsonb_build_object(
    'dispatchId', v_dispatch.id,
    'dispatchToken', v_token,
    'status', 'processing',
    'claimed', true
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.claim_workflow_resource_lease(p_resource_key text, p_owner text, p_lease_seconds integer DEFAULT 600, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lease public.workflow_resource_leases%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_seconds integer :=
    LEAST(GREATEST(COALESCE(p_lease_seconds, 600), 15), 900);
BEGIN
  IF NULLIF(btrim(p_resource_key), '') IS NULL
     OR NULLIF(btrim(p_owner), '') IS NULL THEN
    RAISE EXCEPTION 'resource and owner identities are required';
  END IF;

  INSERT INTO public.workflow_resource_leases (
    resource_key,
    lease_owner,
    lease_token,
    lease_expires_at,
    context,
    acquired_at,
    heartbeat_at,
    updated_at
  ) VALUES (
    p_resource_key,
    p_owner,
    v_token,
    v_now + make_interval(secs => v_seconds),
    COALESCE(p_context, '{}'::jsonb),
    v_now,
    v_now,
    v_now
  )
  ON CONFLICT (resource_key) DO NOTHING
  RETURNING * INTO v_lease;

  IF NOT FOUND THEN
    SELECT *
    INTO v_lease
    FROM public.workflow_resource_leases
    WHERE resource_key = p_resource_key
    FOR UPDATE;

    IF v_lease.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'resourceKey', v_lease.resource_key,
        'leaseOwner', v_lease.lease_owner,
        'leaseExpiresAt', v_lease.lease_expires_at
      );
    END IF;

    UPDATE public.workflow_resource_leases
    SET lease_owner = p_owner,
        lease_token = v_token,
        lease_expires_at = v_now + make_interval(secs => v_seconds),
        context = COALESCE(p_context, '{}'::jsonb),
        acquired_at = v_now,
        heartbeat_at = v_now,
        updated_at = v_now
    WHERE resource_key = p_resource_key
      AND lease_token = v_lease.lease_token
    RETURNING * INTO v_lease;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'resourceKey', p_resource_key
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'acquired', true,
    'resourceKey', v_lease.resource_key,
    'leaseOwner', v_lease.lease_owner,
    'leaseToken', v_lease.lease_token,
    'leaseExpiresAt', v_lease.lease_expires_at
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.claim_workflow_stage(p_worker text, p_lease_seconds integer DEFAULT 120, p_workflow_type text DEFAULT NULL::text)
 RETURNS workflow_stage_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage public.workflow_stage_runs%ROWTYPE;
  v_run_id uuid;
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 15), 900);
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL THEN
    RAISE EXCEPTION 'worker identity is required';
  END IF;

  -- An abandoned final attempt must become a visible terminal failure instead
  -- of remaining an unclaimable running zombie.
  FOR v_run_id IN
    WITH exhausted AS (
      UPDATE public.workflow_stage_runs s
      SET status = 'failed',
          error_code = 'lease_exhausted',
          error_message = 'Worker lease expired after the final attempt',
          error_details = jsonb_build_object(
            'lease_owner', s.lease_owner,
            'lease_expires_at', s.lease_expires_at
          ),
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      FROM public.workforce_runs r
      WHERE r.id = s.run_id
        AND r.workflow_status IN ('queued', 'running', 'waiting')
        AND (p_workflow_type IS NULL OR r.workflow_type = p_workflow_type)
        AND s.status = 'running'
        AND s.lease_expires_at <= clock_timestamp()
        AND s.attempt >= s.max_attempts
      RETURNING s.run_id
    )
    SELECT DISTINCT run_id FROM exhausted
  LOOP
    PERFORM public.sync_workflow_run_status(v_run_id);
  END LOOP;

  SELECT s.*
  INTO v_stage
  FROM public.workflow_stage_runs s
  JOIN public.workforce_runs r ON r.id = s.run_id
  WHERE r.workflow_status IN ('queued', 'running', 'waiting')
    AND (p_workflow_type IS NULL OR r.workflow_type = p_workflow_type)
    AND r.cancel_requested_at IS NULL
    AND s.attempt < s.max_attempts
    AND s.available_at <= clock_timestamp()
    AND (
      s.status IN ('pending', 'retryable') OR
      (s.status = 'running' AND s.lease_expires_at <= clock_timestamp())
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_stage_runs prior
      WHERE prior.run_id = s.run_id
        AND prior.sequence < s.sequence
        AND prior.status NOT IN ('completed', 'skipped')
    )
  ORDER BY s.available_at, s.sequence, s.created_at
  FOR UPDATE OF s SKIP LOCKED
  LIMIT 1;

  IF v_stage.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.workflow_stage_runs
  SET status = 'running',
      attempt = attempt + 1,
      lease_owner = p_worker,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      started_at = COALESCE(started_at, clock_timestamp()),
      error_code = NULL,
      error_message = NULL,
      error_details = '{}'::jsonb,
      wait_reason = NULL,
      wait_details = '{}'::jsonb,
      updated_at = clock_timestamp()
  WHERE id = v_stage.id
  RETURNING * INTO v_stage;

  UPDATE public.workforce_runs
  SET workflow_status = 'running',
      finished_at = NULL,
      error = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_stage.run_id
    AND workflow_status IN ('queued', 'waiting');

  RETURN v_stage;
END
$function$
;

CREATE OR REPLACE FUNCTION public.complete_production_panel_dispatch(p_dispatch_id uuid, p_lease_token uuid, p_output jsonb, p_output_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed integer;
  v_dispatch public.production_panel_dispatches%ROWTYPE;
BEGIN
  IF COALESCE(p_output_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'canonical dispatch output hash is required';
  END IF;

  SELECT *
  INTO v_dispatch
  FROM public.production_panel_dispatches
  WHERE id = p_dispatch_id
    AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF lower(COALESCE(p_output->>'sourceHash', ''))
        <> v_dispatch.source_hash
     OR lower(COALESCE(p_output->>'packVersion', ''))
        <> v_dispatch.pack_version
     OR lower(COALESCE(p_output->>'runKey', ''))
        <> v_dispatch.run_key
     OR COALESCE(p_output->>'panelKey', '')
        <> v_dispatch.panel_key THEN
    RAISE EXCEPTION 'dispatch output identity is invalid';
  END IF;
  IF v_dispatch.panel_key = '__package__'
     AND (
       NULLIF(p_output->>'path', '') IS NULL OR
       NULLIF(p_output->>'url', '') IS NULL OR
       NULLIF(p_output->'zip'->>'sha256', '') IS NULL OR
       lower(p_output->'zip'->>'sha256') <> lower(p_output_hash) OR
       p_output->>'path' <> p_output->'zip'->>'path' OR
       p_output->>'url' <> p_output->'zip'->>'url'
     ) THEN
    RAISE EXCEPTION 'package output path and URL are required with matching SHA-256 evidence';
  END IF;

  UPDATE public.production_panel_dispatches
  SET status = 'completed',
      output = COALESCE(p_output, '{}'::jsonb),
      output_hash = p_output_hash,
      completed_at = clock_timestamp(),
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      error = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_dispatch_id
    AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.complete_workflow_stage(p_stage_id uuid, p_lease_token uuid, p_output jsonb DEFAULT '{}'::jsonb, p_verification jsonb DEFAULT '{}'::jsonb, p_output_hash text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  IF NOT (COALESCE(p_verification, '{}'::jsonb) @> '{"verified": true}'::jsonb) THEN
    RAISE EXCEPTION 'verified completion evidence is required';
  END IF;

  UPDATE public.workflow_stage_runs
  SET status = 'completed',
      output = COALESCE(p_output, '{}'::jsonb),
      verification = p_verification,
      output_hash = p_output_hash,
      completed_at = clock_timestamp(),
      wait_reason = NULL,
      wait_details = '{}'::jsonb,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_stage_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  RETURNING run_id INTO v_run_id;

  IF v_run_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.sync_workflow_run_status(v_run_id);
  RETURN true;
END
$function$
;

CREATE OR REPLACE FUNCTION public.defer_workflow_stage(p_stage_id uuid, p_lease_token uuid, p_delay_seconds integer DEFAULT 30, p_reason text DEFAULT 'waiting'::text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  UPDATE public.workflow_stage_runs
  SET status = 'pending',
      attempt = GREATEST(attempt - 1, 0),
      available_at = clock_timestamp() + make_interval(
        secs => LEAST(GREATEST(COALESCE(p_delay_seconds, 30), 1), 604800)
      ),
      wait_reason = COALESCE(NULLIF(p_reason, ''), 'waiting'),
      wait_details = COALESCE(p_details, '{}'::jsonb),
      deferred_count = deferred_count + 1,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_stage_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  RETURNING run_id INTO v_run_id;

  IF v_run_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.sync_workflow_run_status(v_run_id);
  RETURN true;
END
$function$
;

CREATE OR REPLACE FUNCTION public.fail_production_panel_dispatch(p_dispatch_id uuid, p_lease_token uuid, p_error text, p_retry_delay_seconds integer DEFAULT 30)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_changed integer;
BEGIN
  UPDATE public.production_panel_dispatches
  SET status = 'failed',
      available_at = clock_timestamp() + make_interval(
        secs => GREATEST(COALESCE(p_retry_delay_seconds, 30), 0)
      ),
      error = COALESCE(NULLIF(p_error, ''), 'dispatch failed'),
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_dispatch_id
    AND status IN ('dispatched', 'processing')
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.fail_workflow_stage(p_stage_id uuid, p_lease_token uuid, p_error_code text, p_error_message text, p_error_details jsonb DEFAULT '{}'::jsonb, p_retryable boolean DEFAULT true, p_retry_delay_seconds integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  UPDATE public.workflow_stage_runs
  SET status = CASE
        WHEN p_retryable AND attempt < max_attempts THEN 'retryable'
        ELSE 'failed'
      END,
      available_at = CASE
        WHEN p_retryable AND attempt < max_attempts
          THEN clock_timestamp() + make_interval(
            secs => GREATEST(COALESCE(p_retry_delay_seconds, 0), 0)
          )
        ELSE available_at
      END,
      error_code = NULLIF(p_error_code, ''),
      error_message = NULLIF(p_error_message, ''),
      error_details = COALESCE(p_error_details, '{}'::jsonb),
      wait_reason = NULL,
      wait_details = '{}'::jsonb,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_stage_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  RETURNING run_id INTO v_run_id;

  IF v_run_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.sync_workflow_run_status(v_run_id);
  RETURN true;
END
$function$
;

CREATE OR REPLACE FUNCTION public.get_tier_limit(tier_name text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE tier_name
    WHEN 'starter'          THEN 50
    WHEN 'designpro_lite'   THEN 75
    WHEN 'designpro_studio' THEN 150
    WHEN 'designpro_plus'   THEN 300
    WHEN 'professional'     THEN 50
    WHEN 'complete'         THEN 200
    WHEN 'business'         THEN 200
    ELSE 0
  END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.heartbeat_production_panel_dispatch(p_dispatch_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_changed integer;
BEGIN
  UPDATE public.production_panel_dispatches
  SET lease_expires_at = clock_timestamp() + make_interval(
        secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 900), 30), 1800)
      ),
      updated_at = clock_timestamp()
  WHERE id = p_dispatch_id
    AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.heartbeat_workflow_resource_lease(p_resource_key text, p_lease_token uuid, p_lease_seconds integer DEFAULT 600)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed integer;
  v_seconds integer :=
    LEAST(GREATEST(COALESCE(p_lease_seconds, 600), 15), 900);
BEGIN
  UPDATE public.workflow_resource_leases
  SET lease_expires_at =
        clock_timestamp() + make_interval(secs => v_seconds),
      heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE resource_key = p_resource_key
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.heartbeat_workflow_stage(p_stage_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 15), 900);
BEGIN
  UPDATE public.workflow_stage_runs
  SET lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      updated_at = clock_timestamp()
  WHERE id = p_stage_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.kick_print_worker(p_url text, p_secret text, p_body jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
  select net.http_post(
    url := p_url,
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || p_secret
    ),
    timeout_milliseconds := 150000
  );
$function$
;

CREATE OR REPLACE FUNCTION public.kick_production_slicer(p_job_id uuid, p_url text, p_secret text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
  select net.http_post(
    url := p_url,
    body := jsonb_build_object('job_id', p_job_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || p_secret
    ),
    timeout_milliseconds := 150000
  );
$function$
;

CREATE OR REPLACE FUNCTION public.release_workflow_resource_lease(p_resource_key text, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_changed integer;
BEGIN
  DELETE FROM public.workflow_resource_leases
  WHERE resource_key = p_resource_key
    AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END
$function$
;

CREATE OR REPLACE FUNCTION public.sync_workflow_run_status(p_run_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current text;
  v_next text;
  v_error text;
BEGIN
  SELECT workflow_status
  INTO v_current
  FROM public.workforce_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Approval and terminal states move only through their explicit APIs.
  IF v_current IN ('approval_required', 'completed', 'cancelled') THEN
    RETURN v_current;
  END IF;

  SELECT COALESCE(error_message, error_code, 'workflow stage failed')
  INTO v_error
  FROM public.workflow_stage_runs
  WHERE run_id = p_run_id AND status = 'failed'
  ORDER BY sequence, updated_at
  LIMIT 1;

  IF v_error IS NOT NULL THEN
    v_next := 'failed';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.workflow_stage_runs
    WHERE run_id = p_run_id
      AND status NOT IN ('completed', 'skipped')
  ) THEN
    v_next := 'completed';
  ELSIF EXISTS (
    SELECT 1
    FROM public.workflow_stage_runs
    WHERE run_id = p_run_id AND status = 'running'
  ) THEN
    v_next := 'running';
  ELSIF EXISTS (
    SELECT 1
    FROM public.workflow_stage_runs s
    WHERE s.run_id = p_run_id
      AND s.status IN ('pending', 'retryable')
      AND s.attempt < s.max_attempts
      AND s.available_at <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1
        FROM public.workflow_stage_runs prior
        WHERE prior.run_id = s.run_id
          AND prior.sequence < s.sequence
          AND prior.status NOT IN ('completed', 'skipped')
      )
  ) THEN
    v_next := 'queued';
  ELSE
    v_next := 'waiting';
  END IF;

  UPDATE public.workforce_runs
  SET workflow_status = v_next,
      finished_at = CASE
        WHEN v_next IN ('completed', 'failed', 'cancelled')
          THEN COALESCE(finished_at, clock_timestamp())
        ELSE NULL
      END,
      error = CASE WHEN v_next = 'failed' THEN v_error ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE id = p_run_id;

  RETURN v_next;
END
$function$
;

CREATE OR REPLACE FUNCTION public.verify_designpro_entice_pack(p_stage_id uuid, p_lease_token uuid, p_pack_id uuid, p_canonical_input_hash text, p_dimension_basis_hash text, p_manifest_hash text, p_pack_identity_hash text, p_source_contract_hash text, p_surface_manifest jsonb, p_proof_artifact jsonb, p_panel_artifacts jsonb, p_logo_artifacts jsonb, p_pack_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage public.workflow_stage_runs%ROWTYPE;
  v_run public.workforce_runs%ROWTYPE;
  v_pack public.designpro_entice_packs%ROWTYPE;
  v_expected text[];
  v_actual text[];
  v_persisted_count integer;
  v_updated integer;
  v_completed boolean;
BEGIN
  IF COALESCE(p_canonical_input_hash, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_dimension_basis_hash, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_manifest_hash, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_pack_identity_hash, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_source_contract_hash, '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_surface_manifest->'surfaces') <> 'array'
     OR jsonb_typeof(p_panel_artifacts) <> 'array'
     OR jsonb_typeof(p_logo_artifacts) <> 'array'
     OR NULLIF(p_proof_artifact->>'url', '') IS NULL
     OR COALESCE(p_proof_artifact->>'sha256', '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_proof_artifact->>'bytes', '') !~ '^[1-9][0-9]*$'
     OR NULLIF(btrim(p_pack_version), '') IS NULL
  THEN
    RAISE EXCEPTION 'entice_pack_verification_shape_invalid';
  END IF;

  SELECT * INTO v_stage
  FROM public.workflow_stage_runs
  WHERE id = p_stage_id
    AND stage_key = 'pack.verify'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_verification_lease_lost';
  END IF;

  SELECT * INTO v_run
  FROM public.workforce_runs
  WHERE id = v_stage.run_id
    AND workflow_type = 'designpro.entice_pack'
    AND domain_job_type = 'designpro_entice_packs'
    AND domain_job_id = p_pack_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_workflow_binding_invalid';
  END IF;

  SELECT * INTO v_pack
  FROM public.designpro_entice_packs
  WHERE id = p_pack_id
    AND workflow_run_id = v_run.id
    AND status = 'building'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entice_pack_candidate_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workflow_stage_runs
    WHERE run_id = v_run.id
      AND sequence < v_stage.sequence
      AND (
        status <> 'completed'
        OR NOT (verification @> '{"verified":true}'::jsonb)
      )
  ) THEN
    RAISE EXCEPTION 'entice_pack_prior_stage_unverified';
  END IF;

  -- Bind the verification request back to the exact persisted outputs of the
  -- preceding fenced stages. A worker cannot substitute another run's proof,
  -- manifest, or separated panel set even if those artifacts are otherwise
  -- well-shaped.
  IF NOT EXISTS (
       SELECT 1
       FROM public.workflow_stage_runs frozen
       WHERE frozen.run_id = v_run.id
         AND frozen.stage_key = 'revision.freeze'
         AND frozen.status = 'completed'
         AND frozen.output_hash = p_canonical_input_hash
         AND frozen.output->>'canonicalInputHash' = p_canonical_input_hash
         AND frozen.output->>'packId' = v_pack.id::text
         AND frozen.output->>'revisionId' = v_pack.revision_id::text
         AND frozen.verification @> '{"verified":true}'::jsonb
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.workflow_stage_runs manifest
       WHERE manifest.run_id = v_run.id
         AND manifest.stage_key = 'manifest.resolve'
         AND manifest.status = 'completed'
         AND manifest.output_hash = p_manifest_hash
         AND manifest.output->>'manifestHash' = p_manifest_hash
         AND manifest.output->>'dimensionBasisHash' = p_dimension_basis_hash
         AND manifest.output->'surfaces' = p_surface_manifest->'surfaces'
         AND manifest.output->'expectedSides'
               = p_surface_manifest->'expectedSides'
         AND manifest.output->'dimensions'
               = p_surface_manifest->'dimensions'
         AND manifest.verification @> '{"verified":true}'::jsonb
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.workflow_stage_runs proof
       WHERE proof.run_id = v_run.id
         AND proof.stage_key = 'proof.build'
         AND proof.status = 'completed'
         AND proof.output->>'url' = p_proof_artifact->>'url'
         AND proof.output->>'sha256' = p_proof_artifact->>'sha256'
         AND proof.verification @> '{"verified":true}'::jsonb
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.workflow_stage_runs separated
       WHERE separated.run_id = v_run.id
         AND separated.stage_key = 'logos.extract'
         AND separated.status = 'completed'
         AND separated.output->'panels' = p_panel_artifacts
         AND separated.output->'logoArtifacts' = p_logo_artifacts
         AND separated.verification @> '{"verified":true}'::jsonb
     )
  THEN
    RAISE EXCEPTION 'entice_pack_stage_output_binding_invalid';
  END IF;

  SELECT array_agg(upper(btrim(value->>'key')) ORDER BY upper(btrim(value->>'key')))
  INTO v_expected
  FROM jsonb_array_elements(p_surface_manifest->'surfaces');
  SELECT array_agg(upper(btrim(value->>'side')) ORDER BY upper(btrim(value->>'side')))
  INTO v_actual
  FROM jsonb_array_elements(p_panel_artifacts);

  IF v_expected IS NULL OR v_actual IS NULL
     OR v_expected IS DISTINCT FROM v_actual
     OR cardinality(v_actual) <> (
       SELECT count(DISTINCT upper(btrim(value->>'side')))
       FROM jsonb_array_elements(p_panel_artifacts)
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_panel_artifacts) value
       WHERE NULLIF(btrim(value->>'side'), '') IS NULL
          OR (
               NULLIF(value->>'cleanUrl', '') IS NULL
               AND value->'separationQc'->'pass'
                   IS DISTINCT FROM 'false'::jsonb
             )
          OR NULLIF(value->>'brandedUrl', '') IS NULL
          OR COALESCE(value->>'artifactHash', '') !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(value->'widthIn') <> 'number'
          OR jsonb_typeof(value->'heightIn') <> 'number'
          OR jsonb_typeof(value->'bleedIn') <> 'number'
          OR CASE
               WHEN jsonb_typeof(value->'widthIn') = 'number'
                 THEN (value->>'widthIn')::numeric <= 0
               ELSE true
             END
          OR CASE
               WHEN jsonb_typeof(value->'heightIn') = 'number'
                 THEN (value->>'heightIn')::numeric <= 0
               ELSE true
             END
          OR CASE
               WHEN jsonb_typeof(value->'bleedIn') = 'number'
                 THEN (value->>'bleedIn')::numeric <> 5
               ELSE true
             END
          OR value->'qc'->'known' IS DISTINCT FROM 'true'::jsonb
          OR value->'qc'->'pass' IS DISTINCT FROM 'true'::jsonb
          OR value->'separationQc'->'known'
               IS DISTINCT FROM 'true'::jsonb
          OR (
               value->'separationQc'->'pass' IS DISTINCT FROM 'true'::jsonb
               AND (
                 value->'separationQc'->'pass' IS DISTINCT FROM 'false'::jsonb
                 OR NULLIF(btrim(value->'separationQc'->>'reason'), '') IS NULL
               )
             )
     )
  THEN
    RAISE EXCEPTION 'entice_pack_atomic_surface_verification_failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_surface_manifest->'surfaces')
      AS surface_item(surface)
    LEFT JOIN LATERAL (
      SELECT panel
      FROM jsonb_array_elements(p_panel_artifacts)
        AS panel_item(panel)
      WHERE upper(btrim(panel->>'side'))
            = upper(btrim(surface->>'key'))
      LIMIT 1
    ) matched ON true
    WHERE NULLIF(btrim(surface->>'key'), '') IS NULL
       OR jsonb_typeof(surface->'trimWidthIn') <> 'number'
       OR jsonb_typeof(surface->'trimHeightIn') <> 'number'
       OR jsonb_typeof(surface->'bleedIn') <> 'number'
       OR CASE
            WHEN jsonb_typeof(surface->'trimWidthIn') = 'number'
              THEN (surface->>'trimWidthIn')::numeric <= 0
            ELSE true
          END
       OR CASE
            WHEN jsonb_typeof(surface->'trimHeightIn') = 'number'
              THEN (surface->>'trimHeightIn')::numeric <= 0
            ELSE true
          END
       OR CASE
            WHEN jsonb_typeof(surface->'bleedIn') = 'number'
              THEN (surface->>'bleedIn')::numeric <> 5
            ELSE true
          END
       OR matched.panel IS NULL
       OR CASE
            WHEN jsonb_typeof(matched.panel->'widthIn') = 'number'
             AND jsonb_typeof(surface->'trimWidthIn') = 'number'
              THEN (matched.panel->>'widthIn')::numeric
                   <> (surface->>'trimWidthIn')::numeric
            ELSE true
          END
       OR CASE
            WHEN jsonb_typeof(matched.panel->'heightIn') = 'number'
             AND jsonb_typeof(surface->'trimHeightIn') = 'number'
              THEN (matched.panel->>'heightIn')::numeric
                   <> (surface->>'trimHeightIn')::numeric
            ELSE true
          END
  ) THEN
    RAISE EXCEPTION 'entice_pack_surface_dimension_binding_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_logo_artifacts) logo
    WHERE NULLIF(logo->>'url', '') IS NULL
       OR COALESCE(logo->>'sha256', '') !~ '^[0-9a-f]{64}$'
       OR COALESCE(logo->>'bytes', '') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'entice_pack_logo_artifact_verification_failed';
  END IF;

  -- Stage success is not enough: the exact revision-bound vault rows must be
  -- present before the domain pack can become verified.
  SELECT count(*)::integer
  INTO v_persisted_count
  FROM public.production_flow_assets
  WHERE entice_pack_id = v_pack.id;

  IF v_persisted_count <> cardinality(v_actual)
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_panel_artifacts) panel
       LEFT JOIN public.production_flow_assets asset
         ON asset.entice_pack_id = v_pack.id
        AND upper(btrim(asset.side)) = upper(btrim(panel->>'side'))
       WHERE asset.id IS NULL
          OR asset.job_id::text IS DISTINCT FROM v_pack.design_id
          OR asset.revision_id IS DISTINCT FROM v_pack.revision_id
          OR asset.designiq_generation_id
               IS DISTINCT FROM v_pack.designiq_generation_id
          OR asset.dimension_manifest_id
               IS DISTINCT FROM v_pack.dimension_manifest_id
          OR asset.manifest_hash IS DISTINCT FROM p_manifest_hash
          OR asset.source_contract_hash
               IS DISTINCT FROM p_source_contract_hash
          OR asset.artifact_hash
               IS DISTINCT FROM panel->>'artifactHash'
          OR COALESCE(asset.background_url, '')
               IS DISTINCT FROM COALESCE(panel->>'cleanUrl', '')
          OR asset.branding_url
               IS DISTINCT FROM panel->>'brandedUrl'
     )
  THEN
    RAISE EXCEPTION 'entice_pack_persisted_vault_verification_failed';
  END IF;

  UPDATE public.designpro_entice_packs
  SET status = 'verified',
      canonical_input_hash = p_canonical_input_hash,
      dimension_basis_hash = p_dimension_basis_hash,
      manifest_hash = p_manifest_hash,
      pack_identity_hash = p_pack_identity_hash,
      source_contract_hash = p_source_contract_hash,
      surface_manifest = p_surface_manifest,
      proof_artifact = p_proof_artifact,
      panel_artifacts = p_panel_artifacts,
      logo_artifacts = p_logo_artifacts,
      pack_version = p_pack_version,
      verified_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_pack.id;

  UPDATE public.design_version_commits
  SET entice_status = 'verified'
  WHERE id = v_pack.revision_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'entice_pack_revision_verification_update_failed';
  END IF;

  SELECT public.complete_workflow_stage(
    p_stage_id,
    p_lease_token,
    jsonb_build_object(
      'packId', v_pack.id,
      'packIdentityHash', p_pack_identity_hash,
      'sourceContractHash', p_source_contract_hash,
      'packVersion', p_pack_version
    ),
    jsonb_build_object(
      'verified', true,
      'kind', 'designpro_entice_pack',
      'surfaceCount', cardinality(v_actual),
      'manifestHash', p_manifest_hash
    ),
    p_pack_identity_hash
  ) INTO v_completed;
  IF v_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'entice_pack_verification_completion_fenced';
  END IF;

  RETURN jsonb_build_object(
    'verified', true,
    'packId', v_pack.id,
    'packIdentityHash', p_pack_identity_hash
  );
END
$function$
;


-- SECURITY DEFINER functions must not be executable by PUBLIC or anon
-- (designpro_bootstrap.test.sql assertion 20). The chain runs service-role;
-- client-facing grants are a deliberate later step with the UI wiring.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        'add_user_tokens','heartbeat_workflow_stage','kick_print_worker',
        'kick_production_slicer','can_generate_render',
        'activate_designpro_entice_pack','claim_workflow_stage',
        'complete_workflow_stage','defer_workflow_stage','fail_workflow_stage',
        'verify_designpro_entice_pack','begin_production_panel_dispatch',
        'complete_production_panel_dispatch','fail_production_panel_dispatch',
        'heartbeat_production_panel_dispatch','claim_production_package_dispatch',
        'claim_workflow_resource_lease','heartbeat_workflow_resource_lease',
        'release_workflow_resource_lease','has_role',
        'sync_workflow_run_status','get_tier_limit')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;
