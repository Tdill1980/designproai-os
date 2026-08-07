-- Standalone DesignProAI OS: durable workflow schema.
-- This migration intentionally depends only on auth.users and its own objects.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Declared before workflow RPCs because Call 10 verifies against this immutable
-- DesignPro-owned source, never a legacy/shared table.
CREATE TABLE IF NOT EXISTS public.designpro_revision_sources (
  revision_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (btrim(tenant_key)<>''),
  generation_id uuid NOT NULL,
  visualization_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_revision_snapshot_contract CHECK (
    snapshot->>'contractVersion'='designpro.revision-snapshot.v1'
    AND NULLIF(btrim(snapshot->>'designId'),'') IS NOT NULL
    AND snapshot->>'visualizationId'=visualization_id::text
    AND jsonb_typeof(snapshot->'renderUrls')='object' AND snapshot->'renderUrls'<>'{}'::jsonb
    AND NULLIF(btrim(snapshot#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,type}'),'') IS NOT NULL
    AND jsonb_typeof(snapshot->'surfaceOptions')='object'
    AND snapshot ? 'finish' AND snapshot ? 'bodyText'
    AND jsonb_typeof(snapshot->'change')='object'
    AND jsonb_typeof(snapshot->'expectedLogoInventory')='array'
    AND (NOT snapshot ? 'materialFingerprints' OR jsonb_typeof(snapshot->'materialFingerprints') IN ('object','array'))
  )
);

CREATE TABLE IF NOT EXISTS public.designpro_workflow_runs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  workflow_type text NOT NULL CHECK (workflow_type IN ('designpro.entice_pack','designpro.production_pack')),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (btrim(tenant_key) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  definition_version text NOT NULL DEFAULT 'designpro.os.v1',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','approval_required','failed','completed','cancelled')),
  revision_id uuid NOT NULL,
  entice_pack_id uuid NOT NULL,
  dimension_manifest_id uuid NOT NULL,
  source_contract_hash text NOT NULL CHECK (source_contract_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  artifact_set_hash text NOT NULL CHECK (artifact_set_hash ~ '^[0-9a-f]{64}$'),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (tenant_key, workflow_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.designpro_workflow_stages (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.designpro_workflow_runs(id) ON DELETE CASCADE,
  stage_key text NOT NULL CHECK (stage_key IN (
    'revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','pack.verify','pack.activate',
    'source.verify','await_panelpro_preflight_qc','output.build','output.verify','await_final_human_qc',
    'stamp.build','zip.build','wrapbox.deliver'
  )),
  sequence integer NOT NULL CHECK (sequence >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','retryable','waiting','completed','failed','skipped','cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_hash text CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  wait_reason text,
  wait_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (run_id, stage_key),
  UNIQUE (run_id, sequence),
  CONSTRAINT designpro_stage_lease_integrity CHECK (
    status <> 'running' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT designpro_stage_completion_integrity CHECK (
    status <> 'completed' OR (completed_at IS NOT NULL AND verification @> '{"verified":true}'::jsonb)
  )
);

CREATE TABLE IF NOT EXISTS public.designpro_stage_receipts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.designpro_workflow_runs(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.designpro_workflow_stages(id) ON DELETE CASCADE,
  receipt_kind text NOT NULL CHECK (receipt_kind IN (
    'views.seven-source','call8.flat-proof','call9.surface-panels','call10.logo-inventory','panelpro.preflight',
    'output.verified','final.human-qc','stamp','zip','wrapbox.delivery'
  )),
  identity jsonb NOT NULL,
  receipt jsonb NOT NULL,
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id),
  UNIQUE (run_id, receipt_kind, receipt_hash)
);

CREATE TABLE IF NOT EXISTS public.designpro_artifacts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.designpro_workflow_runs(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.designpro_workflow_stages(id) ON DELETE RESTRICT,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('flat-proof','panel','logo','output','stamp','zip','wrapbox-manifest')),
  surface_key text NOT NULL DEFAULT '',
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, artifact_kind, surface_key, content_hash)
);

CREATE INDEX IF NOT EXISTS designpro_runs_owner_created_idx ON public.designpro_workflow_runs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS designpro_stages_claim_idx ON public.designpro_workflow_stages(status, available_at, sequence);
CREATE INDEX IF NOT EXISTS designpro_stages_run_sequence_idx ON public.designpro_workflow_stages(run_id, sequence);
CREATE INDEX IF NOT EXISTS designpro_artifacts_run_kind_idx ON public.designpro_artifacts(run_id, artifact_kind);

ALTER TABLE public.designpro_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_stage_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designpro_owner_read_runs ON public.designpro_workflow_runs;
CREATE POLICY designpro_owner_read_runs ON public.designpro_workflow_runs FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS designpro_owner_read_stages ON public.designpro_workflow_stages;
CREATE POLICY designpro_owner_read_stages ON public.designpro_workflow_stages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.designpro_workflow_runs r WHERE r.id = run_id AND r.owner_id = auth.uid()));
DROP POLICY IF EXISTS designpro_owner_read_receipts ON public.designpro_stage_receipts;
CREATE POLICY designpro_owner_read_receipts ON public.designpro_stage_receipts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.designpro_workflow_runs r WHERE r.id = run_id AND r.owner_id = auth.uid()));
DROP POLICY IF EXISTS designpro_owner_read_artifacts ON public.designpro_artifacts;
CREATE POLICY designpro_owner_read_artifacts ON public.designpro_artifacts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.designpro_workflow_runs r WHERE r.id = run_id AND r.owner_id = auth.uid()));

REVOKE ALL ON public.designpro_workflow_runs, public.designpro_workflow_stages, public.designpro_stage_receipts, public.designpro_artifacts FROM PUBLIC, anon;
GRANT SELECT ON public.designpro_workflow_runs, public.designpro_workflow_stages, public.designpro_stage_receipts, public.designpro_artifacts TO authenticated;
GRANT ALL ON public.designpro_workflow_runs, public.designpro_workflow_stages, public.designpro_stage_receipts, public.designpro_artifacts TO service_role;
