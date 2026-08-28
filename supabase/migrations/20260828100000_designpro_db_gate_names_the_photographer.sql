-- THE DATABASE GATE STILL DEMANDED THE PRODUCER #232 REPLACED.
--
-- #238 corrected `assertAtlasViewLineage` in runtime/generation-worker.cjs: #232
-- had moved the proofs onto the deployed photographer (RULE 0.29) and left the
-- assert describing the retired in-runtime `generate-color-render` projection,
-- so no A.T.L.A.S. run could clear lineage however good its proofs.
--
-- `designpro_private.flat_first_atlas_view_set_valid` is the SQL TWIN of that
-- assert, and it was not moved either. Generation
-- 8555be2f-71fe-4a30-8680-653d086a213e / request
-- 74651e5e-4940-4c8b-8d2e-cf3d4b466d00 (2026-08-28, on 8c7ec086, the first run
-- WITH #238) is what surfaced it: the worker accepted the run and wrote
-- state='outputs_ready' with all seven proofs persisted -- and this predicate
-- then judged the set invalid, so `flat_first_atlas_requires_new_run` returned
-- true, `get_designpro_generation_request` rewrote the state to 'failed' with
-- failureCode 'flat_first_atlas_new_run_required', and the gateway answered 409
-- over seven good proofs. The handoff is gated on the same verdict, so the paid
-- half could never start.
--
-- WHAT THE LIVE PROOFS ACTUALLY CARRY (request 74651e5e, all seven views):
--
--   provider.stage                persona-photographer-render
--   provider.execution            edge-photographer
--   provider.proofContract        designpro.atlas-photographer-proof.v1
--   provider.proofSourceCommit    113d137dbe8813ca3bf70c8d7265ad081ebd4524
--   provider.proofProvider        google
--   provider.proofModel           gemini-3-pro-image
--   provider.proofImageRequestCount 1
--   provider.atlasZoneContract    designpro.atlas-panel-authority.v1
--   provider.atlasZoneContentHash = provider.sourcePanelHash  (the PANEL)
--   authority.zoneContract        designpro.flat-first-atlas-view-authority.v1
--   authority.zoneContentHash     the master-crop zone
--   validation.zoneHash/authorityHash = authority.zoneContentHash
--
-- and the predicate demanded, of the same rows:
--
--   provider.contract             designpro.generation-artifact-audit.v1
--   provider.renderMethod/stage   generate-color-render
--   provider.execution            server-native
--   provider.promptHash/promptLength
--   provider.studioContractVersion / viewAngleContractVersion /
--     photographyContractVersion
--   provider.atlasZoneContract    designpro.flat-first-atlas-view-authority.v1
--   validation.zoneHash = validation.authorityHash =
--     provider.atlasZoneContentHash
--   authority.zoneContract/zoneContentHash = provider.atlasZone*
--
-- Every one of those is a field of a producer that no longer runs, or an
-- equality that held only while `provider.atlasZone*` WAS the master crop.
--
-- THIS IS NOT A RELAXATION. The retired prompt audit is replaced, one for one,
-- by the photographer's own provenance -- WHICH function, at WHICH pinned source
-- commit, through WHICH provider and model, in exactly ONE image request -- and
-- the artwork binding follows the worker to the persisted Call-1 panel (RULE
-- 0.28 §6), checked by hash on both sides via sourcePanelHash. The QC binding
-- moves off `provider.atlasZone*` and onto `authority.zone*`, which is the crop
-- the QC judge was actually shown; before this change the two were the same
-- object, so the predicate's shape is preserved rather than loosened. Nothing
-- about master acceptance, view distinctness, role mapping, the six-sibling
-- refusals or the seven-view completeness is touched.
--
-- PATCH, DO NOT RESTATE. Restating the body reproduces whichever definition the
-- author copied and silently reverts the patches in between -- 20260827090000
-- (panelSourceHash) is exactly such a patch and would be lost. Each replacement
-- below asserts its fragment occurs EXACTLY ONCE before substituting.
DO $photographer$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;

  -- 1. The producer identity and its audit.
  v_producer_old constant text := E'      AND v.metadata#>>''{provider,contract}''=\n        ''designpro.generation-artifact-audit.v1''\n      AND v.metadata#>>''{provider,sourceViewType}''=v.source_view_type\n      -- Passenger renders like every other surface now.\n      AND v.metadata#>>''{provider,renderMethod}''=''generate-color-render''\n      AND v.metadata#>>''{provider,stage}''=''generate-color-render''\n      AND v.metadata#>>''{provider,execution}''=''server-native''\n      AND v.metadata#>''{provider,anchoredToFlatAtlas}''=''true''::jsonb\n      AND v.metadata#>''{provider,atlasConditioningVerified}''=''true''::jsonb\n      AND v.metadata#>>''{provider,promptHash}'' ~ ''^[0-9a-f]{64}$''\n      AND CASE\n        WHEN pg_catalog.jsonb_typeof(\n          v.metadata#>''{provider,promptLength}''\n        )=''number''\n        THEN (v.metadata#>>''{provider,promptLength}'')::numeric>=1\n        ELSE false\n      END\n      AND v.metadata#>>''{provider,studioContractVersion}''=\n        ''designpro.studio-os.port-ab0f0638.v1''\n      AND v.metadata#>>''{provider,viewAngleContractVersion}''=\n        ''designpro.view-angles-os.port-ab0f0638.v1''\n      AND v.metadata#>>''{provider,photographyContractVersion}''=\n        ''designpro.photorealism-prompt.port.v1''';
  v_producer_new constant text := E'      -- THE PRODUCER THIS ASSERTS MUST BE THE PRODUCER THAT RAN.\n      -- Passenger renders like every other surface now, and every surface is\n      -- rendered by the deployed photographer (RULE 0.29), not by the retired\n      -- in-runtime generate-color-render projection #232 replaced.\n      AND v.metadata#>>''{provider,stage}''=''persona-photographer-render''\n      AND v.metadata#>>''{provider,execution}''=''edge-photographer''\n      AND v.metadata#>''{provider,anchoredToFlatAtlas}''=''true''::jsonb\n      AND v.metadata#>''{provider,atlasConditioningVerified}''=''true''::jsonb\n      -- The photographer''s own provenance, in place of the retired producer''s\n      -- prompt audit: WHICH function, at WHICH pinned source commit, through\n      -- WHICH provider and model, in exactly ONE image request.\n      AND v.metadata#>>''{provider,proofProducer}''=\n        ''persona-photographer-render''\n      AND v.metadata#>>''{provider,proofContract}''=\n        ''designpro.atlas-photographer-proof.v1''\n      AND v.metadata#>>''{provider,proofSourceCommit}'' ~ ''^[0-9a-f]{40}$''\n      AND v.metadata#>>''{provider,proofRequestId}'' ~ ''^[0-9a-f-]{36}$''\n      AND v.metadata#>>''{provider,proofProvider}''=''google''\n      AND COALESCE(v.metadata#>>''{provider,proofModel}'','''') <> ''''\n      AND CASE\n        WHEN pg_catalog.jsonb_typeof(\n          v.metadata#>''{provider,proofImageRequestCount}''\n        )=''number''\n        THEN (v.metadata#>>''{provider,proofImageRequestCount}'')::numeric=1\n        ELSE false\n      END';

  -- 2. The artwork binding is the persisted panel, not a crop of the master.
  v_zone_old constant text := E'      AND v.metadata#>>''{provider,atlasZoneContract}''=\n        ''designpro.flat-first-atlas-view-authority.v1''\n      AND v.metadata#>>''{provider,atlasZoneContentHash}'' ~ ''^[0-9a-f]{64}$''';
  v_zone_new constant text := E'      -- RULE 0.28 §6: the proof hash-binds to the persisted Call-1 panel the\n      -- customer actually buys. That is what the photographer is handed and\n      -- what it verifies before it renders, and it reports the same hash twice\n      -- -- as the zone it was conditioned on and as the panel it came from --\n      -- so the two must agree here.\n      AND v.metadata#>>''{provider,atlasZoneContract}''=\n        ''designpro.atlas-panel-authority.v1''\n      AND v.metadata#>>''{provider,atlasZoneContentHash}'' ~ ''^[0-9a-f]{64}$''\n      AND v.metadata#>>''{provider,sourcePanelHash}''=\n        v.metadata#>>''{provider,atlasZoneContentHash}''';

  -- 3. Visual QC is bound to the zone the judge was shown: the view authority.
  v_validation_old constant text := E'      AND v.metadata#>>''{validation,authorityHash}''=\n        v.metadata#>>''{provider,atlasZoneContentHash}''\n      AND v.metadata#>>''{validation,zoneHash}''=\n        v.metadata#>>''{provider,atlasZoneContentHash}''\n      AND v.metadata#>>''{validation,zoneSurfaceKey}''=\n        v.metadata#>>''{provider,atlasZoneSurfaceKey}''';
  v_validation_new constant text := E'      AND v.metadata#>>''{validation,authorityHash}''=\n        v.metadata#>>''{authority,zoneContentHash}''\n      AND v.metadata#>>''{validation,zoneHash}''=\n        v.metadata#>>''{authority,zoneContentHash}''\n      AND v.metadata#>>''{validation,zoneSurfaceKey}''=\n        v.metadata#>>''{authority,zoneSurfaceKey}''';

  -- 4. The view authority keeps its own contract, and still names the same
  --    surface the panel binding does.
  v_authority_old constant text := E'      AND v.metadata#>>''{authority,zoneContract}''=\n        v.metadata#>>''{provider,atlasZoneContract}''\n      AND v.metadata#>>''{authority,zoneContentHash}''=\n        v.metadata#>>''{provider,atlasZoneContentHash}''\n      AND v.metadata#>>''{authority,zoneSurfaceKey}''=\n        v.metadata#>>''{provider,atlasZoneSurfaceKey}''';
  v_authority_new constant text := E'      AND v.metadata#>>''{authority,zoneContract}''=\n        ''designpro.flat-first-atlas-view-authority.v1''\n      AND v.metadata#>>''{authority,zoneContentHash}'' ~ ''^[0-9a-f]{64}$''\n      AND v.metadata#>>''{authority,zoneSurfaceKey}''=\n        v.metadata#>>''{provider,atlasZoneSurfaceKey}''';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'photographer_gate_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'proofImageRequestCount') > 0 THEN
    RETURN;
  END IF;

  v_patched := v_definition;

  -- Each fragment must be present EXACTLY once. A zero means the body already
  -- moved and this migration is describing something that is no longer there; a
  -- two means the substitution would land in a place nobody read.
  v_occurrences := (pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_producer_old, '')))
    / pg_catalog.length(v_producer_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'photographer_gate_producer_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_producer_old, v_producer_new);

  v_occurrences := (pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_zone_old, '')))
    / pg_catalog.length(v_zone_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'photographer_gate_zone_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_zone_old, v_zone_new);

  v_occurrences := (pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_validation_old, '')))
    / pg_catalog.length(v_validation_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'photographer_gate_validation_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_validation_old, v_validation_new);

  v_occurrences := (pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_authority_old, '')))
    / pg_catalog.length(v_authority_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'photographer_gate_authority_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_authority_old, v_authority_new);

  -- The retired producer must be GONE, not merely outvoted.
  IF pg_catalog.strpos(v_patched, 'generate-color-render') > 0
    OR pg_catalog.strpos(v_patched, 'server-native') > 0
    OR pg_catalog.strpos(v_patched, 'photorealism-prompt.port') > 0
    OR pg_catalog.strpos(v_patched, 'studio-os.port-ab0f0638') > 0
    OR pg_catalog.strpos(v_patched, 'view-angles-os.port-ab0f0638') > 0
  THEN
    RAISE EXCEPTION 'photographer_gate_retired_producer_survived';
  END IF;
  -- And the photographer must be named.
  IF pg_catalog.strpos(v_patched, 'persona-photographer-render') = 0
    OR pg_catalog.strpos(v_patched, 'edge-photographer') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-photographer-proof.v1') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-panel-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'sourcePanelHash') = 0
  THEN
    RAISE EXCEPTION 'photographer_gate_substitution_failed';
  END IF;
  -- Everything the earlier patches established must survive.
  IF pg_catalog.strpos(v_patched, 'designpro-flat-first-atlas-20260827.v10-edge') = 0
    OR pg_catalog.strpos(v_patched, 'panelSourceHash') = 0
    OR pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'Driver is the PRIORITY view') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZonePassedToPassengerRepair') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-designpanel-server-provider.v1') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-qc.v1') = 0
  THEN
    RAISE EXCEPTION 'photographer_gate_context_lost';
  END IF;
  -- The grammar trap 20260826030000 recorded: COALESCE is parsed before a
  -- search path is consulted, so a schema-qualified spelling raises at
  -- evaluation time rather than at apply time.
  IF pg_catalog.strpos(v_patched, 'pg_catalog.coalesce') > 0
    OR pg_catalog.strpos(v_patched, 'pg_catalog.COALESCE') > 0
  THEN
    RAISE EXCEPTION 'photographer_gate_qualified_grammar';
  END IF;

  EXECUTE v_patched;
END
$photographer$;

-- RUN IT, over a request that HAS views. An unevaluated predicate is exactly
-- what hid the 20260826030000 defect.
DO $verify$
DECLARE
  v_request uuid;
  v_valid boolean;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'designpro_private.flat_first_atlas_view_set_valid(uuid)'
    )), 'proofImageRequestCount') = 0
  THEN
    RAISE EXCEPTION 'photographer_gate_not_installed';
  END IF;

  SELECT r.id INTO v_request
  FROM public.designpro_generation_requests r
  WHERE r.request_input->>'pipelineMode' = 'flat-first-atlas-v1'
    AND EXISTS (
      SELECT 1 FROM public.designpro_generation_views v
      WHERE v.request_id = r.id AND v.superseded_at IS NULL
    )
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_request IS NULL THEN
    RETURN;
  END IF;

  v_valid := designpro_private.flat_first_atlas_view_set_valid(v_request);
  IF v_valid IS NULL THEN
    RAISE EXCEPTION 'photographer_gate_returned_null';
  END IF;
  PERFORM designpro_private.flat_first_atlas_requires_new_run(v_request);
  PERFORM public.designpro_generation_view_paths(v_request);
END
$verify$;
