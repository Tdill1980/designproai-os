-- THE PAID PATH ASKED THE RUN TABLE FOR A COLUMN THAT HAS NEVER EXISTED.
--
-- `public.confirm_designpro_revision_purchase` (20260920042000) opens with:
--
--     SELECT * INTO v_run FROM public.designpro_workflow_runs
--       WHERE id=p_entice_run_id AND workflow_type='designpro.entice_pack' AND status='completed'
--         AND owner_id=p_owner_id AND generation_id=p_generation_id
--         AND revision_id=p_revision_id AND revision_snapshot_hash=p_revision_snapshot_hash
--       FOR UPDATE;
--
-- `designpro_workflow_runs` HAS NO `generation_id`. It is created by
-- 20260806180000 without one, no migration in the history adds one, and
-- production's `information_schema` (read 2026-09-22) lists twenty-one columns,
-- none of them that. `supabase db lint` has reported
-- `column "generation_id" does not exist` (42703) on every gate since
-- 2026-09-20; the gate treats lint as advisory, so nothing failed and nothing
-- was fixed.
--
-- PL/pgSQL compiles a statement the first time it is EVALUATED, so this is not
-- a latent defect: it raises on the FIRST call, and the first call is every
-- customer purchase confirmation. `runtime/index.js` selects this RPC whenever
-- the webhook body carries `revision`, and the gateway writes
-- metadata[atlas_revision_id|revision_id|revision_snapshot_hash|entice_run_id]
-- on every Production Pack checkout session, which `checkoutRevisionFromMetadata`
-- turns into exactly that `revision`. So: Stripe pays, the runtime answers 400,
-- no entitlement row is written, `manifest.resolve` never opens, the customer's
-- production pack never starts. Two entitlements exist from 2026-09-20 and none
-- since.
--
-- THIS IS NOT A RELAXATION. The purchase stays bound to the generation by the
-- EXISTS immediately below, which is untouched: the revision source that owns
-- this revision id AND this snapshot hash must itself carry
-- `generation_id = p_generation_id`, and its Atlas revision must carry the same
-- generation and owner. A run cannot satisfy the SELECT and belong to a
-- different generation than the revision source the EXISTS pins.
--
-- PATCH, DO NOT RESTATE (CLAUDE.md): the fragment must occur EXACTLY ONCE, the
-- RESULT is inspected before EXECUTE, and the installed body is read back
-- afterwards. `CREATE OR REPLACE` preserves the function's existing ACL, so the
-- REVOKE/GRANT from 20260920042000 stands.
DO $revision_purchase_run$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;
  v_old constant text := E'      AND owner_id=p_owner_id AND generation_id=p_generation_id\n';
  v_new constant text := E'      -- THE RUN TABLE HAS NO generation_id, AND NEVER HAS (2026-09-22).\n      -- Asking for it raised 42703 on the first evaluation, which is every\n      -- customer purchase confirmation. The generation binding is not lost:\n      -- the EXISTS below requires s.generation_id=p_generation_id on the\n      -- revision source that owns this revision id and snapshot hash, and\n      -- a.generation_id=s.generation_id on its Atlas revision.\n      AND owner_id=p_owner_id\n';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.confirm_designpro_revision_purchase(text,text,text,uuid,integer,text,text,integer,uuid,uuid,text,uuid,uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'revision_purchase_target_missing';
  END IF;

  -- Idempotent: already patched, or written without the column from the start.
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    IF pg_catalog.strpos(v_definition, 'generation_id=p_generation_id') = 0 THEN
      RAISE EXCEPTION 'revision_purchase_generation_binding_lost';
    END IF;
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'revision_purchase_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Inspect the RESULT, not only the search string.
  IF pg_catalog.strpos(v_patched, 'AND owner_id=p_owner_id AND generation_id=p_generation_id') > 0 THEN
    RAISE EXCEPTION 'revision_purchase_substitution_failed';
  END IF;
  -- The generation binding the EXISTS carries must survive verbatim, and so
  -- must every fence 20260920042000 established.
  IF pg_catalog.strpos(v_patched, 's.generation_id=p_generation_id') = 0
    OR pg_catalog.strpos(v_patched, 'a.generation_id=s.generation_id') = 0
    OR pg_catalog.strpos(v_patched, 'purchase_revision_mismatch') = 0
    OR pg_catalog.strpos(v_patched, 'purchase_replay_mismatch') = 0
    OR pg_catalog.strpos(v_patched, 'purchase_revision_request_invalid') = 0
    OR pg_catalog.strpos(v_patched, 'service_role_required') = 0
    OR pg_catalog.strpos(v_patched, 'pg_advisory_xact_lock') = 0
    OR pg_catalog.strpos(v_patched, 'revision_snapshot_hash=p_revision_snapshot_hash') = 0
    OR pg_catalog.strpos(v_patched, 'FOR UPDATE') = 0
  THEN
    RAISE EXCEPTION 'revision_purchase_context_lost';
  END IF;
  IF pg_catalog.strpos(v_patched, 'pg_catalog.coalesce') > 0 THEN
    RAISE EXCEPTION 'revision_purchase_grammar_trap';
  END IF;

  EXECUTE v_patched;

  -- Read back: the installed body is the patched one.
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.confirm_designpro_revision_purchase(text,text,text,uuid,integer,text,text,integer,uuid,uuid,text,uuid,uuid)'
  ));
  IF pg_catalog.strpos(v_definition, 'AND owner_id=p_owner_id AND generation_id=p_generation_id') > 0
    OR pg_catalog.strpos(v_definition, 's.generation_id=p_generation_id') = 0
  THEN
    RAISE EXCEPTION 'revision_purchase_not_installed';
  END IF;
END $revision_purchase_run$;
