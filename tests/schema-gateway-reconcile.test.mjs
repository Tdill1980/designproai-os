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
  assert.deepEqual(names.slice(-38), [
    "20260812170000_designpro_generation_attempts.sql",
    "20260813190000_designpro_design_master_revisions.sql",
    // The slot-lease layer the Calls 1-7 store calls, then the completion RPC
    // rewritten to validate in place rather than delete and re-insert.
    "20260814050000_designpro_generation_slot_leases.sql",
    "20260814050100_designpro_generation_complete_validates_in_place.sql",
    "20260814060000_designpro_generation_hero3d_and_handoff.sql",
    "20260814070000_designpro_generation_view_supersession.sql",
    "20260814140000_designpro_generation_view_paths_privilege.sql",
    "20260814150000_designpro_generation_owner_read_returns_null.sql",
    "20260814160000_designpro_owner_reads_generation_views.sql",
    // Call 11 schedules the de-logo duplicate set. It lands AFTER the runner
    // that understands panels.delogo, so the database never schedules a stage
    // the live runner has not learned.
    "20260817060000_designpro_call11_qc_panels.sql",
    // The proven-implementation schema/data contract for the migrated
    // DesignPro edge functions and worker (owner decision, PR #73).
    "20260817230000_designpro_functions_contract.sql",
    // The Commercial identity carrier: companyName/phone/website and the
    // verified logo upload reach the frozen snapshot as structured fields
    // instead of being reduced to request_input.brief, and the logo
    // attestation states what is true rather than asserting mode:"none" on
    // every job.
    "20260818173000_designpro_carry_commercial_identity.sql",
    // Purchase entitlements. Calls 8-11 prepare automatically and free; the
    // Production Pack and the Logo Pack are separate purchases, and paid
    // fulfillment starts from a confirmed one rather than from preparation
    // finishing.
    "20260818210000_designpro_purchase_entitlements.sql",
    "20260819180000_designpro_calls_1_7_design_first_v2.sql",
    "20260820100000_designpro_flat_first_atlas_v1.sql",
    "20260821120000_designpro_generation_input_parity_and_atlas_preview.sql",
    // Normal v2 may now freeze an explicitly unbound revision and enter the
    // existing Calls 8-11 workflow. Fulfillment stays append-only and cannot
    // release paid production until an exact recipient/order binding exists.
    "20260821200000_designpro_design_first_production_handoff.sql",
    // Close-Up is restored as the active seventh proof. Historical hero3d
    // revisions remain readable and handoff-compatible without relabelling.
    "20260822060000_designpro_restore_closeup_seventh_view.sql",
    // Per-view replacement cannot preserve an immutable Atlas proof graph, so
    // the owner-callable RPC now fails closed before mutating any Atlas slot.
    "20260822070000_designpro_refuse_atlas_view_regeneration.sql",
    // Terminal Atlas proof sets are owner-readable only when the exact current
    // seven roles prove one master/Driver lineage plus audit and semantic QC.
    "20260822080000_designpro_guard_atlas_owner_reads.sql",
    // Every revision/Storage/freeze boundary accepts active Close-Up or one
    // immutable historical Hero set, and legacy Atlas master preview is fenced.
    "20260822090000_designpro_closeup_schema_boundaries.sql",
    // Fresh zero-artifact failures retain their actual QC code. Any persisted
    // Atlas master/proof identity remains under the original quarantine.
    "20260822100000_designpro_preserve_fresh_atlas_failure.sql",
    // The A.T.L.A.S. split path is wired to the ONE existing file-output
    // pipeline. The handoff gate now reads canonical-master acceptance; the
    // atlas layout-geometry flag stays false and stays separately reportable.
    "20260823220000_designpro_atlas_production_handoff.sql",
    // The installer cuts the wheel opening out of a finished panel, so the
    // master has to carry artwork there. v4 masters could punch it out.
    "20260823230000_designpro_atlas_solid_panel_prompt.sql",
    // GENIE moves behind the purchase gate: the free half needs no validated
    // production geometry, because Call 1 already sized and cut the panels.
    "20260824000000_designpro_genie_deploys_on_order.sql",
    // The seam carries the Call-1 panels: RevisionStudio entices with them and
    // PanelPro Studio is served the same bytes.
    "20260824010000_designpro_carry_call1_panels.sql",
    "20260824020000_designpro_bind_dimension_manifest.sql",
    "20260824030000_designpro_atlas_by_generation.sql",
    "20260824040000_designpro_call12_heavy_lease.sql",
    "20260824050000_designpro_promotion_codes.sql",
    // Call 1 stops being shown a photograph of a vehicle. v5 attached the
    // finished 3D proof captioned "do not return a vehicle image", and the model
    // drew the van anyway -- wheel arches punched into the sheet.
    "20260824180000_designpro_atlas_flat_sheet_prompt_v6.sql",
    // The audited human correction path. A designer who finds a panel does not
    // fit the real vehicle template records the corrected file against that
    // exact surface and revision; the branded Call 9 panel is left byte-for-byte
    // and stays what source.verify counts.
    "20260825000000_designpro_panelpro_corrected_panels.sql",
    // A.T.L.A.S. enters the production handoff. 20260823220000 opened the gate,
    // but the handoff function itself still raised
    // generation_contract_not_production_eligible on v3, so the gate opened onto
    // a closed door and no atlas master ever reached manufacturing.
    "20260825120000_designpro_atlas_enters_handoff.sql",
    // ...and the three revision-source gates behind that door -- the snapshot
    // CHECK, the delivery-binding trigger, and the WrapBox fulfillment bind --
    // each of which required the v2 contract by literal string equality.
    "20260825121000_designpro_atlas_revision_source_admitted.sql",
    // The design authority's thirteen-point template check, per surface,
    // recorded against the exact file inspected rather than against the surface.
    "20260825140000_designpro_surface_human_qc.sql",
    // The authoring model stops being shown the surface names, so masters
    // authored while it was must not satisfy the current contract.
    "20260825190000_designpro_atlas_authoring_guide_prompt_v7.sql",
    // Six sibling surfaces: the seam no longer mandates that Passenger be a
    // mirror of an accepted Driver, and refuses any view that carries a
    // Driver reference at all.
    "20260826000000_designpro_atlas_sibling_surface_proofs.sql",
    // The runtime was taught the A.T.L.A.S. manufacturing path and the stage
    // contract was not, so proof.build rejected the deferral and the run died
    // before a single panel, logo, pack or QC row existed.
    "20260826010000_designpro_atlas_stage_contract.sql",
  ]);
  // Call 11 sits between Call 10 and pack.verify, so the QC duplicates exist
  // before the pack is sealed and handed to the PanelPro preflight gate.
  const call11 = readFileSync(new URL("20260817060000_designpro_call11_qc_panels.sql", migrationsDir), "utf8");
  assert.match(call11, /'logos\.extract','panels\.delogo',\s*\n?\s*'pack\.verify'/);
  assert.match(call11, /'call11\.qc-panels'/);
  assert.match(call11, /'panel','qc-panel'/);
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
