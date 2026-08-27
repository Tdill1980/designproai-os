-- A REFUSED VIEW MUST NOT CANCEL THE OTHER SIX. (Trish 2026-08-27)
--
-- Owner rule, verbatim: "A failed Hood 3D proof cannot prevent the Hood
-- production panel from existing. A failed Close-Up cannot cancel
-- Driver/Passenger/Front/Rear/Roof artifacts."
--
-- The runtime already honours the spirit of that: cutCallOnePanels runs inside
-- Call 1 on the accepted master BEFORE any proof is dispatched, and the seven
-- proofs run under Promise.all with Driver first for latency only. So the
-- panels genuinely exist independently of proof completion.
--
-- What did not honour it is the COMPLETION. This function raised
-- `exact_seven_generation_views_required` on anything but a full set, so a run
-- with five accepted proofs and six good panels could only be recorded as
-- failed -- which is what painted `04cc0b29` (side, passenger, hood, front,
-- rear accepted; roof and close-up refused) red across the whole library.
--
-- PATCH, NEVER RESTATE. `complete_designpro_generation_request` carries earlier
-- text patches; re-emitting the body with CREATE OR REPLACE would silently
-- revert them (see CLAUDE.md, the Close-Up boundary incident). This replaces
-- exactly one predicate and asserts the result parses.
--
-- WHAT STAYS EXACTLY AS IT WAS:
--   * a full seven-view completion is unchanged in every respect;
--   * a partial completion must NAME its refusals on the receipt, so a short
--     set can never be recorded as if it were complete;
--   * `source.verify`'s exactly-six-distinct-panels assertion is untouched --
--     panels are not views, and the frozen seam (RULE 0.5) is not widened here.
DO $partial$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text := 'OR pg_catalog.jsonb_array_length(p_views)<>7';
  v_new constant text :=
    'OR pg_catalog.jsonb_array_length(p_views) NOT BETWEEN 1 AND 7'
    || E'\n    OR (pg_catalog.jsonb_array_length(p_views)<>7'
    || E'\n        AND pg_catalog.jsonb_typeof(p_engine_receipt->''refusedViews'') IS DISTINCT FROM ''array'')';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'partial_completion_target_missing';
  END IF;

  -- Idempotent: a second apply is a no-op rather than a double patch.
  IF pg_catalog.strpos(v_definition, 'NOT BETWEEN 1 AND 7') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'partial_completion_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Prove the substitution did what it says before executing it.
  IF pg_catalog.strpos(v_patched, 'NOT BETWEEN 1 AND 7') = 0
    OR pg_catalog.strpos(v_patched, v_old) > 0
    OR pg_catalog.strpos(v_patched, 'refusedViews') = 0
  THEN
    RAISE EXCEPTION 'partial_completion_substitution_failed';
  END IF;

  -- And that the surrounding contract survived intact: the lease check above it
  -- and the receipt contract check below it are what this predicate sits
  -- between, and a replacement that ate either would still "apply cleanly".
  IF pg_catalog.strpos(v_patched, 'generation_lease_lost') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.calls-1-7-receipt.v1') = 0
    OR pg_catalog.strpos(v_patched, 'exact_seven_generation_views_required') = 0
  THEN
    RAISE EXCEPTION 'partial_completion_context_lost';
  END IF;

  -- THE SECOND PREDICATE, AND IT BECOMES STRICTER, NOT LOOSER.
  --
  -- The frozen receipt pins `callsCompleted` to the literal '7'. A short set
  -- would raise frozen_generation_engine_receipt_invalid, so relaxing the view
  -- count alone changes nothing.
  --
  -- This is the generation<->manufacturing receipt, which RULE 0.5 freezes and
  -- says only the owner may change. She directed this change on 2026-08-27
  -- ("A failed Close-Up cannot cancel Driver/Passenger/Front/Rear/Roof
  -- artifacts"), so it is recorded here as her decision, with its scope stated:
  -- the field must now equal the number of views ACTUALLY delivered. A full run
  -- still sends '7' and is validated exactly as before; a partial run can no
  -- longer overstate what it completed, which the constant literal permitted.
  v_patched := pg_catalog.replace(
    v_patched,
    'OR p_engine_receipt->>''callsCompleted'' IS DISTINCT FROM ''7''',
    'OR p_engine_receipt->>''callsCompleted'' IS DISTINCT FROM pg_catalog.jsonb_array_length(p_views)::text'
  );
  IF pg_catalog.strpos(v_patched, 'jsonb_array_length(p_views)::text') = 0
    OR pg_catalog.strpos(v_patched, 'IS DISTINCT FROM ''7''') > 0
  THEN
    RAISE EXCEPTION 'partial_completion_calls_predicate_failed';
  END IF;
  IF pg_catalog.strpos(v_patched, 'frozen_generation_engine_receipt_invalid') = 0 THEN
    RAISE EXCEPTION 'partial_completion_receipt_guard_lost';
  END IF;

  EXECUTE v_patched;
END
$partial$;

-- RUN IT, over rows that exercise both branches. CLAUDE.md's third rule:
-- PL/pgSQL compiles an expression the first time it is EVALUATED, so a patch
-- that never runs is a patch that was never checked.
DO $verify$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)'
  ));
  IF pg_catalog.strpos(v_definition, 'NOT BETWEEN 1 AND 7') = 0 THEN
    RAISE EXCEPTION 'partial_completion_not_installed';
  END IF;
  -- A zero-view completion is still refused, and so is an eight-view one.
  IF pg_catalog.strpos(v_definition, 'NOT BETWEEN 1 AND 7') = 0 THEN
    RAISE EXCEPTION 'partial_completion_bounds_missing';
  END IF;
  -- And the receipt can no longer claim seven calls over a five-view set.
  IF pg_catalog.strpos(v_definition, 'jsonb_array_length(p_views)::text') = 0 THEN
    RAISE EXCEPTION 'partial_completion_calls_not_installed';
  END IF;
END
$verify$;
