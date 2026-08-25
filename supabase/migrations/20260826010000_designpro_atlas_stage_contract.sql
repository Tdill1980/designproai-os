-- A.T.L.A.S. RUNS REACH MANUFACTURING. THE STAGE CONTRACT NOW KNOWS THEY EXIST.
--
-- OWNER-APPROVED SEAM CHANGE (Trish, 2026-08-25). RULE 0.5 freezes the
-- generation/manufacturing seam. This is the owner decision that changes it,
-- and the reason is that the two halves of the seam disagreed with each other:
-- the runtime was taught the A.T.L.A.S. manufacturing path, and this function
-- was not, so every A.T.L.A.S. run died on the second stage.
--
-- WHAT WAS MEASURED, NOT INFERRED. Generation 02e83eb3 (request d57e29dc)
-- produced a complete, accepted A.T.L.A.S. design on 2026-08-25 21:12. Its
-- entice_pack run 9923b2de then did this, five seconds after starting:
--
--     seq  stage             status     error
--       0  revision.freeze   completed  --
--      10  proof.build       FAILED     stage_completion_rejected /
--                                       verified_receipt_required
--      20  panels.build      pending    never ran
--      30  logos.extract     pending    never ran
--      40  panels.delogo     pending    never ran
--      50  pack.verify       pending    never ran
--      60  pack.activate     pending    never ran
--
-- Database-wide at that moment: designpro_artifacts held 15 rows, all dated
-- 2026-08-18; designpro_surface_qc held 0 rows, ever; designpro_production_jobs
-- held 0 rows; designpro_design_master_revisions held 0 rows; and 12 of 14
-- entice_pack runs had failed. PanelPro Studio was not missing fields. It was
-- faithfully rendering an empty run, because the back half had not produced a
-- single artifact in a week.
--
-- THE TWO CONTRADICTIONS, BOTH CLOSED HERE.
--
-- 1. proof.build. The runtime records a Call 8 failure as a DEFERRAL and
--    continues, because A.T.L.A.S. is the production authority: the six panels
--    were cut from the accepted master at Call 1 and are bound to its hash, and
--    the 2D Production Proof is a later document the customer signs. This
--    function rejected any receipt whose verified was not exactly true, so the
--    deferral became a hard failure. That is the observed death above.
--
-- 2. panels.build. Fixing only (1) moves the death one stage down. The
--    proof-region contract derives every panel from the Call 8 proof and its
--    GENIE manifest, and hard-requires a call8.flat-proof receipt bound to that
--    manifest -- which a deferral never writes. An A.T.L.A.S. promotion could
--    never satisfy it. So it gets its own branch, asserting the identity that
--    actually governs it.
--
-- THIS IS NOT A SOFT GATE. The receipt hash is still required on every path.
-- Every other stage, and every non-A.T.L.A.S. workflow, still requires
-- verified=true exactly as before. The deferral must prove all of: the stage is
-- proof.build; the run is A.T.L.A.S. by its own immutable revision snapshot; an
-- accepted A.T.L.A.S. revision exists for that generation whose master QC
-- passed under the semantic-QC contract with a real master hash; the receipt
-- explicitly carries deferred=true; productionAuthority is atlas-master; and a
-- real failure code AND message are recorded. Any one of those missing and the
-- receipt is refused exactly as today.
--
-- The A.T.L.A.S. panels.build branch is stricter than what it replaces, not
-- looser: exactly the six canonical surfaces, six distinct sha256 hashes, each
-- equal to the Call 1 panel recorded on the frozen revision snapshot, each with
-- a panel artifact carrying that same hash, the accepted master as its source
-- and the five-inch bleed. None of that can be fabricated by the run.
--
-- Nothing else in this function moves: revision.freeze, logos.extract,
-- output.verify, pack.verify, pack.activate, stamp.build, zip.build,
-- wrapbox.deliver, source.verify and every artifact-ledger assertion are
-- reproduced verbatim.

CREATE OR REPLACE FUNCTION designpro_private.workflow_run_is_atlas(
  p_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $function$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_snapshot jsonb;
  v_generation uuid;
BEGIN
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- The immutable revision snapshot is the only interface this side of the
  -- seam may read. A run is A.T.L.A.S. because Call 1 recorded six canonical
  -- panels on it -- not because a receipt says so.
  SELECT snapshot, generation_id INTO v_snapshot, v_generation
  FROM public.designpro_revision_sources
  WHERE revision_id=v_run.revision_id
    AND snapshot_hash=v_run.revision_snapshot_hash;
  IF v_snapshot IS NULL OR v_generation IS NULL THEN RETURN false; END IF;

  IF pg_catalog.jsonb_typeof(v_snapshot->'callOnePanels')<>'array'
    OR pg_catalog.jsonb_array_length(v_snapshot->'callOnePanels')<>6
    OR EXISTS(
      SELECT 1
      FROM pg_catalog.unnest(ARRAY['driver','passenger','hood','roof','front','rear']) surface_key
      WHERE NOT EXISTS(
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_snapshot->'callOnePanels') c
        WHERE c->>'surfaceKey'=surface_key
          AND pg_catalog.lower(c->>'contentHash') ~ '^[0-9a-f]{64}$'))
  THEN RETURN false; END IF;

  -- ...and because an accepted master actually exists behind it, whose design
  -- QC passed. A snapshot alone would let a run claim A.T.L.A.S. authority
  -- without one.
  RETURN EXISTS(
    SELECT 1 FROM public.designpro_flat_atlas_revisions a
    WHERE a.generation_id=v_generation
      AND a.metadata->'masterQcPassed'='true'::jsonb
      AND a.metadata->>'masterQcContract'='designpro.atlas-master-semantic-qc.v1'
      AND pg_catalog.lower(a.master_content_hash) ~ '^[0-9a-f]{64}$'
  );
END;
$function$;

REVOKE ALL ON FUNCTION designpro_private.workflow_run_is_atlas(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.complete_designpro_stage(
  p_stage_id uuid,p_lease_token uuid,p_identity jsonb,p_receipt jsonb,p_receipt_hash text,p_artifacts jsonb DEFAULT '[]'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_kind text; v_art jsonb; v_views jsonb; v_manifest jsonb; v_snapshot jsonb; v_call9 jsonb;
DECLARE v_atlas boolean; v_deferred_call8 boolean; v_atlas_master text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=v_stage.run_id FOR UPDATE;
  IF p_identity->>'workflowRunId' IS DISTINCT FROM v_run.id::text OR p_identity->>'revisionId' IS DISTINCT FROM v_run.revision_id::text OR p_identity->>'enticePackId' IS DISTINCT FROM v_run.entice_pack_id::text OR p_identity->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text OR lower(p_identity->>'sourceContractHash') IS DISTINCT FROM v_run.source_contract_hash OR lower(p_identity->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash OR lower(p_identity->>'artifactSetHash') IS DISTINCT FROM v_run.artifact_set_hash THEN RAISE EXCEPTION 'workflow_identity_drift'; END IF;
  -- A.T.L.A.S. IS THE PRODUCTION AUTHORITY, SO CALL 8 IS NOT A GATE.
  --
  -- The runtime already knows this: on a run whose panels were cut from an
  -- accepted A.T.L.A.S. master, a Call 8 failure is RECORDED and the stage
  -- completes as deferred, because the 2D Production Proof is a later value-add
  -- document and the panels are already bound to that master's hash.
  --
  -- This function did not know it. It rejected every receipt whose 'verified'
  -- was not exactly true, so the runtime's deferral was turned into a hard
  -- stage failure and the run stopped. Live: run 9923b2de, 2026-08-25 21:15:49,
  -- proof.build failed stage_completion_rejected / verified_receipt_required,
  -- leaving panels.build, logos.extract, panels.delogo, pack.verify and
  -- pack.activate pending forever. That is why no panel, logo, pack, order
  -- number, QC row or artifact has existed since 2026-08-18, and why PanelPro
  -- Studio has looked empty even on a generation that succeeded.
  --
  -- The exception is deliberately the narrowest thing that unblocks it. It is
  -- NOT a soft gate: the receipt hash is still required, every other stage and
  -- every non-A.T.L.A.S. workflow still requires verified=true, and the
  -- deferral itself must prove it is what it claims to be -- an A.T.L.A.S. run,
  -- an explicit deferral, atlas-master authority, and a real recorded reason.
  v_atlas := designpro_private.workflow_run_is_atlas(v_run.id);
  v_deferred_call8 :=
    v_stage.stage_key='proof.build'
    AND v_atlas
    AND p_receipt->'deferred'='true'::jsonb
    AND p_receipt->>'productionAuthority'='atlas-master'
    AND NULLIF(btrim(COALESCE(p_receipt#>>'{failure,code}','')),'') IS NOT NULL
    AND NULLIF(btrim(COALESCE(p_receipt#>>'{failure,message}','')),'') IS NOT NULL;
  IF (
    COALESCE((p_receipt->>'verified')::boolean,false) IS DISTINCT FROM true
    AND NOT v_deferred_call8
  ) OR lower(p_receipt_hash) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'verified_receipt_required'; END IF;
  IF v_stage.stage_key='revision.freeze' THEN
    v_kind:='views.seven-source';
    IF jsonb_typeof(p_receipt->'viewReceipts')<>'array' OR jsonb_array_length(p_receipt->'viewReceipts')<>7
      OR (SELECT count(DISTINCT v->>'viewKey') FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR (SELECT count(DISTINCT lower(v->>'contentHash')) FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE NULLIF(btrim(v->>'viewKey'),'') IS NULL OR lower(v->>'contentHash')!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear','hero3d']) required(view_key)
        WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE v->>'viewKey'=required.view_key))
    THEN RAISE EXCEPTION 'seven_distinct_source_views_required'; END IF;
  ELSIF v_stage.stage_key='proof.build' AND v_deferred_call8 THEN
    -- A deferral is recorded as its own kind. Storing it as 'call8.flat-proof'
    -- would let panels.build's proof-region contract read a proof that was
    -- never built, which is the opposite of honest.
    v_kind:='call8.flat-proof-deferred';
  ELSIF v_stage.stage_key='proof.build' THEN
    v_kind:='call8.flat-proof';
    SELECT receipt INTO v_views FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='views.seven-source';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>8 OR p_receipt->>'proofKind'<>'flattened-2d-proof' OR p_receipt->>'dimensionsAuthority'<>'genie-universal-panelizer' OR (p_receipt->>'bleedInches')::numeric<>5 OR lower(p_receipt->>'sourceProofHash') !~ '^[0-9a-f]{64}$'
      OR v_views IS NULL OR jsonb_typeof(p_receipt->'viewLineage')<>'array' OR jsonb_array_length(p_receipt->'viewLineage')<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views->'viewReceipts') s WHERE NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'viewLineage') l
        WHERE l->>'viewKey'=s->>'viewKey' AND lower(l->>'contentHash')=lower(s->>'contentHash')))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
    THEN RAISE EXCEPTION 'call8_flat_proof_contract_failed'; END IF;
  ELSIF v_stage.stage_key='panels.build'
    AND v_atlas AND p_receipt->>'promotedFrom'='atlas-call1' THEN
    -- CALL 1 ALREADY CUT THESE PANELS; CALL 9 PROMOTES THOSE EXACT BYTES.
    --
    -- WHY THE call8.flat-proof PREREQUISITE IS RETIRED HERE, AND ONLY HERE.
    -- The branch below derives every panel from the Call 8 proof and its GENIE
    -- manifest, and hard-requires a call8.flat-proof receipt bound to that
    -- manifest. On an A.T.L.A.S. run that prerequisite is not merely absent, it
    -- is FORBIDDEN to exist at this point:
    --
    --   * RULE 0.20 -- Call 1 IS the design generation. It authors the master
    --     and cuts the six panels from it. The panels precede the proof.
    --   * RULE 0.19 -- GENIE (manifest.resolve) sits AFTER the purchase gate.
    --     The free entice run has, and must have, NO validated production
    --     manifest. Measured on run 9923b2de: dimension_manifest_id NULL,
    --     manifest_hash NULL, results->'dimensionManifest' absent, while its
    --     frozen snapshot carried all six callOnePanels. Requiring a manifest
    --     here would re-create the sixteen-hour park RULE 0.19 removed.
    --   * RULE 0.25 -- Calls 9+ are manufacturing only. Cutting panels from a
    --     proof at this stage would make the proof a second design producer.
    --
    -- WHAT REPLACES IT is the server-owned A.T.L.A.S. evidence that does exist,
    -- and it is stricter than what it replaces because none of it can be
    -- fabricated by the run: the accepted master's own hash, the immutable
    -- revision snapshot, and the design-time geometry Call 1 stamped on each
    -- panel. Every promoted hash must equal the Call 1 panel recorded on that
    -- frozen snapshot, every panel artifact must carry that same hash and name
    -- the accepted master as its source, and the per-surface trim/print inches,
    -- square footage and five-inch bleed must match the snapshot exactly.
    --
    -- Legacy and proof-derived runs are untouched: they fall through to the
    -- branch below and still require their call8.flat-proof receipt.
    v_kind:='call9.surface-panels';
    SELECT snapshot INTO v_snapshot FROM public.designpro_revision_sources
      WHERE revision_id=v_run.revision_id AND snapshot_hash=v_run.revision_snapshot_hash;
    SELECT a.master_content_hash INTO v_atlas_master
    FROM public.designpro_flat_atlas_revisions a
    JOIN public.designpro_revision_sources s ON s.generation_id=a.generation_id
    WHERE s.revision_id=v_run.revision_id AND s.snapshot_hash=v_run.revision_snapshot_hash
      AND a.metadata->'masterQcPassed'='true'::jsonb
      AND a.metadata->>'masterQcContract'='designpro.atlas-master-semantic-qc.v1'
    ORDER BY a.revision_sequence DESC LIMIT 1;
    IF (p_receipt->>'call')::int<>9
      OR p_receipt->>'panelSourceRule' IS DISTINCT FROM 'one-own-surface-region-per-output-side'
      OR v_snapshot IS NULL OR v_atlas_master IS NULL
      OR jsonb_typeof(p_receipt->'panelHashes')<>'object'
      OR jsonb_typeof(p_receipt->'panels')<>'array'
      OR jsonb_array_length(p_receipt->'panels')<>6
      OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'panelHashes'))<>6
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_each_text(p_receipt->'panelHashes'))<>6
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      -- the six canonical surfaces, no more and no fewer
      OR jsonb_typeof(v_snapshot->'callOnePanels')<>'array'
      OR jsonb_array_length(v_snapshot->'callOnePanels')<>6
      OR EXISTS(
        SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) surface_key
        WHERE NOT (p_receipt->'panelHashes' ? surface_key)
          -- the promoted hash IS the Call 1 panel on the frozen snapshot, and
          -- that panel is itself bound to the accepted master
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'callOnePanels') c
            WHERE c->>'surfaceKey'=surface_key
              AND lower(c->>'contentHash')=lower(p_receipt#>>ARRAY['panelHashes',surface_key])
              AND lower(c->>'sourceMasterHash')=lower(v_atlas_master)
              AND c->>'contract'='designpro.flat-first-atlas-call1-panel.v1'
              AND (c->>'bleedInches')::numeric=5
              AND (c->>'trimWidthIn')::numeric>0 AND (c->>'trimHeightIn')::numeric>0
              AND (c->>'printWidthIn')::numeric>0 AND (c->>'printHeightIn')::numeric>0
              AND (c->>'surfaceSqFt')::numeric>0)
          -- the receipt reports that surface's geometry exactly as Call 1 cut it
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'panels') r
            JOIN LATERAL jsonb_array_elements(v_snapshot->'callOnePanels') c
              ON c->>'surfaceKey'=r->>'surfaceKey'
            WHERE r->>'surfaceKey'=surface_key
              AND lower(r->>'contentHash')=lower(c->>'contentHash')
              AND (r->>'trimWidthIn')::numeric=(c->>'trimWidthIn')::numeric
              AND (r->>'trimHeightIn')::numeric=(c->>'trimHeightIn')::numeric
              AND (r->>'printWidthIn')::numeric=(c->>'printWidthIn')::numeric
              AND (r->>'printHeightIn')::numeric=(c->>'printHeightIn')::numeric
              AND (r->>'surfaceSqFt')::numeric=(c->>'surfaceSqFt')::numeric
              AND (r->>'bleedInches')::numeric=5)
          -- and a panel artifact carries that hash, the master, and the bleed
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
            WHERE a->>'kind'='panel' AND a->>'surfaceKey'=surface_key
              AND lower(a->>'contentHash')=lower(p_receipt#>>ARRAY['panelHashes',surface_key])
              AND lower(a#>>'{metadata,sourceMasterHash}')=lower(v_atlas_master)
              AND (a#>>'{metadata,bleedInches}')::numeric=5))
      -- design-time geometry may never masquerade as validated production
      -- geometry: that is what the purchase-gated GENIE resolve is for.
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'callOnePanels') c
        WHERE c->>'geometryPurpose' IS DISTINCT FROM 'calls-1-7-layout-only')
    THEN RAISE EXCEPTION 'call9_atlas_panel_promotion_contract_failed'; END IF;
  ELSIF v_stage.stage_key='panels.build' THEN
    v_kind:='call9.surface-panels';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>9 OR p_receipt->>'sourceRule'<>'one-own-surface-region-per-output-side' OR (p_receipt->>'bleedInches')::numeric<>5 OR jsonb_typeof(p_receipt->'sides')<>'array' OR jsonb_array_length(p_receipt->'sides')<2 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_receipt->'sides'))<>jsonb_array_length(p_receipt->'sides') OR jsonb_typeof(p_receipt->'panelHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'panelHashes'))<>jsonb_array_length(p_receipt->'sides') OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR jsonb_typeof(p_receipt->'sourceRegionHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_each_text(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') d CROSS JOIN jsonb_each_text(p_receipt->'sourceRegionHashes') p
        WHERE lower(d.key) LIKE '%driver%' AND lower(p.key) LIKE '%passenger%' AND lower(d.value)=lower(p.value))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
      OR jsonb_typeof(p_receipt->'trimDimensions')<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_manifest->'expectedSurfaces') s WHERE
        NOT (p_receipt->'sides' @> jsonb_build_array(s->>'surfaceKey'))
        OR NOT (p_receipt->'panelHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'sourceRegionHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'trimDimensions' ? (s->>'surfaceKey'))
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','widthInches'])::numeric IS DISTINCT FROM (s->>'widthInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','heightInches'])::numeric IS DISTINCT FROM (s->>'heightInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','surfaceSqFt'])::numeric IS DISTINCT FROM (s->>'surfaceSqFt')::numeric)
      OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'trimDimensions')) <> jsonb_array_length(v_manifest->'expectedSurfaces')
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts r WHERE r.run_id=v_run.id AND r.receipt_kind='call8.flat-proof'
        AND r.receipt->>'dimensionManifestId'=v_run.dimension_manifest_id::text AND lower(r.receipt->>'manifestHash')=v_run.manifest_hash)
    THEN RAISE EXCEPTION 'call9_unique_proof_region_contract_failed'; END IF;
  ELSIF v_stage.stage_key='logos.extract' THEN
    v_kind:='call10.logo-inventory';
    SELECT snapshot INTO v_snapshot FROM public.designpro_revision_sources WHERE revision_id=v_run.revision_id AND snapshot_hash=v_run.revision_snapshot_hash;
    SELECT receipt INTO v_call9 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='call9.surface-panels';
    IF (p_receipt->>'call')::int<>10 OR p_receipt->>'inventoryContract'<>'designpro.expected-logo-inventory.v1' OR COALESCE((p_receipt->>'exactSetVerified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt->>'inventoryHash')!~'^[0-9a-f]{64}$'
      OR v_snapshot IS NULL OR v_call9 IS NULL OR jsonb_typeof(p_receipt->'inventory')<>'array'
      OR jsonb_array_length(p_receipt->'inventory')<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT actual->>'placementKey') FROM jsonb_array_elements(p_receipt->'inventory') actual)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' OR jsonb_array_length(COALESCE(p_artifacts,'[]'))<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT artifact->>'surfaceKey') FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'expectedLogoInventory') expected WHERE
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'inventory') actual
          WHERE actual->>'placementKey'=expected->>'placementKey'
            AND actual->>'identityKey'=expected->>'identityKey'
            AND actual->>'displayName'=expected->>'displayName'
            AND actual->>'targetSurfaceKey'=expected->>'surfaceKey'
            AND actual->>'storagePath'=expected->>'storagePath'
            AND actual->>'contentType'=expected->>'contentType'
            AND lower(actual->>'contentHash')=lower(expected->>'contentHash'))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact
          WHERE artifact->>'kind'='logo'
            AND artifact->>'surfaceKey'=expected->>'placementKey'
            AND lower(artifact->>'contentHash')=lower(expected->>'contentHash')
            AND artifact->>'storagePath'=expected->>'storagePath'
            AND artifact#>>'{metadata,placementKey}'=expected->>'placementKey'
            AND artifact#>>'{metadata,identityKey}'=expected->>'identityKey'
            AND artifact#>>'{metadata,displayName}'=expected->>'displayName'
            AND artifact#>>'{metadata,targetSurfaceKey}'=expected->>'surfaceKey'
            AND artifact#>>'{metadata,contentType}'=expected->>'contentType'
            AND artifact#>>'{metadata,separationContract}'='designpro.deterministic-stored-overlay.v1'
            AND lower(artifact#>>'{metadata,sourceRegionHash}')=lower(v_call9#>>ARRAY['sourceRegionHashes',expected->>'surfaceKey'])))
    THEN RAISE EXCEPTION 'call10_contract_failed'; END IF;
  ELSIF v_stage.stage_key='output.verify' THEN
    v_kind:='output.verified';
    IF p_receipt->>'contract' IS DISTINCT FROM 'designpro.output-verification.v1'
      OR p_receipt->'exactSurfaceSet' IS DISTINCT FROM
        '["driver","passenger","hood","roof","front","rear"]'::jsonb
      OR p_receipt->'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb
      OR (p_receipt->>'fileCount')::integer IS DISTINCT FROM 18
      OR (p_receipt->>'fullScalePixelsPerInch')::numeric IS DISTINCT FROM 150
      OR (p_receipt->>'fileDpi')::numeric IS DISTINCT FROM 1500
      OR (p_receipt->>'outputScale')::numeric IS DISTINCT FROM 0.1
      OR (p_receipt->>'fullScaleBleedInchesPerEdge')::numeric IS DISTINCT FROM 5
      OR jsonb_typeof(p_receipt->'files') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'files') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT (f->>'surfaceKey',f->>'format'))
          FROM jsonb_array_elements(p_receipt->'files') f) IS DISTINCT FROM 18
      OR EXISTS(
        SELECT 1
        FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) surface_key
        CROSS JOIN unnest(ARRAY['png','tiff','eps']) format
        WHERE NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
          WHERE f->>'surfaceKey'=surface_key AND f->>'format'=format
            AND lower(f->>'contentHash')~'^[0-9a-f]{64}$'
            AND (f->>'byteSize')::bigint>0
            AND (f->>'dpi')::numeric=1500
            AND (f->>'outputScale')::numeric=0.1
            AND (f->>'fullScaleBleedInches')::numeric=5
            AND f->>'colorSpace'='sRGB'
        )
      )
      OR jsonb_typeof(p_receipt->'outputHashes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'outputHashes') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_array_elements_text(p_receipt->'outputHashes'))
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(p_receipt->'outputHashes') h
        WHERE lower(h)!~'^[0-9a-f]{64}$'
          OR NOT EXISTS(
            SELECT 1 FROM public.designpro_artifacts a
            WHERE a.run_id=v_run.id AND a.artifact_kind='output' AND a.content_hash=lower(h)
          )
      )
      OR EXISTS(
        SELECT 1 FROM public.designpro_artifacts a
        WHERE a.run_id=v_run.id AND a.artifact_kind='output'
          AND NOT (p_receipt->'outputHashes' ? a.content_hash)
      )
      OR (SELECT count(*) FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output')
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
        WHERE NOT EXISTS(
          SELECT 1 FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output'
            AND a.surface_key=f->>'surfaceKey'
            AND a.storage_path=f->>'storagePath'
            AND a.content_hash=lower(f->>'contentHash')
            AND a.byte_size=(f->>'byteSize')::bigint
            AND a.metadata->>'format'=f->>'format'
            AND (a.metadata->>'width')::numeric=(f->>'widthPixels')::numeric
            AND (a.metadata->>'height')::numeric=(f->>'heightPixels')::numeric
            AND (a.metadata->>'dpi')::numeric=1500
            AND (a.metadata->>'outputScale')::numeric=0.1
            AND (a.metadata->>'fullScaleBleedInches')::numeric=5
        )
      )
      OR COALESCE(p_artifacts,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'; END IF;
  ELSIF v_stage.stage_key='stamp.build' THEN v_kind:='stamp';
  ELSIF v_stage.stage_key='zip.build' THEN v_kind:='zip';
  ELSIF v_stage.stage_key='wrapbox.deliver' THEN v_kind:='wrapbox.delivery';
  ELSE v_kind:=NULL; END IF;
  IF v_stage.stage_key='proof.build' AND NOT v_deferred_call8 AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
    WHERE a->>'kind'='flat-proof' AND lower(a->>'contentHash')=lower(p_receipt->>'sourceProofHash')
  ) THEN RAISE EXCEPTION 'call8_proof_artifact_required'; END IF;
  IF v_stage.stage_key='panels.build'
    AND NOT (v_atlas AND p_receipt->>'promotedFrom'='atlas-call1') AND EXISTS(
    SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
      WHERE a->>'kind'='panel' AND a->>'surfaceKey'=h.key AND lower(a->>'contentHash')=lower(h.value))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='panel' AND (
        lower(a#>>'{metadata,sourceRegionHash}') IS DISTINCT FROM lower(p_receipt#>>ARRAY['sourceRegionHashes',a->>'surfaceKey'])
        OR (a#>>'{metadata,trimWidthInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','widthInches'])::numeric
        OR (a#>>'{metadata,trimHeightInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','heightInches'])::numeric
        OR (a#>>'{metadata,surfaceSqFt}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','surfaceSqFt'])::numeric
        OR (a#>>'{metadata,bleed,top}')::numeric<>5 OR (a#>>'{metadata,bleed,right}')::numeric<>5
        OR (a#>>'{metadata,bleed,bottom}')::numeric<>5 OR (a#>>'{metadata,bleed,left}')::numeric<>5))
  ) THEN RAISE EXCEPTION 'call9_panel_artifact_set_incomplete'; END IF;
  IF v_stage.stage_key='pack.verify' AND (
    v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL OR v_run.source_contract_hash IS NULL OR v_run.artifact_set_hash IS NULL
    OR NOT (v_run.results ? 'packReceipt')
  ) THEN RAISE EXCEPTION 'finalized_entice_identity_required'; END IF;
  IF v_stage.stage_key='pack.activate' AND NOT EXISTS(
    SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=v_run.id AND p.stage_key='pack.verify' AND p.status='completed'
      AND p.verification @> '{"verified":true}'::jsonb
  ) THEN RAISE EXCEPTION 'verified_entice_pack_required_for_activation'; END IF;
  IF v_stage.stage_key='stamp.build' THEN
    SELECT snapshot INTO v_snapshot
    FROM public.designpro_revision_sources
    WHERE revision_id=v_run.revision_id AND owner_id=v_run.owner_id
      AND snapshot_hash=v_run.revision_snapshot_hash;
    IF v_snapshot IS NULL
      OR p_receipt->>'receiptKind' IS DISTINCT FROM 'stamp'
      OR p_receipt->>'designId' IS DISTINCT FROM v_snapshot->>'designId'
      OR p_receipt->>'orderNumber' IS DISTINCT FROM v_snapshot->>'orderNumber'
      OR p_receipt->>'stampHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'sealHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'sourceProofHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'stampHash' IS NOT DISTINCT FROM p_receipt->>'sealHash'
      OR lower(p_receipt_hash) IS DISTINCT FROM p_receipt->>'stampHash'
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts q
        WHERE q.run_id=v_run.id AND q.receipt_kind='final.human-qc'
          AND q.receipt->>'verifiedBy'=p_receipt->>'verifiedBy'
          AND q.receipt->>'approvalRef'=p_receipt->>'approvalRef'
          AND q.receipt->>'approvedAt'=p_receipt->>'approvedAt'
          AND q.receipt#>>'{qc,designId}'=v_snapshot->>'designId'
          AND q.receipt#>>'{qc,orderNumber}'=v_snapshot->>'orderNumber')
      OR jsonb_typeof(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 'array'
      OR jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 2
      OR (SELECT count(DISTINCT a->>'surfaceKey')
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp'
            AND a->>'surfaceKey' IN ('seal','stamped-proof')) IS DISTINCT FROM 2
      OR EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind' IS DISTINCT FROM 'stamp'
            OR a->>'surfaceKey' NOT IN ('seal','stamped-proof')
            OR a#>>'{metadata,designId}' IS DISTINCT FROM v_snapshot->>'designId'
            OR a#>>'{metadata,orderNumber}' IS DISTINCT FROM v_snapshot->>'orderNumber')
      OR NOT EXISTS(SELECT 1
        FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='seal'
          AND lower(a->>'contentHash')=p_receipt->>'sealHash'
          AND a#>>'{metadata,designId}'=v_snapshot->>'designId'
          AND a#>>'{metadata,orderNumber}'=v_snapshot->>'orderNumber')
      OR NOT EXISTS(SELECT 1
        FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='stamped-proof'
          AND lower(a->>'contentHash')=p_receipt->>'stampHash'
          AND lower(a#>>'{metadata,sourceProofHash}')=p_receipt->>'sourceProofHash'
          AND a#>>'{metadata,designId}'=v_snapshot->>'designId'
          AND a#>>'{metadata,orderNumber}'=v_snapshot->>'orderNumber')
    THEN RAISE EXCEPTION 'exact_seal_and_stamped_proof_identity_required'; END IF;
  END IF;
  IF v_stage.stage_key='zip.build' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='stamp')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='zip' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'stamp_receipt_and_zip_artifact_required'; END IF;
  END IF;
  IF v_stage.stage_key='wrapbox.deliver' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts z WHERE z.run_id=v_run.id AND z.receipt_kind='zip' AND z.receipt_hash=lower(p_receipt->>'zipHash'))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='wrapbox-manifest' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'exact_zip_and_wrapbox_manifest_required'; END IF;
  END IF;
  IF v_kind IS NOT NULL THEN INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash) VALUES(v_run.id,v_stage.id,v_kind,p_identity,p_receipt,lower(p_receipt_hash)); END IF;
  IF jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' THEN RAISE EXCEPTION 'artifact_array_required'; END IF;
  FOR v_art IN SELECT value FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) LOOP
    INSERT INTO public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata)
    VALUES(v_run.id,v_stage.id,v_art->>'kind',COALESCE(v_art->>'surfaceKey',''),v_art->>'storagePath',lower(v_art->>'contentHash'),NULLIF(v_art->>'byteSize','')::bigint,COALESCE(v_art->'metadata','{}'));
  END LOOP;
  UPDATE public.designpro_workflow_stages SET status='completed',output=p_receipt,verification=jsonb_build_object('verified',true,'identity',p_identity),output_hash=lower(p_receipt_hash),completed_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=v_stage.id;
  IF v_stage.stage_key IN ('source.verify','output.verify') THEN
    UPDATE public.designpro_workflow_stages
    SET status='waiting',
      wait_reason=CASE WHEN v_stage.stage_key='source.verify' THEN 'panelpro_preflight_required' ELSE 'final_human_qc_required' END,
      wait_details=jsonb_build_object('requestedBy','designpro.os','requestedAt',clock_timestamp()),
      updated_at=clock_timestamp()
    WHERE run_id=v_run.id
      AND stage_key=CASE WHEN v_stage.stage_key='source.verify' THEN 'await_panelpro_preflight_qc' ELSE 'await_final_human_qc' END
      AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'required_human_gate_missing_or_already_transitioned'; END IF;
  END IF;
  PERFORM public.designpro_sync_run_status(v_run.id);
  -- Completing Entice is the database-owned production trigger. This occurs
  -- in the same transaction, so a crash cannot leave an activated pack with
  -- no durable production workflow. The periodic reconciler in 181000 covers
  -- historical rows and any externally committed legacy activation.
  IF v_stage.stage_key='pack.activate' THEN
    PERFORM public.create_designpro_production_workflow(
      v_run.id,
      'auto-production:'||v_run.id::text,
      '{"trigger":"designpro.os.auto"}'::jsonb
    );
  END IF;
  RETURN true;
END $fn$;

GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;
