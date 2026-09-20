-- Customer-visible Call 1 is the deterministic composed three-zone proof.
-- Raw Gemini artwork staging canvases are internal and may never be signed or
-- surfaced as Production Panel Proofs.
CREATE OR REPLACE FUNCTION designpro_private.caller_may_sign_panel_proof_object(p_object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.designpro_flat_atlas_revisions r
    WHERE (r.owner_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff()
      OR COALESCE(auth.jwt()->>'role','') = 'service_role')
      AND r.metadata ? 'panelProofAuthoring'
      AND (r.metadata->'panelProofAuthoring'->>'proofStoragePath' = p_object_name
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
          COALESCE(r.metadata->'panelProofAuthoring'->'quadrants'->'clean','[]'::jsonb)
          || COALESCE(r.metadata->'panelProofAuthoring'->'quadrants'->'cutGraphics','[]'::jsonb)) panel
          WHERE panel->>'storagePath' = p_object_name))
  ) OR EXISTS (
    SELECT 1 FROM public.designpro_atlas_call1_runs g
    JOIN public.designpro_generation_requests q ON q.id=g.request_id AND q.owner_id=g.owner_id
    JOIN public.designpro_atlas_call1_nodes n ON n.run_id=g.id
    WHERE (q.owner_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff()
      OR COALESCE(auth.jwt()->>'role','') = 'service_role')
      AND n.node_key='proof.assemble' AND n.state='completed' AND n.completed_at IS NOT NULL
      AND n.output_hash ~ '^[a-f0-9]{64}$'
      AND designpro_private.panel_proof_is_composed(n.output->'provenance')
      AND (n.output->'provenance'->>'proofStoragePath' = p_object_name
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
          (n.output->'provenance'->'quadrants'->'clean')
          || (n.output->'provenance'->'quadrants'->'cutGraphics')) panel
          WHERE panel->>'storagePath' = p_object_name))
  );
$fn$;
REVOKE ALL ON FUNCTION designpro_private.caller_may_sign_panel_proof_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION designpro_private.caller_may_sign_panel_proof_object(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.designpro_atlas_panel_proof_paths(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE;
  v_proof jsonb; v_graph_id uuid; v_master_hash text; v_source text;
BEGIN
  SELECT * INTO v_request FROM public.designpro_generation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
    AND NOT designpro_private.caller_is_design_staff()
  THEN RETURN NULL; END IF;

  SELECT * INTO v_atlas FROM public.designpro_flat_atlas_revisions
    WHERE request_id=v_request.id ORDER BY revision_sequence DESC LIMIT 1;
  IF v_atlas.id IS NOT NULL THEN
    v_proof := v_atlas.metadata->'panelProofAuthoring';
    v_master_hash := v_atlas.master_content_hash;
    v_source := 'atlas_revision';
  ELSE
    SELECT id INTO v_graph_id FROM public.designpro_atlas_call1_runs
      WHERE request_id=v_request.id AND owner_id=v_request.owner_id
      ORDER BY created_at DESC, id DESC LIMIT 1;
    SELECT n.output->'provenance', n.output->'master'->>'contentHash'
      INTO v_proof, v_master_hash FROM public.designpro_atlas_call1_nodes n
      WHERE n.run_id=v_graph_id AND n.node_key='proof.assemble'
        AND n.state='completed' AND n.completed_at IS NOT NULL
        AND n.output_hash ~ '^[a-f0-9]{64}$'
        AND designpro_private.panel_proof_is_composed(n.output->'provenance');
    IF v_proof IS NOT NULL AND v_proof <> 'null'::jsonb THEN v_source := 'call1_graph'; END IF;
  END IF;

  IF v_proof IS NULL OR v_proof='null'::jsonb THEN
    RETURN jsonb_build_object('requestId',v_request.id,'revisionId',v_atlas.id,'panelProof',false);
  END IF;
  RETURN jsonb_build_object(
    'requestId',v_request.id,'revisionId',v_atlas.id,'revisionSequence',v_atlas.revision_sequence,
    'panelProof',true,'source',v_source,'graphRunId',v_graph_id,
    'contract',v_proof->>'contract','topology',v_proof->>'topology','promptVersion',v_proof->>'promptVersion',
    'masterContentHash',v_master_hash,
    'sheet',jsonb_build_object('storagePath',v_proof->>'proofStoragePath',
      'contentHash',v_proof->>'proofSha256','contract',v_proof->>'proofContract','geometry',v_proof->'sheet'),
    'quadrants',v_proof->'quadrants');
END;
$fn$;
REVOKE ALL ON FUNCTION public.designpro_atlas_panel_proof_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_atlas_panel_proof_paths(uuid) TO authenticated, service_role;
