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

test("ordered migration chain retains existing production boundaries and appends output graphs and parent-bound revisions", () => {
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  // The window grows with the chain: it is anchored at
  // 20260813190000_designpro_design_master_revisions.sql, so every migration
  // appended below must widen it by one or the chain's head falls out of view
  // and the assertion convicts an unrelated file.
  assert.deepEqual(names.slice(-91), [
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
    // A new receipt kind is only real once the receipts table admits it.
    "20260826010100_designpro_allow_deferred_call8_receipt.sql",
    // v8 authoring prompt: patches the live gate's pinned version in place, so
    // the sibling-surface body it sits on is preserved rather than restated.
    "20260826020000_designpro_atlas_authoring_prompt_v8.sql",
    // The RevisionStudioIQ read path: one generation-keyed workspace RPC, the
    // six Call-1 panels on the atlas read, and design-staff visibility of a
    // generation they do not own -- on the QC membership that already gated
    // the request row.
    "20260826030000_designpro_revision_studio_surface.sql",
    // Every DesignPro generation in a window, newest first, from one table.
    "20260826040000_designpro_generation_library.sql",
    // The DesignPanel creative port moves to v2: the flat call stops being
    // told about factory glass, and the branding-composition sentence the
    // reference ends its commercial scene on is restored.
    "20260826050000_designpro_atlas_designpanel_port_v2.sql",
    // COALESCE is grammar, not a pg_catalog function -- and the aggregate that
    // carried the qualified form only evaluates it when there are views to
    // project, so it passed everywhere except the case the studio is for.
    "20260826060000_designpro_generation_workspace_coalesce.sql",
    // Five accepted proofs were invisible because the read treated the
    // fence's completeness verdict as "withhold everything" -- RULE 0.23
    // already decides the other way.
    "20260826070000_designpro_present_partial_atlas_views.sql",
    // Three-valued logic ate fifteen Standard library tiles: `? key` on a
    // NULL provider object is NULL, and NOT NULL is NULL.
    "20260826080000_designpro_library_tile_null_provider.sql",
    "20260826090000_designpro_atlas_canonical_dpag_v9.sql",
    // The v9 pin was reverted live after the owner halted the ship; v10-edge
    // is the edge-canonical Call 1 (owner directive 2026-08-27).
    "20260827010000_designpro_atlas_revert_v9_pin.sql",
    "20260827020000_designpro_atlas_v10_edge_pin.sql",
    "20260827030000_designpro_partial_view_completion.sql",
    // A policy helper is useless to the role that evaluates the policy without
    // an EXECUTE grant: has_role had none, so user_roles, user_subscriptions
    // and user_tokens all returned 42501 to every signed-in customer.
    "20260827040000_grant_has_role_execute.sql",
    // The SECOND raise site of exact_seven_generation_views_required -- a
    // post-insert re-count that 20260827030000 could not see, because it shares
    // the exception name and nothing else.
    "20260827050000_designpro_partial_completion_second_predicate.sql",
    // The FOURTH hardcoded seven, and the one that reached the customer: a
    // short view set was judged an invalid lineage, so the view READ raised.
    "20260827060000_designpro_partial_view_set_is_valid.sql",
    // The gate must read the basis the master was ACTUALLY accepted on. Taking
    // the judge off the critical path left its CONFIDENCE still gating.
    "20260827070000_designpro_gate_reads_the_acceptance_basis.sql",
    // The fifth and last all-or-nothing in this contract: Driver is the
    // PRIORITY view, not a prerequisite for the set to be readable.
    "20260827080000_designpro_a_missing_driver_is_not_an_invalid_lineage.sql",
    // Pre-dates the rest: RULE 0.15's 2026-08-26 correction moved the
    // projection onto the repaired sheet; this predicate still pinned it to the
    // authored master, so any cut-out invalidated the whole set.
    "20260827090000_designpro_projection_comes_from_the_repaired_sheet.sql",
    // The extraction branch runs ahead of the 2D proof: `panels.build` promotes
    // bytes Call 1 already cut, and it was queued behind an AI proof-sheet
    // render because the claim predicate gates on every lower sequence
    // completing.
    "20260827100000_designpro_panels_do_not_wait_for_the_proof.sql",
    // And then the chain itself dies: a stage declares its own edges, and the
    // claim reads those instead of every lower line number.
    "20260827110000_designpro_the_chain_dies.sql",
    // And logo/asset extraction stops waiting on the seventh proof: the
    // workflow that carries panels.build/logos.extract may be created on
    // A.T.L.A.S. master acceptance alone, not on all seven proofs accepted.
    "20260827120000_designpro_logo_extraction_does_not_wait_for_proofs.sql",
    // The A.T.L.A.S. identity is minted at prompt time rather than 65s later
    // when Call 1 returns, which also gives the handoff the revision id it
    // raises `generation_handoff_revision_missing` without.
    "20260827130000_designpro_atlas_identity_exists_at_prompt.sql",
    // ...and the SECOND handoff gate, which called `calls_1_7_handoff_state`
    // one line after the first gate had already been relaxed to master
    // acceptance, and re-imposed the seven-view barrier on publication.
    "20260827140000_designpro_publication_does_not_wait_for_seven_proofs.sql",
    // The DATABASE twin of `assertAtlasViewLineage`, corrected the same way
    // #238 corrected the worker: it still described the retired in-runtime
    // `generate-color-render` projection #232 replaced, so no A.T.L.A.S. run
    // could clear it however good its proofs.
    "20260828100000_designpro_db_gate_names_the_photographer.sql",
    // pack.verify required a bound GENIE dimension manifest, which RULE 0.19
    // does not resolve until after purchase -- so the FREE entice pack could
    // never be verified or activated, however complete its panels.
    "20260828110000_designpro_free_pack_needs_no_genie_manifest.sql",
    // The same leftover one layer down: designpro_run_identity_phase_check
    // required a bound manifest on a production run at INSERT, so
    // pack.activate could not create the run that waits for the purchase.
    "20260828120000_designpro_production_run_starts_before_genie.sql",
    // The same family once more, in the Call-8 receipt contract: it compared
    // totalSqFt against results->'dimensionManifest', which RULE 0.19 leaves
    // absent until purchase, so proof.build could never record a built proof.
    "20260829010000_designpro_call8_proof_uses_design_time_geometry.sql",
    // The Generation-ID OS kernel records immutable revision/run/stage history
    // without becoming a second producer or workflow authority.
    "20260829230000_designpro_generation_os_kernel.sql",
    // Artifact and verified-receipt history plus the canonical server snapshot
    // complete the same Generation-ID observability contract.
    "20260829230100_designpro_generation_os_artifact_events.sql",
    // Read compatibility is an OS invariant: an authoring prompt bump may
    // fence reuse, but it may not hide accepted A.T.L.A.S. history from the
    // owner or PanelPro Studio.
    "20260830233000_designpro_atlas_read_gate_accepts_history.sql",
    // Visual review remains visible in each proof receipt, but presentation
    // semantics no longer blocks a hash-bound Atlas descendant. Historical
    // confidence-passed rows remain readable under the old receipt shape.
    "20260831103000_designpro_atlas_proof_semantic_advisory.sql",
    "20260902120000_designpro_genie_prep.sql",
    // Call 12 completion must index the exact receipt that output.build reads.
    "20260906121000_designpro_persist_call12_receipt.sql",
    // Final QC resolves the same append-only late-fulfillment binding the
    // production runtime froze, without rewriting the design-first snapshot.
    "20260906132000_designpro_final_qc_resolves_late_fulfillment.sql",
    // Stamp completion reads the same late binding and persists all three
    // runtime-produced files, including the QC certificate ZIP requires.
    "20260906143000_designpro_stamp_certificate_and_late_fulfillment.sql",
    // Durable WrapBox publication resolves that same append-only binding;
    // design-first snapshots intentionally remain unbound and immutable.
    "20260906170000_designpro_wrapbox_resolves_late_fulfillment.sql",
    // A refused proof view, named with its reason, for the surfaces that have
    // to explain a short set. Purely additive: a new companion function beside
    // `designpro_generation_workspace`, which is deliberately not touched.
    "20260907090000_designpro_generation_refused_views.sql",
    // The separate deterministic output ledger shares the existing heavy-work
    // lease and preserves the canonical six-surface production contract.
    "20260908190825_panelpro_file_output_graph.sql",
    // Final QC pins Call 8 and all seven proof identities before stamping.
    "20260908193134_designpro_final_proof_join.sql",
    // Measured template inputs, private candidates and reviewed bank entries.
    "20260908194544_panelpro_template_lifecycle.sql",
    // Optional reviewed physical-piece output joins the existing parent pack.
    "20260908195123_designpro_panelprofile_production_attachment.sql",
    // Saved edits retain their Generation ID and existing immutable history.
    "20260908201216_designpro_parent_bound_atlas_revisions.sql",
    // Call 1 reserves separate artwork and manufacturing identities before work starts.
    "20260909062205_designpro_call1_reserved_identity.sql",
    "20260910070849_wallpro_private_projects.sql",
    // WallPro ready-to-sell catalog: library DesignID + GenerationID + master hash provenance, catalog/ storage policies.
    "20260911120000_wallpro_designs_catalog.sql",
    // WallPro design sessions: immutable versions per project, one approved version, refine in place.
    "20260911150000_wallpro_design_versions.sql",
    // Call 1 as a durable node graph (RULE 0.35 addendum, owner 2026-09-11):
    // per-surface nodes with depends_on, SKIP LOCKED claims across both
    // runtime workers, lease-gated by the generation request.
    "20260911170000_designpro_atlas_call1_graph.sql",
    // WallPro production panels: 150 PPI per-panel Topaz jobs claimed by the runtime.
    "20260911190000_wallpro_production_jobs.sql",
    // WallPro production reaches the design team: admin/tester read of projects, versions, jobs and files.
    "20260911200000_wallpro_team_production_read.sql",
    // GraphicsPro (owner 2026-09-11): graphics_pro_jobs / pricing / shop markup
    // and the public graphicspro-files bucket the recovered RestylePro product
    // reads. docs/GRAPHICSPRO-END-TO-END.md.
    "20260911210000_graphicspro_cut_contour.sql",
    // WPW WooCommerce wiring phase 1: cross-domain OTP codes for wpw-oauth-link.
    "20260912120000_wpw_link_otps.sql",
    // WallPro purchase entitlements: SKU-based Stripe purchase gate on
    // request_wallpro_production (owner ruling, 2026-09-12 pricing correction).
    "20260912130000_wallpro_purchase_entitlements.sql",
    // WPW order sync: the repeat cohort becomes measurable from this side
    // (owner, 2026-09-12: "those repeats are who we will track and optimize
    // on for a saas").
    "20260912220000_wpw_orders_sync.sql",
    // WallPanelPro Studio: the team reads the generation ledger, recovers a
    // design a timed-out browser never recorded, and QC releases it for print
    // (owner, 2026-09-12).
    "20260912230000_wallpro_panelpro_studio.sql",
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

test("a completed pre-fix Call 12 is recovered without rerunning Topaz", () => {
  assert.match(
    migrations,
    /INSERT INTO public\.designpro_stage_receipts[\s\S]*?s\.stage_key='enhance\.upscale'[\s\S]*?s\.status='completed'[\s\S]*?receiptKind":"call12\.topaz-upscale"[\s\S]*?ON CONFLICT \(stage_id\) DO NOTHING/,
  );
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
  // An authenticated owner's email is an identity, not an architectural
  // dependency. Remove only email-shaped occurrences before proving the old
  // service name, hosts, ports and agents cannot re-enter the runtime closure.
  const dependencySurface = combined.replace(/[A-Z0-9._%+-]+@restyleproai\.com/gi, "");
  for (const forbidden of ["restylepro", "railway", "slack-agent", "143.110.237.145:3100", ":8080"]) {
    assert.doesNotMatch(dependencySurface, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(web, /value="other"|value="box-truck"/);
});
