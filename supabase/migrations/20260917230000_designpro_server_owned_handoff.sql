-- THE 2D PROOF MUST NOT DEPEND ON THE CUSTOMER'S BROWSER STAYING OPEN.
--
-- Measured 2026-09-17 on three consecutive live generations (194e8f17,
-- aac0f43b, 71c8a5e8): every one reached `outputs_ready` with master QC passed,
-- six panels cut and seven proofs accepted, and
-- `designpro_flat_first_handoff_gate` reported `productionEligible: true` for
-- all three -- and NONE of them has an entice workflow row at all. So
-- `proof.build` never ran and there is no 2D Production Proof. The owner, in
-- the product: "missing 2d proof".
--
-- The cause is that `handoff_designpro_generation_to_production` is called from
-- exactly ONE place in the whole system -- the gateway, on a browser request --
-- and its own preamble refuses anything that is not an authenticated end-user
-- JWT (`auth.uid()`, role `authenticated`), because the snapshot it writes goes
-- through `save_designpro_revision_source`, which is granted to `authenticated`
-- and not to `service_role`. The runtime therefore cannot fire it. Close the
-- tab after the design lands and the production half is never created.
--
-- That is status-board item #14 ("server-owned orchestration required; browser
-- becomes observer-only") showing up as a customer-visible defect, and RULE
-- 0.5's amendment is explicit that the condition under which a workflow row is
-- created is NOT a frozen-seam change.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO.
--
-- It does NOT restate the handoff. CLAUDE.md's PL/pgSQL rule is that a live
-- body is patched, never re-emitted, and a second copy of a hundred lines of
-- handoff logic would drift from the first within a release. This is a thin
-- wrapper that CALLS the real function, so there remains exactly one handoff
-- implementation and one door.
--
-- It does NOT widen `save_designpro_revision_source`, and it does not grant
-- anything to `authenticated` or `anon`. The wrapper is executable by
-- `service_role` alone.
--
-- It is not an escalation. `service_role` can already write every one of these
-- rows directly; what it could not do was reach the SANCTIONED path that writes
-- them correctly. This wrapper is strictly NARROWER than the direct writes it
-- replaces: it proves the named owner really owns the request, then runs the
-- same audited function the browser runs, with the same gates, the same
-- idempotency and the same refusals.
CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_for_worker(
  p_request_id uuid, p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','extensions'
AS $function$
DECLARE
  v_owner uuid;
  v_result jsonb;
BEGIN
  -- Service role only. `authenticated` already has the real function and must
  -- never reach a path that names an owner other than itself.
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;

  SELECT owner_id INTO v_owner
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;
  -- The caller must NAME the owner and be right about it. A worker that has
  -- lost track of whose request it holds cannot hand off somebody else's.
  IF v_owner IS DISTINCT FROM p_owner_id
  THEN RAISE EXCEPTION 'generation_request_owner_mismatch'; END IF;

  -- `auth.uid()` and `auth.jwt()` read `request.jwt.claims` from the session.
  -- Setting it LOCAL (third argument true) scopes it to this transaction, so it
  -- is gone the moment the RPC returns or aborts, and no later statement on
  -- this connection can observe it.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',v_owner::text,'role','authenticated','is_anonymous','false'
    )::text,
    true
  );

  -- THE ONE DOOR. Every gate, every refusal and the idempotency the browser
  -- path gets, unchanged -- including `alreadyHandedOff` when the customer's
  -- own tab got there first.
  v_result:=public.handoff_designpro_generation_to_production(p_request_id);

  PERFORM set_config('request.jwt.claims','',true);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.handoff_designpro_generation_for_worker(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_designpro_generation_for_worker(uuid,uuid)
  TO service_role;
