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
-- THE FOUR CONTRADICTIONS, ALL CLOSED HERE. They are one class of defect, and
-- they were found by tracing the whole free half rather than one stage at a
-- time -- because closing only the first moves the death one stage down and
-- burns another end-to-end run to discover the next.
--
-- 3 and 4 live in finalize_designpro_entice_identity and are patched at the
-- bottom of this file: it demanded a bound GENIE manifest, and a
-- call8.flat-proof receipt, before a free A.T.L.A.S. run could finalize its own
-- preview identity. The first is post-purchase production geometry being
-- required inside the free half, which RULE 0.19 forbids; the second is the
-- deferral defect again, one stage further along.
--
-- THE FIRST TWO:
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
-- THE REPLACEMENT MUST RE-EMIT THE BRANCH IT REPLACES. The first version of
-- this fragment swapped the legacy panels.build header for the A.T.L.A.S.
-- branch and stopped there, which DELETED the legacy branch: its contract body
-- was left dangling inside the A.T.L.A.S. branch, and the ELSIF chain lost its
-- panels.build arm entirely. The shadow suite showed all three consequences at
-- once and it took four wrong guesses to read them properly --
--   * a clean A.T.L.A.S. promotion passed the A.T.L.A.S. contract and then fell
--     into the orphaned legacy body, raising the LEGACY error;
--   * a mutated A.T.L.A.S. promotion failed the A.T.L.A.S. contract first and
--     raised the right one, which made the branch look correct;
--   * and a Standard run matched NO panels.build arm at all, so it completed
--     with no contract enforced whatsoever. That last one is the dangerous one:
--     it silently removed Call 9's protection from every non-A.T.L.A.S. run.
-- The fragment now ends by restoring the legacy header verbatim, so the chain
-- reads: A.T.L.A.S. arm, then legacy arm, then everything else untouched.
--
-- Nothing else in this function moves, and that is structural rather than
-- promised: the patch below edits six named fragments of the LIVE definition
-- and leaves every other byte untouched, so revision.freeze, logos.extract,
-- output.verify, pack.verify, pack.activate, stamp.build, zip.build,
-- wrapbox.deliver, source.verify and every artifact-ledger assertion survive
-- exactly as deployed -- including patches applied by earlier migrations.

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


-- PATCH THE LIVE DEFINITION; DO NOT RESTATE IT.
--
-- 20260822090000 established this technique and this migration follows it,
-- because that migration does not restate complete_designpro_stage either -- it
-- text-patches the deployed body so its Close-Up revision.freeze requirement
-- lands on whatever body is live. A restatement silently REVERTS it.
--
-- That was not a theory. The first version of this migration reproduced the
-- 20260806180100 body verbatim, and supabase/tests/closeup_schema_boundaries
-- test 4 failed in the shadow gate -- "revision.freeze allows Hero only from
-- its existing frozen revision source" -- because the restatement had thrown
-- that patch away. Restating a function that earlier migrations patch in place
-- is a regression by construction. So every fragment below is applied to the
-- LIVE text, and each is asserted to appear EXACTLY ONCE before it is replaced:
-- if an earlier migration has moved it, this fails loudly instead of reverting
-- someone else's work.
DO $migration$
DECLARE
  v_definition text;
  v_fragment text;
  v_replacement text;
  v_index integer;
  v_pairs text[][]:=ARRAY[
    ARRAY[$frag$DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_kind text; v_art jsonb; v_views jsonb; v_manifest jsonb; v_snapshot jsonb; v_call9 jsonb;$frag$,$frag$DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_kind text; v_art jsonb; v_views jsonb; v_manifest jsonb; v_snapshot jsonb; v_call9 jsonb;
DECLARE v_atlas boolean; v_deferred_call8 boolean; v_atlas_master text;$frag$],
    ARRAY[$frag$  IF COALESCE((p_receipt->>'verified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt_hash) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'verified_receipt_required'; END IF;
$frag$,$frag$  -- A.T.L.A.S. IS THE PRODUCTION AUTHORITY, SO CALL 8 IS NOT A GATE.
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
$frag$],
    ARRAY[$frag$  ELSIF v_stage.stage_key='proof.build' THEN
    v_kind:='call8.flat-proof';
$frag$,$frag$  ELSIF v_stage.stage_key='proof.build' AND v_deferred_call8 THEN
    -- A deferral is recorded as its own kind. Storing it as 'call8.flat-proof'
    -- would let panels.build's proof-region contract read a proof that was
    -- never built, which is the opposite of honest.
    v_kind:='call8.flat-proof-deferred';
  ELSIF v_stage.stage_key='proof.build' THEN
    v_kind:='call8.flat-proof';
$frag$],
    ARRAY[$frag$  IF v_stage.stage_key='proof.build' AND NOT EXISTS($frag$,$frag$  IF v_stage.stage_key='proof.build' AND NOT v_deferred_call8 AND NOT EXISTS($frag$],
    ARRAY[$frag$  ELSIF v_stage.stage_key='panels.build' THEN
    v_kind:='call9.surface-panels';
    v_manifest:=v_run.results->'dimensionManifest';
$frag$,$frag$  ELSIF v_stage.stage_key='panels.build'
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
$frag$],
    ARRAY[$frag$  IF v_stage.stage_key='panels.build' AND EXISTS($frag$,$frag$  IF v_stage.stage_key='panels.build'
    AND NOT (v_atlas AND p_receipt->>'promotedFrom'='atlas-call1') AND EXISTS($frag$]
  ];
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      ::pg_catalog.regprocedure
  ) INTO v_definition;

  FOR v_index IN 1..pg_catalog.array_length(v_pairs,1) LOOP
    v_fragment:=v_pairs[v_index][1];
    v_replacement:=v_pairs[v_index][2];
    IF (
      pg_catalog.length(v_definition)-pg_catalog.length(
        pg_catalog.replace(v_definition,v_fragment,'')
      )
    )/pg_catalog.length(v_fragment)<>1 THEN
      RAISE EXCEPTION 'designpro_atlas_stage_fragment_not_unique: %',v_index;
    END IF;
    v_definition:=pg_catalog.replace(v_definition,v_fragment,v_replacement);
  END LOOP;

  EXECUTE v_definition;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;


-- THE FREE HALF FINALIZES ITS OWN IDENTITY, AND PRODUCTION GEOMETRY STAYS PAID.
--
-- Two more contradictions of the same class as the ones above, found by tracing
-- the whole free half rather than one stage at a time. Both are patched in
-- place for the same reason: restating a function silently reverts whatever
-- earlier migrations patched into it.
DO $migration$
DECLARE
  v_definition text;
  v_fragment text;
  v_replacement text;
  v_index integer;
  v_target text;
  v_targets text[]:=ARRAY[
    'public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)',
    'public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)',
    'public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)'
  ];
  v_pairs text[][]:=ARRAY[
    ARRAY[$frag$  IF NOT FOUND OR v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL THEN RAISE EXCEPTION 'manifest_identity_not_bound'; END IF;$frag$,$frag$  -- THE FREE HALF HAS NO GENIE MANIFEST, AND MUST NOT.
  --
  -- manifest.resolve lives after the purchase gate (RULE 0.19), so an
  -- A.T.L.A.S. entice run reaches here with dimension_manifest_id and
  -- manifest_hash NULL by design. Demanding them was post-purchase production
  -- geometry being required inside the free half: the run had already produced
  -- its master, its six panels and its seven proofs, and still could not
  -- finalize its own preview identity.
  --
  -- The A.T.L.A.S. run is not exempted from having an identity -- it is held to
  -- the one that exists at this phase. workflow_run_is_atlas proves the frozen
  -- snapshot carries six canonical Call 1 panels AND that an accepted master
  -- with passing QC stands behind them. A non-A.T.L.A.S. run still requires the
  -- bound manifest exactly as before.
  IF NOT FOUND THEN RAISE EXCEPTION 'manifest_identity_not_bound'; END IF;
  IF (v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL)
    AND NOT designpro_private.workflow_run_is_atlas(p_run_id)
  THEN RAISE EXCEPTION 'manifest_identity_not_bound'; END IF;$frag$],
    ARRAY[$frag$    OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='call8.flat-proof')$frag$,$frag$    -- Call 8 is either a built proof or a recorded deferral. Requiring only
    -- the proof kind killed a deferred A.T.L.A.S. run here, one stage past
    -- where the same defect killed proof.build. A deferral is still a receipt:
    -- it names the failure and it is only accepted on an A.T.L.A.S. run.
    OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts
      WHERE run_id=p_run_id AND (receipt_kind='call8.flat-proof'
        OR (receipt_kind='call8.flat-proof-deferred'
          AND designpro_private.workflow_run_is_atlas(p_run_id))))$frag$],
    ARRAY[$frag$    OR COALESCE((p_manifest->>'genieVerified')::boolean,false) IS DISTINCT FROM true$frag$,$frag$    OR COALESCE((p_manifest->>'genieVerified')::boolean,false) IS DISTINCT FROM true
    -- DESIGN-TIME GEOMETRY MAY NEVER BECOME PRODUCTION GEOMETRY.
    -- genieVerified already refused it, but only incidentally -- the design-time
    -- manifest happens to carry false. These two say it outright, so a
    -- calls-1-7-layout-only sheet can never be bound as the authority Calls 9+
    -- cut and verify against, however it is relabelled.
    OR p_manifest->>'contract' IS DISTINCT FROM 'designpro.genie-dimension-manifest.v1'
    OR p_manifest->>'geometryPurpose' IS NOT DISTINCT FROM 'calls-1-7-layout-only'$frag$]
  ];
BEGIN
  FOR v_index IN 1..pg_catalog.array_length(v_pairs,1) LOOP
    v_target:=v_targets[v_index];
    SELECT pg_catalog.pg_get_functiondef(v_target::pg_catalog.regprocedure)
    INTO v_definition;
    v_fragment:=v_pairs[v_index][1];
    v_replacement:=v_pairs[v_index][2];
    IF (
      pg_catalog.length(v_definition)-pg_catalog.length(
        pg_catalog.replace(v_definition,v_fragment,'')
      )
    )/pg_catalog.length(v_fragment)<>1 THEN
      RAISE EXCEPTION 'designpro_atlas_free_half_fragment_not_unique: %',v_index;
    END IF;
    EXECUTE pg_catalog.replace(v_definition,v_fragment,v_replacement);
  END LOOP;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text) TO service_role;
