import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260821200000_designpro_design_first_production_handoff.sql",
  import.meta.url,
), "utf8");

function functionBody(signature, nextMarker) {
  const start = migration.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = nextMarker ? migration.indexOf(nextMarker, start + signature.length) : migration.length;
  assert.notEqual(end, -1, `missing boundary ${nextMarker}`);
  return migration.slice(start, end);
}

test("normal v2 freezes an honest unbound revision while v3/A.T.L.A.S. stays excluded", () => {
  const handoff = functionBody(
    "CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production",
    "-- A paid product is visible",
  );
  assert.match(handoff, /v_input_contract NOT IN \(\s*'designpro\.calls-1-7-input\.v1','designpro\.calls-1-7-input\.v2'/);
  assert.match(handoff, /generation_contract_not_production_eligible/);
  assert.match(handoff, /'sourceInputContract','designpro\.calls-1-7-input\.v2'/);
  assert.match(handoff, /'contractVersion','designpro\.fulfillment-state\.v1',\s*'state','unbound'/);
  assert.doesNotMatch(
    handoff.slice(handoff.indexOf("ELSE\n    IF v_design_name")),
    /v_recipient\.order_number|v_recipient\.recipient_identity_hash/,
  );
  assert.doesNotMatch(handoff, /calls-1-7-input\.v3|flat-first-atlas-v1/);
});

test("unbound insertion is proven against the exact completed v2 request and seven active views", () => {
  const verifier = functionBody(
    "CREATE OR REPLACE FUNCTION designpro_private.verify_revision_delivery_binding",
    "-- One internal resolver",
  );
  for (const marker of [
    "v_request.state IS DISTINCT FROM 'outputs_ready'",
    "'designpro.calls-1-7-input.v2'",
    "v_request.engine_receipt->>'handoffRevisionId'",
    "designpro_private.calls_1_7_handoff_state(v_request.id)",
    "view_row.superseded_at IS NULL",
    "v_matching_views<>7",
    "design_first_handoff_views_do_not_match_generation",
  ]) assert.ok(verifier.includes(marker), marker);
  assert.match(verifier, /NEW\.snapshot \?\| ARRAY\['orderNumber','delivery'\]/);
  const genericSave = functionBody(
    "CREATE OR REPLACE FUNCTION public.save_designpro_revision_source",
    "-- Rebuild the handoff",
  );
  assert.match(genericSave, /p_snapshot#>>'\{fulfillment,state\}'='unbound'[\s\S]*design_first_handoff_rpc_required/);
  assert.match(migration, /Direct insertion is intentional:[\s\S]*INSERT INTO public\.designpro_revision_sources/);
});

test("handoff replay repairs the workflow instead of returning early", () => {
  const handoff = functionBody(
    "CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production",
    "-- A paid product is visible",
  );
  const existing = handoff.slice(
    handoff.indexOf("SELECT * INTO v_existing"),
    handoff.indexOf("-- ALWAYS run the idempotent workflow creation"),
  );
  assert.match(existing, /generation_handoff_identity_conflict/);
  assert.doesNotMatch(existing, /RETURN pg_catalog\.jsonb_build_object/);
  assert.match(handoff, /v_workflow:=public\.create_designpro_entice_workflow/);
  assert.match(handoff, /'workflowRunId',v_workflow->>'workflowRunId'/);
  assert.match(handoff, /'alreadyHandedOff',v_already_handed_off/);
  assert.match(handoff, /v_source_time:=COALESCE\(\s*v_row\.completed_at/);
  assert.doesNotMatch(handoff, /save_designpro_revision_source\([\s\S]{0,200}clock_timestamp\(\)/);
});

test("fulfillment late binding is private, append-only, owner-scoped, and exact-idempotent", () => {
  const binding = functionBody(
    "CREATE OR REPLACE FUNCTION public.bind_designpro_revision_fulfillment",
    "-- Rebuild the handoff",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS designpro_private\.revision_fulfillment_bindings/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON designpro_private\.revision_fulfillment_bindings/);
  assert.match(migration, /REVOKE ALL ON designpro_private\.revision_fulfillment_bindings\s+FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(binding, /v_source\.owner_id IS DISTINCT FROM v_owner/);
  assert.match(binding, /q\.user_id=v_owner AND q\.can_operate/);
  assert.match(binding, /customer_user\.email_confirmed_at IS NOT NULL/);
  assert.match(binding, /revision_fulfillment_identity_conflict/);
  assert.match(binding, /'idempotent',true/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.bind_designpro_revision_fulfillment\(\s*uuid,text,text,text\s*\) TO authenticated/);
  assert.doesNotMatch(binding, /UPDATE designpro_private\.revision_fulfillment_bindings/);
});

test("paid work cannot see an entitlement or release until fulfillment is bound", () => {
  const paid = functionBody(
    "CREATE OR REPLACE FUNCTION public.designpro_paid_products",
    "-- Freeze the resolved binding",
  );
  const reconcile = functionBody(
    "CREATE OR REPLACE FUNCTION public.reconcile_designpro_purchase_gates",
    "-- Once a production run",
  );
  assert.match(paid, /designpro_private\.revision_fulfillment\(entice\.revision_id\) IS NOT NULL/);
  assert.match(reconcile, /designpro_private\.revision_fulfillment\(r\.revision_id\) fulfillment/);
  assert.match(reconcile, /'fulfillment',ready\.fulfillment/);
  assert.match(reconcile, /s\.stage_key='await_purchase'/);
  assert.match(reconcile, /r\.input#>>'\{fulfillment,bindingHash\}' ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(reconcile, /r\.input->'fulfillment' IS NOT DISTINCT FROM\s+designpro_private\.revision_fulfillment\(r\.revision_id\)/);
  assert.match(migration, /OLD\.input \? 'fulfillment'[\s\S]*designpro_workflow_identity_is_immutable/);
});

test("the patch changes no Call 8-11 stage implementation or A.T.L.A.S. object", () => {
  for (const forbidden of [
    "designpro_flat_atlas_revisions",
    "claim_designpro_flat_atlas_authoring",
    "flat_first_atlas",
    "proof.build' THEN",
    "panels.build' THEN",
    "logos.extract' THEN",
    "panels.delogo' THEN",
  ]) assert.ok(!migration.includes(forbidden), forbidden);
  assert.equal(
    migration.match(/create_designpro_entice_workflow/g)?.length,
    2,
    "the handoff should call and comment on the existing conductor, never define another",
  );
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.create_designpro_entice_workflow/);
});
