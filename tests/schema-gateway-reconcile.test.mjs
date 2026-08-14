import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"))
  .join("\n");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const web = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8")
  + readFileSync(new URL("../web/src/api.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("ordered migration chain includes WrapBox, reconciliation, the isolated Calls 1-7 adapter, then the legacy 2D-proof retirement", () => {
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(names.slice(-12), [
    "20260806181100_designpro_wrapbox_delivery_closure.sql",
    "20260806181200_designpro_schema_gateway_reconcile.sql",
    "20260808024500_designpro_calls_1_7_adapter.sql",
    "20260812120000_designpro_retire_legacy_2d_proof.sql",
    "20260812140000_designpro_call12_topaz_enhance.sql",
    "20260812170000_designpro_generation_attempts.sql",
    "20260813190000_designpro_design_master_revisions.sql",
    // The slot-lease layer the Calls 1-7 store calls, then the completion RPC
    // rewritten to validate in place rather than delete and re-insert.
    "20260814050000_designpro_generation_slot_leases.sql",
    "20260814050100_designpro_generation_complete_validates_in_place.sql",
    "20260814060000_designpro_generation_hero3d_and_handoff.sql",
    "20260814070000_designpro_generation_view_supersession.sql",
    "20260814140000_designpro_generation_view_paths_privilege.sql",
  ]);
  // Call 12 must sit before output.build, or the enhancement would be applied
  // to files that were already interpolated up to print size.
  const call12 = readFileSync(new URL("20260812140000_designpro_call12_topaz_enhance.sql", migrationsDir), "utf8");
  assert.match(call12, /'await_panelpro_preflight_qc','enhance\.upscale','output\.build'/);
  assert.match(call12, /'call12\.topaz-upscale'/);
  assert.match(call12, /'upscaled-panel'/);
  // Calls 1-7 hand over seven renders and nothing else. The 2D proof is Call 8
  // and belongs to this system, so the legacy proof function must not be
  // sanctioned by the engine contract the retirement migration installs.
  const retirement = readFileSync(new URL("20260812120000_designpro_retire_legacy_2d_proof.sql", migrationsDir), "utf8");
  assert.match(retirement, /designpro\.calls-1-7-engine\.v2/);
  assert.match(retirement, /'retiredBlobs'[\s\S]{0,120}generate-2d-proof/);
  assert.doesNotMatch(retirement, /'generate-2d-proof','[0-9a-f]{40}'/);
});

test("production-heavy stages share one DB-owned race fence with expiry and exact-token release", () => {
  for (const marker of [
    "designpro_private.heavy_stage_leases",
    "pg_advisory_xact_lock",
    "designpro.heavy-stage:production-heavy",
    "s.stage_key NOT IN ('output.build','output.verify','zip.build')",
    "designpro_output_build_singleton_lease",
    "lease_expires_at <= clock_timestamp()",
    "acquire_designpro_heavy_lease",
    "release_designpro_heavy_lease",
  ]) assert.match(migrations, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("output verification is the exact byte-verified 6 x 3 production matrix", () => {
  for (const marker of [
    "designpro.output-verification.v1",
    "[\"driver\",\"passenger\",\"hood\",\"roof\",\"front\",\"rear\"]",
    "[\"png\",\"tiff\",\"eps\"]",
    "fullScalePixelsPerInch",
    "fullScaleBleedInchesPerEdge",
    "verified_output_artifact_ledger_mismatch",
  ]) assert.ok(migrations.includes(marker), marker);
});

test("preflight text lock and repeated logo placement identity are fail-closed", () => {
  assert.match(migrations, /textLockVerified/);
  assert.match(gateway + web, /textLockVerified/);
  for (const marker of ["placementKey", "targetSurfaceKey", "sourceRegionHash", "identityKey.*@.*surfaceKey"]) {
    assert.match(migrations + gateway + web, new RegExp(marker, "s"));
  }
  assert.match(migrations, /artifact->>'surfaceKey'=expected->>'placementKey'/);
  assert.match(migrations, /metadata,targetSurfaceKey/);
});

test("operator UX resolves a confirmed email into a private stable customer binding", () => {
  assert.match(migrations, /register_designpro_operator_wrapbox_recipient/);
  assert.match(migrations, /confirmed_designpro_operator_required/);
  assert.match(migrations, /business_customer_bindings/);
  assert.match(migrations, /customer_id uuid PRIMARY KEY DEFAULT extensions\.gen_random_uuid\(\)/);
  assert.match(migrations, /confirmed_customer_auth_email_required/);
  assert.match(migrations, /business_customer_binding_conflict/);
  assert.match(migrations, /designpro_customer_operator_separation/);
  assert.match(migrations, /v_customer_auth_user_id IS NOT DISTINCT FROM p_operator_id/);
  assert.match(migrations, /verification_ref_hash text NOT NULL/);
  assert.doesNotMatch(migrations, /\bverification_reference\s+text\b/i);
  assert.match(migrations, /verify_revision_delivery_binding/);
  assert.match(migrations, /registered_confirmed_delivery_binding_required/);
  assert.match(migrations, /count\(\*\)[\s\S]*jsonb_object_keys\(v_delivery\)[\s\S]*<> 6/);
  assert.match(gateway, /\/internal\/wrapbox\/recipient/);
  assert.match(gateway, /operatorId/);
  assert.match(gateway, /createHash\("sha256"\)\.update\(verificationReference, "utf8"\)\.digest\("hex"\)/);
  assert.doesNotMatch(web, /name="customerId"|name="customerAuthUserId"|name="verificationRefHash"/);
  assert.match(web, /name="customerEmail"/);
  assert.match(web, /name="customerReference"/);
  assert.match(web, /name="verificationReference"/);
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE|sb_secret_/);
  assert.doesNotMatch(web, /WORKER_SECRET|SUPABASE_SERVICE_ROLE|sb_secret_/);
});

test("canonical DesignID and required business Order # are frozen through QC, stamp, and WrapBox", () => {
  for (const marker of [
    "'DID-' || upper(substr(",
    "orderNumber",
    "immutable_design_id_and_order_number_required",
    "final_qc_evidence_or_business_identity_incomplete",
    "exact_seal_and_stamped_proof_identity_required",
    "design_id text NOT NULL",
    "order_number text NOT NULL",
  ]) assert.ok(migrations.includes(marker), marker);
  assert.match(gateway, /DID-\$\{generation\.replaceAll\("-", ""\)\.slice\(0, 8\)\.toUpperCase\(\)\}/);
  assert.match(gateway + web, /orderNumber/);
  assert.match(web, /Order #/);
  assert.match(migrations, /jsonb_array_length\(COALESCE\(p_artifacts,'\[\]'::jsonb\)\) IS DISTINCT FROM 2/);
  assert.match(migrations, /surfaceKey'='seal'[\s\S]*surfaceKey'='stamped-proof'/);
  assert.doesNotMatch(migrations, /final_qc_and_stamp_business_identity_required/);
});

test("WrapBox is authenticated, RLS-backed, and signs only exact row paths for 300 seconds", () => {
  assert.match(gateway, /designpro_wrapbox_packs/);
  assert.match(gateway, /\/api\/wrapbox/);
  assert.match(gateway, /expiresIn: 300/);
  assert.match(web, /listWrapbox/);
  assert.match(web, /getWrapboxPack/);
  assert.match(migrations, /designpro_owner_read_wrapbox_packs/);
  assert.match(migrations, /designpro_customer_read_wrapbox_delivery/);
  assert.match(migrations, /v_source_entice_run_id/);
});

test("private bucket and readiness agree on the bounded 50 GB contract", () => {
  assert.match(config, /file_size_limit = 50000000000/);
  assert.match(migrations, /50000000000/);
  assert.match(migrations, /project_global_storage_limit_gte_50gb/);
  assert.match(migrations, /tus-or-s3-multipart/);
});

test("closure remains standalone DesignPro-only", () => {
  const combined = `${migrations}\n${gateway}\n${web}`;
  for (const forbidden of ["restylepro", "railway", "slack-agent", "143.110.237.145:3100", ":8080"]) {
    assert.doesNotMatch(combined, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(web, /value="other"|value="box-truck"/);
});

