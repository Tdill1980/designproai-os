-- THE A.T.L.A.S. IDENTITY EXISTS THE SECOND SOMEONE PROMPTS. (Trish 2026-08-27)
--
-- Owner: "You must wire so ATLAS GenerationID fires the second someone prompts
-- DesignProAI."
--
-- Measured on live rows, prompt -> atlas revision existing:
--   f3eb40c1  65.3s      262f70cf  61.5s      671459d9  71.6s
--
-- For that first minute there was no A.T.L.A.S. identity for PanelPro or
-- RevisionStudioIQ to bind to, because the identity was minted as a side effect
-- of Call 1 RETURNING. The revision ROW cannot move earlier -- 32 of its columns
-- are NOT NULL and describe an image that does not exist yet -- so what moves
-- earlier is the IDENTITY: the revision id and the Design ID, stamped on the
-- request at creation. Call 1 then fills the row under that same id.
--
-- This also closes a second, independent defect. The handoff reads
-- `engine_receipt->>'handoffRevisionId'` and raises
-- `generation_handoff_revision_missing` when it is absent -- and it was absent
-- on every request that had not reached `outputs_ready`, which is exactly the
-- population the flat-first handoff was just opened up to serve. Live:
-- f3eb40c1 had an accepted master, six panels, and handoffRevisionId = null.
CREATE OR REPLACE FUNCTION designpro_private.atlas_identity_for_request(
  p_generation_id uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE
SET search_path TO ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'handoffRevisionId', extensions.gen_random_uuid(),
    'designId', 'DID-' || pg_catalog.upper(pg_catalog.left(
      pg_catalog.replace(p_generation_id::text, '-', ''), 8
    )),
    'atlasIdentityMintedAt', pg_catalog.now(),
    'atlasIdentityContract', 'designpro.atlas-identity-at-prompt.v1'
  );
$$;

DO $patch$
DECLARE
  v_src text;
  v_new text;
  v_needle constant text := '  RETURN pg_catalog.jsonb_build_object(
    ''requestId'',v_row.id,''generationId'',v_row.generation_id,
    ''state'',v_row.state,''inputHash'',v_row.input_hash,
    ''engineContractHash'',v_row.engine_contract_hash,
    ''createdAt'',v_row.created_at,''idempotent'',false
  );';
  v_replacement constant text := '  -- Mint the A.T.L.A.S. identity NOW, not when Call 1 returns.
  UPDATE public.designpro_generation_requests
  SET engine_receipt = COALESCE(engine_receipt,''{}''::jsonb)
    || designpro_private.atlas_identity_for_request(v_row.generation_id)
  WHERE id = v_row.id
    AND COALESCE(engine_receipt->>''handoffRevisionId'','''') = ''''
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    ''requestId'',v_row.id,''generationId'',v_row.generation_id,
    ''state'',v_row.state,''inputHash'',v_row.input_hash,
    ''engineContractHash'',v_row.engine_contract_hash,
    ''atlasRevisionId'',v_row.engine_receipt->>''handoffRevisionId'',
    ''designId'',v_row.engine_receipt->>''designId'',
    ''createdAt'',v_row.created_at,''idempotent'',false
  );';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_src
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_designpro_flat_first_generation_request';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'create_designpro_flat_first_generation_request is missing';
  END IF;

  IF pg_catalog.strpos(v_src, 'atlas_identity_for_request') > 0 THEN
    RETURN;  -- already patched; this migration is idempotent
  END IF;

  -- PATCH THE LIVE BODY; NEVER RESTATE IT. A CREATE OR REPLACE of the whole
  -- function silently reverts every earlier patch (CLAUDE.md, learned twice).
  IF (pg_catalog.length(v_src) - pg_catalog.length(
        pg_catalog.replace(v_src, v_needle, ''))
     ) / pg_catalog.length(v_needle) <> 1
  THEN
    RAISE EXCEPTION 'expected exactly one non-idempotent return block to patch';
  END IF;

  v_new := pg_catalog.replace(v_src, v_needle, v_replacement);

  -- AND THEN PARSE WHAT YOU PRODUCED. Validating the search string proves you
  -- found the right text; only inspecting the result proves you left valid code
  -- behind (CLAUDE.md: 20260826010000 passed all six of its own assertions and
  -- still deleted an arm header).
  IF pg_catalog.strpos(v_new, 'atlas_identity_for_request') = 0
    OR pg_catalog.strpos(v_new, 'atlasRevisionId') = 0
    OR pg_catalog.strpos(v_new, 'generation_active_request_limit') = 0
    OR pg_catalog.strpos(v_new, 'generation_input_conflict') = 0
  THEN
    RAISE EXCEPTION 'patched body lost a required fragment';
  END IF;

  EXECUTE v_new;
END
$patch$;

-- Backfill the identity for requests that already exist and never got one, so
-- an in-flight job is not stranded without a revision id the handoff requires.
UPDATE public.designpro_generation_requests
SET engine_receipt = COALESCE(engine_receipt, '{}'::jsonb)
  || designpro_private.atlas_identity_for_request(generation_id)
WHERE COALESCE(engine_receipt->>'handoffRevisionId', '') = ''
  AND state <> 'cancelled';
