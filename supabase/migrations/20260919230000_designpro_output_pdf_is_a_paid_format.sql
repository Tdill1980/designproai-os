-- PDF JOINS THE PAID SIX-SURFACE OUTPUT SET. FOUR FORMATS, TWENTY-FOUR FILES.
--
-- WHAT WAS MEASURED. The delivered production pack carried PNG, TIFF and EPS and
-- no PDF at all: output-qc's FORMATS was ["png","tiff","eps"], this function
-- asserted 18 files, and the ONLY deterministic print-PDF writer in the tree
-- (productionPdf, in runtime/panelpro-file-output-render.cjs since 2026-09-08)
-- was reachable solely through the manual PanelProFileOutput attachment flow --
-- a separate reviewed run a QC member attaches by hand, which no DesignPro
-- production pack starts. So a shop whose RIP wants a PDF received none, and the
-- writer that could have made one sat unreachable from the paid path.
--
-- IT IS A REAL FORMAT, NOT A SOFT EXTRA. Every count here is exact, so a run
-- that cannot write a PDF fails closed rather than delivering a quietly smaller
-- pack. That is deliberate: a pack short one file per surface, shipped silently,
-- is the failure mode this whole verifier exists to prevent.
--
-- SHIP ORDER: THIS MIGRATION LANDS BEFORE THE RUNTIME THAT EMITS 24. There is no
-- soft path. A 24-file receipt against an 18-file gate raises
-- verified_output_artifact_ledger_mismatch AFTER output.build has already
-- rendered, uploaded and hashed twenty-four files -- the exact shape CLAUDE.md
-- records for authorElements and for proof.assemble: the nodes do all the work
-- and then cannot be finished. The reverse order is safe: an 18-file receipt
-- against a 24-file gate also raises, but before any bytes exist.
--
-- PATCHED, NOT RESTATED. complete_designpro_stage has been text-patched by
-- several later migrations (the A.T.L.A.S. stage contract, the Close-Up
-- boundary, the promotion arms). A CREATE OR REPLACE of the whole body here
-- would silently revert every one of them, which the shadow gate has already
-- caught once. Each fragment is asserted to appear EXACTLY ONCE before it is
-- replaced, and the six sites are the complete set -- verified by grep over the
-- migration that created them:
--
--   exactFormatSet array . fileCount . files length . distinct (surface,format)
--   . the CROSS JOIN that demands every pair . outputHashes length
--
-- Missing any one of them would leave a body that accepts a 24-file set while
-- still demanding eighteen somewhere else.

DO $migration$
DECLARE
  v_definition text;
  v_fragment text;
  v_replacement text;
  v_index integer;
  v_pairs text[][]:=ARRAY[
    ARRAY[
      $frag$      OR p_receipt->'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb$frag$,
      $frag$      OR p_receipt->'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps","pdf"]'::jsonb$frag$
    ],
    ARRAY[
      $frag$      OR (p_receipt->>'fileCount')::integer IS DISTINCT FROM 18$frag$,
      $frag$      OR (p_receipt->>'fileCount')::integer IS DISTINCT FROM 24$frag$
    ],
    ARRAY[
      $frag$      OR jsonb_array_length(p_receipt->'files') IS DISTINCT FROM 18$frag$,
      $frag$      OR jsonb_array_length(p_receipt->'files') IS DISTINCT FROM 24$frag$
    ],
    ARRAY[
      $frag$          FROM jsonb_array_elements(p_receipt->'files') f) IS DISTINCT FROM 18$frag$,
      $frag$          FROM jsonb_array_elements(p_receipt->'files') f) IS DISTINCT FROM 24$frag$
    ],
    ARRAY[
      $frag$        CROSS JOIN unnest(ARRAY['png','tiff','eps']) format$frag$,
      $frag$        CROSS JOIN unnest(ARRAY['png','tiff','eps','pdf']) format$frag$
    ],
    ARRAY[
      $frag$      OR jsonb_array_length(p_receipt->'outputHashes') IS DISTINCT FROM 18$frag$,
      $frag$      OR jsonb_array_length(p_receipt->'outputHashes') IS DISTINCT FROM 24$frag$
    ]
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
      RAISE EXCEPTION 'designpro_output_pdf_fragment_not_unique: %',v_index;
    END IF;
    v_definition:=pg_catalog.replace(v_definition,v_fragment,v_replacement);
  END LOOP;

  -- Inspecting the RESULT, not only the inputs. The 2026-08-26 lesson: six
  -- fragment assertions all passed while one replacement deleted the arm header
  -- it was meant to keep. Assert the patched body says twenty-four everywhere
  -- the output arm counted, and no longer says eighteen anywhere in it.
  -- strpos, NOT position. POSITION(x IN y) is SQL GRAMMAR and rejects a schema
  -- qualifier, exactly like COALESCE -- and under `SET search_path = ''` an
  -- unqualified call is what this codebase avoids. strpos(string, substring) is a
  -- real function, so it qualifies; note the argument order is the reverse.
  -- PGlite caught the qualified POSITION form as `syntax error at or near
  -- "v_definition"` before it could reach production.
  IF pg_catalog.strpos(v_definition,$chk$'["png","tiff","eps","pdf"]'::jsonb$chk$)=0
    OR pg_catalog.strpos(v_definition,$chk$unnest(ARRAY['png','tiff','eps','pdf']) format$chk$)=0
    OR pg_catalog.strpos(v_definition,$chk$IS DISTINCT FROM 18$chk$)<>0
    OR pg_catalog.strpos(v_definition,$chk$ELSIF v_stage.stage_key='output.verify' THEN$chk$)=0
    OR pg_catalog.strpos(v_definition,$chk$RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'$chk$)=0
  THEN
    RAISE EXCEPTION 'designpro_output_pdf_patched_body_invalid';
  END IF;

  EXECUTE v_definition;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;
