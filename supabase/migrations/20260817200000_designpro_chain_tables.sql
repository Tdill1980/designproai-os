-- The tables the migrated DesignPro chain reads and writes.
--
-- The edge functions were copied from restylepro-os byte-for-byte, and they
-- talk to the schema they always talked to. This creates that schema in
-- DesignProAI's own project (wozyamlnygaddievzuwn) so the copied chain runs
-- unmodified: same table names, same columns, same defaults, captured from the
-- live production database on 2026-08-17 rather than guessed. Only the tables
-- the routed DesignPro function set actually touches are created -- the other
-- RestylePro products' tables stay behind.
--
-- Boundaries preserved: every table gets RLS enabled with no anon policies, so
-- nothing is exposed to the public API surface. The edge functions run with the
-- service role and bypass RLS exactly as they did on the source project.

-- Two enum types the chain's column defaults reference.
do $$ begin
  create type public.print_production_status as enum
    ('awaiting_payment', 'paid_submitted', 'in_production', 'files_ready', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shop_member_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

create table if not exists public.blocked_users (
  id uuid default gen_random_uuid() not null,
  email text not null,
  reason text,
  blocked_at timestamp with time zone default now(),
  blocked_by text,
  primary key (id)
);

create table if not exists public.color_visualizations (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  customer_email text not null,
  organization_id uuid,
  subscription_tier text default 'free'::text,
  vehicle_make text not null,
  vehicle_model text not null,
  vehicle_year integer not null,
  vehicle_type text,
  color_hex text not null,
  color_name text not null,
  finish_type text not null,
  has_metallic_flakes boolean default false,
  infusion_color_id text,
  custom_swatch_url text,
  uses_custom_design boolean default false,
  custom_design_url text,
  design_file_name text,
  render_urls jsonb default '{}'::jsonb,
  generation_status text default 'processing'::text,
  is_saved boolean default false,
  admin_notes text,
  emailed_at timestamp with time zone,
  mode_type text,
  has_360_spin boolean default false,
  spin_view_count integer default 0,
  is_featured_hero boolean default false,
  custom_styling_prompt_key text,
  source_photo_url text,
  tool_source text,
  shop_id uuid,
  show_on_quote_pdf boolean default false not null,
  lineage_root_id uuid,
  primary key (id)
);

create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  phone text,
  email text,
  name text,
  last_vehicle text,
  last_service text,
  last_contact_at timestamp with time zone default now(),
  total_inquiries integer default 0,
  total_quotes_sent integer default 0,
  total_booked integer default 0,
  lifetime_value numeric default 0,
  source text default 'manual'::text,
  shop_id uuid,
  notes text,
  metadata jsonb default '{}'::jsonb,
  is_test boolean default false not null,
  industry text,
  primary key (id)
);

create table if not exists public.design_generation_assets (
  id uuid default gen_random_uuid() not null,
  generation_id uuid not null,
  iteration_index integer default 0 not null,
  parent_asset_id uuid,
  is_current boolean default true not null,
  user_id uuid,
  shop_id uuid,
  organization_id uuid,
  source text default 'designpro'::text not null,
  background_url text,
  overlay_pngs jsonb default '[]'::jsonb not null,
  panel_zones jsonb default '[]'::jsonb not null,
  layer_manifest jsonb default '[]'::jsonb not null,
  proof_2d_url text,
  proof_3d_url text,
  view_urls jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  qc_status text default 'pending'::text not null,
  qc_stamped_by text,
  qc_stamped_at timestamp with time zone,
  source_prompt text,
  layer_layout jsonb default '[]'::jsonb,
  alternate_overlays jsonb default '[]'::jsonb not null,
  hero_scrubbed boolean,
  primary key (id)
);

create table if not exists public.design_pack_purchases (
  id uuid default gen_random_uuid() not null,
  email text not null,
  design_id uuid not null,
  purchase_type text not null,
  stripe_checkout_id text not null,
  download_url text,
  download_expires_at timestamp with time zone,
  downloaded_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  order_metadata jsonb,
  order_number text,
  customer_order_number text,
  user_id uuid,
  selected_size text,
  recommended_size text,
  size_was_overridden boolean default false,
  include_hood boolean default false,
  include_front_bumper boolean default false,
  include_rear_plus_bumper boolean default false,
  roof_size text,
  production_status text default 'pending_payment'::text,
  generation_started_at timestamp with time zone,
  generation_completed_at timestamp with time zone,
  qa_started_at timestamp with time zone,
  qa_completed_at timestamp with time zone,
  delivered_at timestamp with time zone,
  qa_attempts integer default 0,
  wrapbox_delivery_url text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  generation_id uuid,
  prompt_fingerprint text,
  design_equity_id text,
  primary key (id)
);

create table if not exists public.design_version_commits (
  id uuid default gen_random_uuid() not null,
  job_id text not null,
  version_number integer not null,
  user_id uuid,
  shop_id uuid,
  user_prompt text,
  system_prompt_snapshot text,
  master_artboard_url text,
  hero_render_url text,
  angle_renders_json jsonb default '[]'::jsonb not null,
  change_type text default 'generate'::text not null,
  created_at timestamp with time zone default now() not null,
  designiq_generation_id uuid,
  source_visualization_id uuid,
  revision_snapshot jsonb,
  revision_snapshot_hash text,
  frozen_at timestamp with time zone,
  workflow_run_id uuid,
  entice_pack_id uuid,
  entice_status text,
  primary key (id)
);

create table if not exists public.designiq_generations (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  user_email text,
  mode text not null,
  raw_prompt text not null,
  enhanced_prompt text,
  style_preset text,
  company_name text,
  mascot text,
  industry_type text,
  brand_keywords text[],
  finish text default 'Gloss'::text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  panel_url text,
  panel_id uuid,
  panel_mime_type text,
  hero_render_url text,
  render_urls jsonb default '{}'::jsonb,
  spin_urls jsonb default '[]'::jsonb,
  proof_pdf_url text,
  engine_version text default '1.1'::text,
  truespec_metadata jsonb default '{}'::jsonb,
  generation_status text default 'started'::text,
  error_message text,
  created_at timestamp with time zone default now(),
  panel_completed_at timestamp with time zone,
  render_completed_at timestamp with time zone,
  updated_at timestamp with time zone default now(),
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
  primary key (id)
);

create table if not exists public.designpro_entice_packs (
  id uuid default gen_random_uuid() not null,
  design_id text not null,
  designiq_generation_id uuid not null,
  source_visualization_id uuid not null,
  revision_id uuid not null,
  dimension_manifest_id uuid default gen_random_uuid() not null,
  user_id uuid,
  tenant_key text not null,
  trigger_key text not null,
  definition_version text default 'designpro.entice_pack.v2'::text not null,
  idempotency_key text not null,
  status text default 'building'::text not null,
  submission_hash text not null,
  canonical_input_hash text,
  dimension_basis_hash text,
  manifest_hash text,
  pack_identity_hash text,
  source_contract_hash text,
  surface_manifest jsonb default '{}'::jsonb not null,
  proof_artifact jsonb default '{}'::jsonb not null,
  panel_artifacts jsonb default '[]'::jsonb not null,
  logo_artifacts jsonb default '[]'::jsonb not null,
  pack_version text,
  workflow_run_id uuid,
  failure jsonb default '{}'::jsonb not null,
  verified_at timestamp with time zone,
  activated_at timestamp with time zone,
  superseded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.designpro_panel_manifests (
  id uuid default gen_random_uuid() not null,
  source_key text not null,
  source_url text not null,
  boxes jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.designpro_production_jobs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  panelizer_job_id text not null,
  generation_id text not null,
  order_number text not null,
  idempotency_key text not null,
  state text default 'queued'::text not null,
  stage text default 'created'::text not null,
  blocked jsonb default '[]'::jsonb not null,
  result jsonb,
  last_error text,
  attempts integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  revision_id uuid,
  entice_pack_id uuid,
  dimension_manifest_id uuid,
  source_contract_hash text,
  order_request_id uuid,
  primary key (id)
);

create table if not exists public.email_log (
  id uuid default gen_random_uuid() not null,
  quote_id uuid,
  customer_id uuid,
  shop_id uuid,
  email_type text,
  subject text,
  body text,
  recipient text,
  sent_at timestamp with time zone default now(),
  status text default 'sent'::text,
  metadata jsonb,
  resend_message_id text,
  delivered_at timestamp with time zone,
  opened_at timestamp with time zone,
  bounced_at timestamp with time zone,
  complained_at timestamp with time zone,
  last_event_type text,
  last_event_at timestamp with time zone,
  primary key (id)
);

create table if not exists public.email_templates (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  description text,
  subject text not null,
  html_content text default ''::text not null,
  text_content text,
  from_name text default 'RestylePro'::text,
  from_email text default 'onboarding@resend.dev'::text,
  merge_tags jsonb default '[]'::jsonb,
  category text default 'transactional'::text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by uuid,
  primary key (id)
);

create table if not exists public.extracted_elements (
  id uuid default gen_random_uuid() not null,
  render_id text,
  user_id uuid not null,
  element_type text not null,
  element_label text,
  transparent_png_url text not null,
  clean_background_url text not null,
  bounding_box jsonb not null,
  created_at timestamp with time zone default now() not null,
  reuse_count integer default 0 not null,
  shop_id uuid,
  primary key (id)
);

create table if not exists public.manufacturer_colors (
  id uuid default gen_random_uuid() not null,
  manufacturer text not null,
  series text,
  product_code text not null,
  official_name text not null,
  official_hex text,
  official_swatch_url text,
  lab_l numeric,
  lab_a numeric,
  lab_b numeric,
  finish text default 'Gloss'::text not null,
  is_ppf boolean default false,
  is_verified boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  hex_source text default 'ai_guessed'::text,
  hex_confidence integer default 0,
  registry_version text,
  source_file text,
  grounded_description text,
  grounded_base_color text,
  grounded_effect text,
  show_in_picker boolean default true not null,
  primary key (id)
);

create table if not exists public.moderation_log (
  id uuid default gen_random_uuid() not null,
  user_email text not null,
  blocked_term text not null,
  attempted_content text,
  ip_address text,
  created_at timestamp with time zone default now(),
  primary key (id)
);

create table if not exists public.panel_artboard_assets (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  kind text not null,
  label text,
  panel_label text,
  width_inches numeric,
  height_inches numeric,
  dpi integer,
  scale_pct numeric,
  box jsonb,
  storage_path text,
  url text not null,
  sort_order integer default 0,
  created_at timestamp with time zone default now() not null,
  qc jsonb,
  primary key (id)
);

create table if not exists public.panel_artboard_jobs (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  status text default 'running'::text not null,
  mode text,
  prompt text,
  reference_image_url text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  body_type text,
  finish text,
  bleed_inches numeric default 2,
  dims_source text,
  panels jsonb,
  error text,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  production_ctx jsonb,
  primary key (id)
);

create table if not exists public.panelizer_job_events (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  event_type text not null,
  stage text,
  data jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  primary key (id)
);

create table if not exists public.panelizer_jobs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  generation_id uuid,
  purchase_id uuid,
  order_number text,
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  approved_render_url text,
  all_view_urls jsonb default '[]'::jsonb,
  concept_json jsonb,
  status text default 'pending_payment'::text not null,
  current_stage integer default 0,
  stage_progress jsonb default '{}'::jsonb,
  panels jsonb default '[]'::jsonb,
  qa_results jsonb default '{}'::jsonb,
  qa_passed boolean,
  qa_issues_count integer default 0,
  qa_requires_input boolean default false,
  customer_inputs jsonb default '[]'::jsonb,
  extracted_elements jsonb default '[]'::jsonb,
  upsells_offered jsonb default '[]'::jsonb,
  upsells_purchased jsonb default '[]'::jsonb,
  upsell_revenue numeric default 0,
  zip_storage_path text,
  zip_signed_url text,
  zip_expires_at timestamp with time zone,
  delivered_at timestamp with time zone,
  delivery_email_sent boolean default false,
  processing_time_ms integer,
  error_message text,
  error_stage text,
  retry_count integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  job_type text default 'production_pack'::text,
  shop_id uuid,
  quote_id uuid,
  primary key (id)
);

create table if not exists public.print_production_requests (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  shop_id uuid,
  design_id text,
  panelizer_job_id uuid,
  order_number text,
  customer_name text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  approved_proof_url text,
  requested_output_type text default 'full_wrap_panels'::text,
  payment_status text default 'awaiting_payment'::text not null,
  amount_cents integer default 29900 not null,
  stripe_session_id text,
  production_status public.print_production_status default 'awaiting_payment'::public.print_production_status not null,
  due_date timestamp with time zone,
  final_files jsonb default '[]'::jsonb not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  revision_id uuid,
  entice_pack_id uuid,
  production_job_id uuid,
  workflow_run_id uuid,
  primary key (id)
);

create table if not exists public.production_actions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  action_type text default 'quick_prep'::text not null,
  job_id uuid,
  package_id text,
  package_name text,
  tokens_used integer default 0,
  file_in text,
  file_out text,
  file_name text,
  status text default 'pending'::text,
  steps_total integer default 0,
  steps_completed integer default 0,
  current_step text,
  before_after jsonb default '{}'::jsonb,
  step_results jsonb default '[]'::jsonb,
  options jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  service_id text,
  output_format text,
  rip_compatible text[],
  metrics jsonb,
  primary key (id)
);

create table if not exists public.production_flow_assets (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  side character varying not null,
  version text default 'v1'::character varying not null,
  dimensions_inches jsonb not null,
  background_url text not null,
  branding_url text not null,
  depth_mask_url text not null,
  final_pack_url text not null,
  is_passenger_flipped boolean default false,
  meta_metrics jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  revision_id uuid,
  entice_pack_id uuid,
  designiq_generation_id uuid,
  dimension_manifest_id uuid,
  manifest_hash text,
  source_contract_hash text,
  artifact_hash text,
  primary key (id)
);

create table if not exists public.production_notifications (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  job_id text,
  type text default 'info'::text not null,
  title text default ''::text not null,
  message text default ''::text not null,
  action_url text,
  read boolean default false not null,
  email_sent boolean default false not null,
  email_id text,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.production_packs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  generation_id uuid,
  panels_selected jsonb not null,
  total_price_cents integer default 0 not null,
  payment_status text default 'included'::text not null,
  pack_url text,
  file_count integer default 0,
  created_at timestamp with time zone default now() not null,
  visualization_id uuid,
  pipeline_version text default '4.0'::text,
  vehicle_info jsonb,
  design_name text,
  finish_type text default 'Gloss'::text,
  upscale_status text default 'pending'::text,
  upscale_progress text default '0/0'::text,
  thumbnail_url text,
  upscale_error text,
  size_validation jsonb,
  is_starred boolean default false,
  shop_id uuid,
  quote_id uuid,
  two_d_proof_url text,
  three_d_proof_url text,
  panel_proof_url text,
  manifest_json jsonb,
  wrapbox_status text,
  wrapbox_pushed_at timestamp with time zone,
  source text,
  primary key (id)
);

create table if not exists public.production_panel_dispatches (
  id uuid default gen_random_uuid() not null,
  workflow_run_id uuid not null,
  production_job_id uuid not null,
  panelizer_job_id uuid not null,
  source_hash text not null,
  pack_version text not null,
  run_key text not null,
  panel_key text not null,
  payload_hash text not null,
  status text default 'pending'::text not null,
  attempt integer default 0 not null,
  max_attempts integer default 3 not null,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  request_id bigint,
  available_at timestamp with time zone default now() not null,
  output jsonb default '{}'::jsonb not null,
  output_hash text,
  error text,
  dispatched_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.production_panels (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  render_id uuid not null,
  panel_name text,
  dimensions_summary text not null,
  mapping_payload jsonb not null,
  storage_path text,
  preview_path text,
  status text default 'queued'::text not null,
  user_id uuid default auth.uid(),
  operator_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.proof_approvals (
  id uuid default gen_random_uuid() not null,
  shop_id uuid not null,
  view_token text not null,
  manage_token text not null,
  customer_name text,
  customer_email text not null,
  customer_phone text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_type text,
  design_name text,
  finish_type text,
  source_visualization_id uuid,
  mode text not null,
  status text default 'draft'::text not null,
  expires_at timestamp with time zone,
  sent_at timestamp with time zone,
  viewed_at timestamp with time zone,
  signed_at timestamp with time zone,
  decline_reason text,
  change_request text,
  signature_storage_path text,
  signed_pdf_storage_path text,
  signed_pdf_sha256 text,
  signer_ip inet,
  signer_user_agent text,
  signer_typed_name text,
  ai_revisions_allowed integer default 0 not null,
  ai_revisions_used integer default 0 not null,
  white_label_logo_url text,
  message_to_customer text,
  internal_notes text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  has_line_items boolean default false not null,
  assigned_to uuid,
  assigned_at timestamp with time zone,
  assigned_by uuid,
  primary key (id)
);

create table if not exists public.proof_events (
  id uuid default gen_random_uuid() not null,
  proof_id uuid not null,
  event_type text not null,
  actor_role text,
  actor_user_id uuid,
  ip inet,
  user_agent text,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.proof_line_items (
  id uuid default gen_random_uuid() not null,
  proof_id uuid not null,
  line_number integer not null,
  title text not null,
  description text,
  render_url text,
  thumbnail_url text,
  uploaded_file_paths jsonb default '[]'::jsonb not null,
  status text default 'pending'::text not null,
  decline_reason text,
  change_request text,
  reference_image_paths jsonb default '[]'::jsonb not null,
  approved_at timestamp with time zone,
  declined_at timestamp with time zone,
  revision_requested_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.proof_versions (
  id uuid default gen_random_uuid() not null,
  proof_id uuid not null,
  version_number integer not null,
  created_by_role text not null,
  created_by_user_id uuid,
  render_urls jsonb default '{}'::jsonb not null,
  uploaded_file_paths jsonb default '[]'::jsonb not null,
  prompt_text text,
  reference_image_paths jsonb default '[]'::jsonb not null,
  ai_cost_estimate numeric default 0 not null,
  is_active boolean default false not null,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.quotes (
  id uuid default gen_random_uuid() not null,
  shop_id uuid,
  customer_id uuid,
  quote_number text not null,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  manufacturer text,
  finish text,
  color_name text,
  category text,
  tool_source text,
  sq_ft numeric,
  yards_needed numeric,
  shop_cost numeric,
  customer_total numeric,
  margin_percent numeric,
  status text default 'draft'::text,
  line_items jsonb,
  render_url text,
  visualization_id uuid,
  last_email_at timestamp with time zone,
  last_email_type text,
  metadata jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  is_test boolean default false not null,
  share_token uuid default gen_random_uuid() not null,
  order_id uuid,
  base_render_url text,
  precision_mod_renders jsonb default '[]'::jsonb not null,
  created_by uuid,
  primary key (id)
);

create table if not exists public.render_templates (
  id uuid default gen_random_uuid() not null,
  prompt_signature text not null,
  vehicle_signature text not null,
  source_visualization_id uuid,
  render_urls jsonb default '{}'::jsonb not null,
  is_golden_template boolean default true,
  rating integer default 5,
  use_count integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by text,
  primary key (id)
);

create table if not exists public.shop_members (
  id uuid default gen_random_uuid() not null,
  shop_id uuid not null,
  user_id uuid not null,
  role public.shop_member_role default 'member'::public.shop_member_role not null,
  invited_by uuid,
  invited_at timestamp with time zone,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);

create table if not exists public.shop_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  shop_name text,
  shop_logo_url text,
  phone text,
  website text,
  default_include_disclaimer boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  is_test boolean default false not null,
  custom_terms_text text,
  shop_voice text default 'formal'::text,
  onboarding_completed boolean default false,
  email text,
  stripe_account_id text,
  stripe_account_status text default 'not_connected'::text,
  stripe_charges_enabled boolean default false,
  stripe_payouts_enabled boolean default false,
  stripe_details_submitted boolean default false,
  stripe_connected_at timestamp with time zone,
  notification_emails text[] default '{}'::text[] not null,
  owner_name text,
  address text,
  sms_opt_in boolean default false not null,
  primary key (id)
);

create table if not exists public.shops (
  id uuid default gen_random_uuid() not null,
  franchise_id uuid,
  owner_user_id uuid not null,
  name text not null,
  slug text,
  logo_url text,
  phone text,
  website text,
  default_include_disclaimer boolean default false not null,
  seat_limit integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  logo_svg_url text,
  logo_eps_url text,
  logo_source text default 'upload'::text,
  logopro_project_id uuid,
  primary key (id)
);

create table if not exists public.user_roles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now(),
  primary key (id)
);

create table if not exists public.user_tokens (
  user_id uuid not null,
  balance integer default 0 not null,
  total_purchased integer default 0 not null,
  total_used integer default 0 not null,
  updated_at timestamp with time zone default now(),
  unlimited_revisions boolean default false not null,
  primary key (user_id)
);

create table if not exists public.vehicle_dimensions (
  id uuid default gen_random_uuid() not null,
  make text not null,
  model text not null,
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
  created_at timestamp with time zone default now(),
  overall_length numeric,
  primary key (id)
);

create table if not exists public.vehicle_renders (
  id uuid default gen_random_uuid() not null,
  vehicle_year text not null,
  vehicle_make text not null,
  vehicle_model text not null,
  mode_type text not null,
  render_url text not null,
  color_data jsonb not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  quality_verified boolean default false,
  reference_count integer default 0,
  is_canonical_demo boolean default false,
  primary key (id)
);

create table if not exists public.vinyl_reference_images (
  id uuid default gen_random_uuid() not null,
  swatch_id uuid,
  manufacturer text not null,
  color_name text not null,
  product_code text,
  image_url text not null,
  source_url text,
  image_type text default 'vehicle_installation'::text,
  is_verified boolean default false,
  verified_at timestamp with time zone,
  color_characteristics jsonb,
  search_query text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  score double precision,
  primary key (id)
);

create table if not exists public.vinyl_swatches (
  id uuid default gen_random_uuid() not null,
  manufacturer text not null,
  series text,
  name text not null,
  code text,
  finish text not null,
  material_type text,
  hex text not null,
  metallic boolean default false,
  flake_level text,
  pearl boolean default false,
  chrome boolean default false,
  ppf boolean default false,
  media_url text,
  media_type text,
  ai_confidence numeric,
  verified boolean default true,
  created_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  color_type text,
  popularity_score integer default 0,
  search_count integer default 0,
  last_verified_at timestamp with time zone default now(),
  source text default 'seeded'::text,
  has_reference_bundle boolean default false,
  is_flip_film boolean default false,
  needs_reference_review boolean default false,
  reference_image_count integer default 0,
  lab jsonb,
  reflectivity double precision,
  metallic_flake double precision,
  finish_profile jsonb,
  material_validated boolean default false,
  primary key (id)
);

create table if not exists public.workflow_stage_runs (
  id uuid default gen_random_uuid() not null,
  run_id uuid not null,
  stage_key text not null,
  scope_key text default ''::text not null,
  sequence integer default 0 not null,
  status text default 'pending'::text not null,
  idempotency_key text not null,
  input_hash text,
  output_hash text,
  input jsonb default '{}'::jsonb not null,
  output jsonb default '{}'::jsonb not null,
  verification jsonb default '{}'::jsonb not null,
  attempt integer default 0 not null,
  max_attempts integer default 3 not null,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  error_code text,
  error_message text,
  error_details jsonb default '{}'::jsonb not null,
  available_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  wait_reason text,
  wait_details jsonb default '{}'::jsonb not null,
  deferred_count integer default 0 not null,
  primary key (id)
);

create table if not exists public.workforce_runs (
  id uuid default gen_random_uuid() not null,
  mode text default 'sweep'::text not null,
  dry_run boolean default false not null,
  sends_enabled boolean default false not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  results jsonb default '{}'::jsonb not null,
  error text,
  created_at timestamp with time zone default now() not null,
  workflow_type text,
  tenant_key text,
  domain_job_type text,
  domain_job_id uuid,
  workflow_status text,
  idempotency_key text,
  requested_by uuid,
  input_hash text,
  cancel_requested_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);

-- No table is exposed through the public API surface: RLS on, no anon or
-- authenticated policies. The chain's edge functions use the service role,
-- which bypasses RLS -- identical to how they ran on the source project.
do $$
declare t text;
begin
  foreach t in array array[
    'blocked_users','color_visualizations','customers','design_generation_assets',
    'design_pack_purchases','design_version_commits','designiq_generations',
    'designpro_entice_packs','designpro_panel_manifests','designpro_production_jobs',
    'email_log','email_templates','extracted_elements','manufacturer_colors',
    'moderation_log','panel_artboard_assets','panel_artboard_jobs',
    'panelizer_job_events','panelizer_jobs','print_production_requests',
    'production_actions','production_flow_assets','production_notifications',
    'production_packs','production_panel_dispatches','production_panels',
    'proof_approvals','proof_events','proof_line_items','proof_versions','quotes',
    'render_templates','shop_members','shop_profiles','shops','user_roles',
    'user_tokens','vehicle_dimensions','vehicle_renders','vinyl_reference_images',
    'vinyl_swatches','workflow_stage_runs','workforce_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- The unique keys the chain's UPSERTs and idempotency depend on, captured from
-- the live production database -- not invented. Without these the copied
-- functions' on_conflict targets error instead of merging, and duplicate
-- workflow rows land where one was fenced.
create unique index if not exists design_generation_assets_gen_iter_uniq
  on public.design_generation_assets (generation_id, iteration_index);
create unique index if not exists designpro_entice_packs_idempotency_unique
  on public.designpro_entice_packs (tenant_key, idempotency_key);
create unique index if not exists designpro_entice_packs_revision_definition_unique
  on public.designpro_entice_packs (revision_id, definition_version);
create unique index if not exists designpro_entice_packs_workflow_run_id_key
  on public.designpro_entice_packs (workflow_run_id);
create unique index if not exists uq_designpro_entice_packs_active_design
  on public.designpro_entice_packs (design_id) where (status = 'active'::text);
create unique index if not exists uq_designpro_entice_packs_saved_source
  on public.designpro_entice_packs (tenant_key, design_id, source_visualization_id, submission_hash, definition_version)
  where (source_visualization_id is not null);
create unique index if not exists designpro_panel_manifests_source_key_key
  on public.designpro_panel_manifests (source_key);
create unique index if not exists designpro_production_jobs_user_id_idempotency_key_key
  on public.designpro_production_jobs (user_id, idempotency_key);
create unique index if not exists uq_production_flow_assets_entice_pack_side
  on public.production_flow_assets (entice_pack_id, upper(btrim((side)::text)))
  where (entice_pack_id is not null);
create unique index if not exists production_panel_dispatches_production_job_id_source_hash_p_key
  on public.production_panel_dispatches (production_job_id, source_hash, pack_version, run_key, panel_key);
create unique index if not exists uniq_proof_versions_active_per_proof
  on public.proof_versions (proof_id) where (is_active = true);
create unique index if not exists uniq_proof_versions_number_per_proof
  on public.proof_versions (proof_id, version_number);
create unique index if not exists user_roles_user_id_role_key
  on public.user_roles (user_id, role);
create unique index if not exists workflow_stage_runs_idempotency
  on public.workflow_stage_runs (run_id, idempotency_key);
create unique index if not exists workflow_stage_runs_logical_key
  on public.workflow_stage_runs (run_id, stage_key, scope_key);
