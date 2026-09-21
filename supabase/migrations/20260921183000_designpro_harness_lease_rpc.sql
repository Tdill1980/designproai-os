-- A HARNESS LEASE CANNOT BE HAND-FORGED, AND FOUR PROBE RUNS PROVED IT.
--
-- `public.designpro_generation_requests` carries two CHECK constraints that a
-- caller outside the database cannot satisfy by writing literals:
--
--   engine_contract = designpro_private.calls_1_7_engine_contract()
--       exact jsonb equality against a function only postgres may execute, whose
--       value carries seven source blob hashes and a source commit.
--   request_input   must satisfy calls_1_7_input_v3_valid (or v2, or the v1
--       shape) — contract version, pipeline mode, an exact key allowlist, the
--       vehicle object, brief and design name.
--
-- plus a BEFORE INSERT trigger calling `calls_1_7_asset_paths_bound`. Every one
-- of those functions lives in `designpro_private` and is granted to postgres
-- alone, so a service_role insert dies on the first one it reaches — measured
-- across probe runs 35633829505, 35634220600, 35634810443 and 35635622438,
-- each failing in about twenty seconds, none reaching an image request.
--
-- `atlas-hero-driver-probe.mjs` inserts the same way and would fail identically;
-- its `engine_contract` literal (`{contractVersion, harness}`) cannot equal the
-- function's value, so that probe is broken too and this is its door as well.
--
-- THE FIX IS A DOOR, NOT A WIDER KEY. This runs as its owner, so the private
-- validators execute as postgres and ENFORCE themselves on the row — the
-- harness is checked exactly as a customer request is, rather than stepping
-- around the checks. It is granted to service_role only.
--
-- WHAT MAKES IT A HARNESS ROW AND NEVER A CUSTOMER GENERATION:
--   · `error.code = 'designiq_ab_harness_lease'`, the marker the hero probe
--     already uses, so a later reader can tell these apart by query;
--   · the caller supplies the owner, so it can only ever lease to a real user;
--   · it returns the lease token it minted, so the probe never invents one;
--   · it creates the row already `leased` — it does NOT enter the queue, so it
--     can never be claimed by a live worker, and the reverse is equally
--     important: this cannot hand a probe someone else's queued generation,
--     which is exactly what `claim_designpro_generation_request` would have
--     risked on production.

create or replace function public.mint_designpro_harness_lease(
  p_owner_id uuid,
  p_brief text,
  p_design_name text,
  p_vehicle jsonb,
  p_harness text default 'panel-proof-probe',
  p_lease_seconds integer default 2700
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid := pg_catalog.gen_random_uuid();
  v_generation_id uuid := pg_catalog.gen_random_uuid();
  v_claim_token uuid := pg_catalog.gen_random_uuid();
  v_input jsonb;
  v_engine jsonb;
  v_input_hash text;
begin
  if p_owner_id is null then
    raise exception 'harness_lease_owner_required';
  end if;
  -- A harness row is still a real calls-1-7 input; the v3 validator runs on it.
  v_input := pg_catalog.jsonb_build_object(
    'contractVersion', 'designpro.calls-1-7-input.v3',
    'pipelineMode', 'flat-first-atlas-v1',
    'vehicle', p_vehicle,
    'brief', p_brief,
    'designName', p_design_name,
    'mode', 'commercial'
  );
  v_engine := designpro_private.calls_1_7_engine_contract();
  -- `digest` is pgcrypto and lives in `extensions`, not pg_catalog; the
  -- built-in `sha256(bytea)` is the same hash with no extension dependency.
  v_input_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_input::text,'UTF8')),'hex');

  insert into public.designpro_generation_requests (
    id, generation_id, owner_id, tenant_key, idempotency_key,
    state, request_input, input_hash,
    engine_contract, engine_contract_hash,
    attempt, available_at, lease_owner, lease_token, lease_expires_at, error
  ) values (
    v_request_id, v_generation_id, p_owner_id, 'user_' || p_owner_id::text,
    -- `designpro_generation_request_identity` DERIVES this key; it is not
    -- free-form. A v2/v3 input must read 'calls17:<generationId>:<inputHash>'.
    'calls17:' || v_generation_id::text || ':' || v_input_hash,
    'leased', v_input, v_input_hash,
    v_engine,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_engine::text,'UTF8')),'hex'),
    1, pg_catalog.now(), p_harness, v_claim_token,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    pg_catalog.jsonb_build_object(
      'code', 'designiq_ab_harness_lease',
      'note', p_harness || '; harness-only row, never a customer generation')
  );

  return pg_catalog.jsonb_build_object(
    'requestId', v_request_id,
    'generationId', v_generation_id,
    'claimToken', v_claim_token
  );
end
$$;

revoke all on function public.mint_designpro_harness_lease(uuid, text, text, jsonb, text, integer) from public;
grant execute on function public.mint_designpro_harness_lease(uuid, text, text, jsonb, text, integer) to service_role;
