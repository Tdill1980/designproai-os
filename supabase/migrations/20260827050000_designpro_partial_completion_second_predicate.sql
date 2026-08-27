-- THE SAME EXCEPTION IS RAISED TWICE, AND 20260827030000 PATCHED ONE OF THEM.
--
-- That migration relaxed the INPUT validation so a short view set could
-- complete, asserted its search fragment appeared exactly once, asserted the
-- surrounding contract survived, and parsed the result. Every check passed. It
-- was still only half the rule, because `complete_designpro_generation_request`
-- raises `exact_seven_generation_views_required` in TWO places:
--
--   1. before the loop, over p_views          <- patched on 2026-08-27
--   2. AFTER the loop, over the rows it just inserted:
--
--        IF (SELECT count(*) FROM public.designpro_generation_views
--            WHERE request_id=v_request.id AND superseded_at IS NULL)<>7
--        THEN RAISE EXCEPTION 'exact_seven_generation_views_required';
--
-- The fragment counter could never see it: site 2 shares the exception NAME and
-- nothing else, so `v_occurrences <> 1` on the predicate text was satisfied by
-- site 1 alone. This is CLAUDE.md's own rule, hit again: validating the inputs
-- proves you found the right text; only reading the produced body proves the
-- contract actually moved.
--
-- Live cost, canary 7323fd73-6f1d-4a87-bfba-2bea11f17978 (2026-08-27 08:05:37):
-- the A.T.L.A.S. master was ACCEPTED, six panels were cut, and FIVE of seven
-- proofs were accepted -- side, passenger-side, hood_detail, front and roof --
-- with rear and close-up refused by the proof inspector after four judged tries
-- each. Site 1 let that through. Site 2 counted five rows, wanted seven, and
-- destroyed the whole run:
--
--   [DESIGNPRO-OS] generation worker:
--   complete_designpro_generation_request failed: exact_seven_generation_views_required
--
-- Which is exactly the outcome the owner's directive forbids: "A failed Close-Up
-- cannot cancel Driver/Passenger/Front/Rear/Roof artifacts."
--
-- WHAT SITE 2 BECOMES, AND WHY IT IS STRICTER THAN BEFORE. The old test asked
-- "are there seven rows". The new one asks "do the persisted rows number
-- EXACTLY what this call delivered" -- so a full run still requires seven (the
-- caller sends seven), and a partial run requires its five to be five, with the
-- same refusal receipt site 1 demands. A stray non-superseded row that used to
-- be invisible whenever the total happened to reach seven now fails here.
DO $second$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'IF (SELECT pg_catalog.count(*) FROM public.designpro_generation_views\n      WHERE request_id=v_request.id AND superseded_at IS NULL)<>7\n  THEN RAISE EXCEPTION ''exact_seven_generation_views_required''; END IF;';
  v_new constant text :=
    E'IF (SELECT pg_catalog.count(*) FROM public.designpro_generation_views\n      WHERE request_id=v_request.id AND superseded_at IS NULL)\n     <> pg_catalog.jsonb_array_length(p_views)\n    OR (pg_catalog.jsonb_array_length(p_views)<>7\n        AND pg_catalog.jsonb_typeof(p_engine_receipt->''refusedViews'') IS DISTINCT FROM ''array'')\n  THEN RAISE EXCEPTION ''exact_seven_generation_views_required''; END IF;';
  v_occurrences int;
  v_raises int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'second_predicate_target_missing';
  END IF;

  -- Idempotent: a second apply is a no-op.
  IF pg_catalog.strpos(v_definition, 'superseded_at IS NULL)
     <> pg_catalog.jsonb_array_length(p_views)') > 0 THEN
    RETURN;
  END IF;

  -- Site 1 must already be patched. Applying this against an unpatched body
  -- would leave the two predicates disagreeing, which is worse than either.
  IF pg_catalog.strpos(v_definition, 'NOT BETWEEN 1 AND 7') = 0 THEN
    RAISE EXCEPTION 'second_predicate_requires_20260827030000';
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'second_predicate_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- THE CHECK 20260827030000 DID NOT MAKE. Count the RAISE SITES, not the
  -- predicate text, and require that every one of them now reads the delivered
  -- length rather than a hardcoded seven. This is the assertion that would have
  -- caught the half-patch, so it is the one that ships.
  v_raises := (pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, 'exact_seven_generation_views_required', '')))
    / pg_catalog.length('exact_seven_generation_views_required');
  IF v_raises <> 2 THEN
    RAISE EXCEPTION 'second_predicate_unexpected_raise_count: %', v_raises;
  END IF;
  IF (pg_catalog.length(v_patched)
      - pg_catalog.length(pg_catalog.replace(v_patched, 'pg_catalog.jsonb_array_length(p_views)', '')))
     / pg_catalog.length('pg_catalog.jsonb_array_length(p_views)') < 4
  THEN
    RAISE EXCEPTION 'second_predicate_length_reads_missing';
  END IF;
  -- And no raise site may still test a bare seven.
  IF pg_catalog.strpos(v_patched, 'superseded_at IS NULL)<>7') > 0 THEN
    RAISE EXCEPTION 'second_predicate_hardcoded_seven_survived';
  END IF;

  -- The surrounding contract is what this predicate sits between; a replacement
  -- that ate either would still "apply cleanly".
  IF pg_catalog.strpos(v_patched, 'generation_lease_lost') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.calls-1-7-receipt.v1') = 0
    OR pg_catalog.strpos(v_patched, 'accepted_generation_view_identity_conflict') = 0
    OR pg_catalog.strpos(v_patched, 'frozen_generation_engine_receipt_invalid') = 0
  THEN
    RAISE EXCEPTION 'second_predicate_context_lost';
  END IF;

  EXECUTE v_patched;
END
$second$;

-- PARSE WHAT WAS PRODUCED, then leave evidence that both sites moved together.
DO $verify$
DECLARE
  v_definition text;
  v_raises int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)'
  ));
  v_raises := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, 'exact_seven_generation_views_required', '')))
    / pg_catalog.length('exact_seven_generation_views_required');
  IF v_raises <> 2 THEN
    RAISE EXCEPTION 'partial_completion_raise_count_drifted: %', v_raises;
  END IF;
  IF pg_catalog.strpos(v_definition, 'NOT BETWEEN 1 AND 7') = 0 THEN
    RAISE EXCEPTION 'partial_completion_site_one_missing';
  END IF;
  IF pg_catalog.strpos(v_definition, 'superseded_at IS NULL)<>7') > 0 THEN
    RAISE EXCEPTION 'partial_completion_site_two_still_hardcoded';
  END IF;
  -- Both sites require the refusal receipt on a short set, so a partial run can
  -- never be recorded as if it were whole.
  IF (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, 'refusedViews', '')))
     / pg_catalog.length('refusedViews') < 2
  THEN
    RAISE EXCEPTION 'partial_completion_refusal_requirement_incomplete';
  END IF;
END
$verify$;
