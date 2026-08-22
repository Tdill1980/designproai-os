import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL(
  "../supabase/migrations/20260820100000_designpro_flat_first_atlas_v1.sql",
  import.meta.url,
), "utf8");
const paritySql = readFileSync(new URL(
  "../supabase/migrations/20260821120000_designpro_generation_input_parity_and_atlas_preview.sql",
  import.meta.url,
), "utf8");
const regenerationSql = readFileSync(new URL(
  "../supabase/migrations/20260822070000_designpro_refuse_atlas_view_regeneration.sql",
  import.meta.url,
), "utf8");
const ownerReadGuardSql = readFileSync(new URL(
  "../supabase/migrations/20260822080000_designpro_guard_atlas_owner_reads.sql",
  import.meta.url,
), "utf8");
const closeupBoundarySql = readFileSync(new URL(
  "../supabase/migrations/20260822090000_designpro_closeup_schema_boundaries.sql",
  import.meta.url,
), "utf8");

test("flat-first is an exact opt-in v3 contract with a separate intake RPC", () => {
  assert.match(sql, /calls_1_7_input_v3_valid/);
  assert.match(sql, /contractVersion'='designpro\.calls-1-7-input\.v3'/);
  assert.match(sql, /pipelineMode'='flat-first-atlas-v1'/);
  assert.match(sql, /calls_1_7_input_v2_valid\(request_input\)/);
  assert.match(sql, /contractVersion'='designpro\.calls-1-7-input\.v1'/);
  assert.match(sql, /create_designpro_flat_first_generation_request/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.create_designpro_generation_request/);
});

test("the owner-callable regeneration RPC refuses exact Atlas v3 before any mutation", () => {
  assert.match(
    regenerationSql,
    /request_input->>'contractVersion'='designpro\.calls-1-7-input\.v3'[\s\S]*request_input->>'pipelineMode'='flat-first-atlas-v1'[\s\S]*RAISE EXCEPTION 'flat_first_atlas_new_run_required'/,
  );
  const guard = regenerationSql.indexOf("RAISE EXCEPTION 'flat_first_atlas_new_run_required'");
  const firstViewMutation = regenerationSql.indexOf("UPDATE public.designpro_generation_views");
  assert.ok(guard > 0 && firstViewMutation > guard, "Atlas guard must run before superseding a view");
  assert.match(
    regenerationSql,
    /GRANT EXECUTE ON FUNCTION public\.regenerate_designpro_generation_slot\(uuid,text,text\)[\s\S]*TO authenticated, service_role/,
  );
});

test("terminal Atlas owner reads require exact seven current roles and one audited lineage", () => {
  assert.match(ownerReadGuardSql, /flat_first_atlas_view_set_valid/);
  assert.match(ownerReadGuardSql, /v_count=7[\s\S]*v_source_count=7[\s\S]*v_role_count=7[\s\S]*v_hash_count=7[\s\S]*v_valid_count=7/);
  for (const identity of [
    "'side','passenger-side','hood_detail','front','rear','close-up','roof'",
    "designpro.atlas-designpanel-server-provider.v1",
    "designpro.generation-artifact-audit.v1",
    "designpro.studio-os.port-ab0f0638.v1",
    "designpro.view-angles-os.port-ab0f0638.v1",
    "designpro.photorealism-prompt.port.v1",
    "designpro.atlas-proof-semantic-qc.v1",
    "designpro.flat-first-atlas.v1",
    "producePassengerView",
    "deterministicMirror",
    "driverContentHash",
    "designpro-flat-first-atlas-20260822.v4",
    "designpro.atlas-master-semantic-qc.v1",
    "designpro.flat-first-master-provider.v1",
    "designpanel-ai-generate.artboard.20260822.v1",
    "masterQcPassed",
    "masterQcConfidence",
    "masterPromptHash",
    "masterExampleSetHash",
    "designpro.flat-first-atlas-view-authority.v1",
    "atlasZoneContentHash",
    "atlasZoneSurfaceKey",
    "authorityHash",
    "zoneHash",
    "zoneSurfaceKey",
    "zoneContentHash",
    "atlasZonePassedToPassengerRepair",
  ]) assert.match(ownerReadGuardSql, new RegExp(identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(
    ownerReadGuardSql.match(/v\.source_view_type IN \([\s\S]*?\)/)?.[0] || "",
    /hero-3d/,
  );
});

test("invalid terminal Atlas status and signed-view reads fail with one typed new-run code", () => {
  assert.match(
    ownerReadGuardSql,
    /state IN \('outputs_ready','failed','cancelled'\)[\s\S]*flat_first_atlas_view_set_valid/,
  );
  assert.match(
    ownerReadGuardSql,
    /CREATE OR REPLACE FUNCTION public\.get_designpro_generation_request[\s\S]*'failureCode',CASE WHEN v_new_run[\s\S]*'flat_first_atlas_new_run_required'[\s\S]*'views',v_views/,
  );
  assert.match(
    ownerReadGuardSql,
    /CREATE OR REPLACE FUNCTION public\.designpro_generation_view_paths[\s\S]*flat_first_atlas_requires_new_run[\s\S]*RAISE EXCEPTION 'flat_first_atlas_new_run_required'[\s\S]*SELECT COALESCE/,
  );
  assert.match(ownerReadGuardSql, /v_views:='\[\]'::jsonb/);
  assert.match(
    closeupBoundarySql,
    /CREATE OR REPLACE FUNCTION public\.designpro_flat_atlas_revision_paths[\s\S]*flat_first_atlas_requires_new_run[\s\S]*RAISE EXCEPTION 'flat_first_atlas_new_run_required'[\s\S]*'guideStoragePath'/,
  );
});

test("new revision writes require Close-Up while immutable Hero remains read/retry provenance", () => {
  const trigger = closeupBoundarySql.match(
    /CREATE OR REPLACE FUNCTION designpro_private\.verify_revision_render_assets\(\)[\s\S]*?\n\$fn\$;/,
  )?.[0] || "";
  assert.match(trigger, /'driver','passenger','hood','roof','front','rear','closeup'/);
  assert.doesNotMatch(trigger, /hero3d/);

  assert.match(closeupBoundarySql, /complete_designpro_stage/);
  assert.match(closeupBoundarySql, /FROM public\.designpro_revision_sources frozen/);
  assert.match(closeupBoundarySql, /frozen\.revision_id=v_run\.revision_id/);
  assert.match(closeupBoundarySql, /frozen\.owner_id=v_run\.owner_id/);
  assert.match(closeupBoundarySql, /frozen\.snapshot_hash=v_run\.revision_snapshot_hash/);
  assert.match(closeupBoundarySql, /frozen\.snapshot->'renderAssets' \? 'hero3d'/);
  assert.match(closeupBoundarySql, /NOT frozen\.snapshot->'renderAssets' \? 'closeup'/);

  const readPolicy = closeupBoundarySql.match(
    /CREATE POLICY designpro_owner_read_wrap_files[\s\S]*?\n\);/,
  )?.[0] || "";
  const insertPolicy = closeupBoundarySql.match(
    /CREATE POLICY designpro_owner_insert_revision_inputs[\s\S]*?\n\);/,
  )?.[0] || "";
  assert.match(readPolicy, /'closeup','hero3d','logo'/);
  assert.match(insertPolicy, /'closeup','logo'/);
  assert.doesNotMatch(insertPolicy, /hero3d/);
});

test("one immutable atlas row binds before guide, manifest, after master and lineage", () => {
  for (const column of [
    "guide_storage_path", "guide_content_hash", "manifest_storage_path",
    "manifest_content_hash", "master_storage_path", "master_content_hash",
    "parent_revision_id", "revision_sequence", "effective_ppi",
    "production_eligible", "affected_surfaces", "prompt_version",
  ]) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.match(sql, /flat-first\/v1\/%/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.designpro_flat_atlas_revisions/);
  assert.match(sql, /flat_atlas_revision_lineage_invalid/);
  assert.match(sql, /UNIQUE\(request_id,revision_sequence\)/);
  assert.doesNotMatch(sql, /UNIQUE\(request_id,guide_storage_path\)/,
    "later atlas revisions must be able to reuse the same immutable guide");
  assert.doesNotMatch(sql, /UNIQUE\(request_id,manifest_storage_path\)/,
    "later atlas revisions must be able to reuse the same immutable geometry manifest");
});

test("owner reads are RLS-bound and preview paths come only from an owner-checking RPC", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FOR SELECT TO authenticated[\s\S]*auth\.uid\(\)\)=owner_id/);
  assert.match(sql, /designpro_flat_atlas_revision_paths/);
  assert.match(sql, /v_request\.owner_id IS DISTINCT FROM auth\.uid\(\)[\s\S]*THEN RETURN NULL/);
  assert.match(sql, /REVOKE ALL ON public\.designpro_flat_atlas_revisions/);
  assert.match(sql, /GRANT SELECT ON public\.designpro_flat_atlas_revisions TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|UPDATE|DELETE).*designpro_flat_atlas_revisions TO authenticated/i);
});

test("proof conditioning has its own immutable JPEG identity without replacing the master", () => {
  const revisionTable = sql.match(
    /CREATE TABLE public\.designpro_flat_atlas_revisions \([\s\S]*?\n\);/,
  )?.[0] || "";
  const exampleTable = sql.match(
    /CREATE TABLE public\.designpro_flat_atlas_examples \([\s\S]*?\n\);/,
  )?.[0] || "";
  for (const column of [
    "projection_storage_path", "projection_content_hash",
    "projection_byte_size", "projection_content_type",
  ]) assert.match(revisionTable, new RegExp(`\\b${column}\\b`));
  assert.doesNotMatch(exampleTable, /\bprojection_storage_path\b/,
    "topology examples do not own a per-request Gemini transport derivative");
  assert.match(revisionTable, /projection_content_type='image\/jpeg'/);
  assert.match(revisionTable, /projection_byte_size BETWEEN 1 AND 12582912/);
  assert.match(revisionTable, /flat-first\/v1\/revisions\/'\|\|revision_sequence::text[\s\S]*\/master\/'\|\|master_content_hash/);
  assert.match(revisionTable, /flat-first\/v1\/revisions\/'\|\|revision_sequence::text[\s\S]*\/projection\/'\|\|projection_content_hash\|\|'\.jpg'/);
  assert.match(sql, /'projectionStoragePath',r\.projection_storage_path/);
  assert.match(sql, /'projectionContentHash',r\.projection_content_hash/);
  assert.match(sql, /Production[\s\S]{0,160}canonical master_content_hash/);
  assert.doesNotMatch(sql, /production_eligible[^\n]*projection/i);
});

test("owner atlas reads derive the six-panel schedule from the immutable manifest", () => {
  assert.match(sql, /'panelMap',r\.manifest->'zones'/);
  assert.doesNotMatch(sql, /panel_map\s+jsonb/i);
});

test("global examples are unseeded, service-only and topology-only", () => {
  assert.match(sql, /purpose='topology-only'/);
  assert.match(sql, /Customer style, palette, brand and design prompts are explicitly outside/);
  assert.match(sql, /designpro_active_flat_atlas_examples/);
  assert.match(sql, /WITH \(security_invoker=true\)/);
  assert.doesNotMatch(sql, /INSERT INTO public\.designpro_flat_atlas_examples/i);
  assert.doesNotMatch(sql, /GRANT .*designpro_flat_atlas_examples TO authenticated/i);
});

test("flat-first cannot enter production until the immutable latest revision is eligible", () => {
  assert.match(sql, /designpro_flat_first_handoff_gate/);
  assert.match(sql, /ORDER BY revision_sequence DESC LIMIT 1/);
  assert.match(sql, /'productionEligible',COALESCE\(v_atlas\.production_eligible,false\)/);
});

test("Atlas previews are owner-readable only through exact immutable guide/master rows", () => {
  const policy = paritySql.match(
    /CREATE POLICY designpro_owner_read_flat_atlas_previews[\s\S]*?\n  \);/,
  )?.[0] || "";
  assert.match(policy, /ON storage\.objects/);
  assert.match(policy, /FOR SELECT\s+TO authenticated/);
  assert.match(policy, /bucket_id='wrap-files'/);
  assert.match(policy, /storage\.allow_only_operation\('object\.sign'\)/);
  assert.match(policy, /FROM public\.designpro_flat_atlas_revisions revision/);
  assert.match(policy, /revision\.owner_id=\(SELECT auth\.uid\(\)\)/);
  assert.match(policy, /storage\.objects\.name=revision\.guide_storage_path/);
  assert.match(policy, /storage\.objects\.name=revision\.master_storage_path/);
  assert.doesNotMatch(policy, /manifest_storage_path|projection_storage_path/);
  assert.doesNotMatch(policy, /object\.list|allow_any_operation|get_authenticated/);
  assert.doesNotMatch(policy, /FOR (?:INSERT|UPDATE|DELETE)/);
});

test("Calls 1-7 v2/v3 keep a closed bounded DesignIQ input contract", () => {
  for (const field of [
    "finish", "substrate", "mascot", "bulletPoints", "brandColors",
    "fontStyle", "qrEnabled", "qrUrl", "visionBoardImages",
    "visionboardIntent", "styleDescriptors", "textLayerPrompt",
  ]) assert.match(paritySql, new RegExp(`'${field}'`));
  assert.match(paritySql, /calls_1_7_input_v2_valid[\s\S]*?p_input - ARRAY\[/);
  assert.match(paritySql, /calls_1_7_input_v3_valid[\s\S]*?p_input - ARRAY\[/);
  assert.match(paritySql, /pipelineMode'='flat-first-atlas-v1'/);
  assert.match(paritySql, /NOT designpro_private\.generation_input_has_server_controls\(p_input\)/);
  assert.match(paritySql, /'style_inspiration','exact_reference','artboard_projection'/);
});

test("VisionBoard identities are verified object identities, never raw reference URLs", () => {
  const identityValidator = paritySql.match(
    /CREATE OR REPLACE FUNCTION designpro_private\.calls_1_7_asset_identity_valid[\s\S]*?\$fn\$;/,
  )?.[0] || "";
  assert.match(identityValidator, /'storagePath','contentHash','byteSize','contentType'/);
  assert.match(identityValidator, /p_asset - ARRAY\[/);
  assert.match(identityValidator, /inputs\/\(logo\|attachment\)\//);
  assert.match(
    identityValidator,
    /revisions\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\//,
    "asset paths must accept a complete 8-4-4-4-12 generation UUID",
  );
  assert.match(identityValidator, /p_asset->>'contentHash' !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(paritySql, /jsonb_array_length\(p_input->'visionBoardImages'\)>6/);
  assert.match(paritySql, /identity\.value,'attachment'/);
  assert.doesNotMatch(identityValidator, /\?'url'|\?'signedUrl'|->>'url'|->>'signedUrl'/);
  assert.doesNotMatch(identityValidator, /application\/pdf/,
    "Calls 1-7 must not accept a logo format the runtime image decoder cannot open");
  assert.match(paritySql, /calls_1_7_asset_paths_bound\(jsonb,uuid,uuid\)/);
  assert.match(paritySql, /NEW\.request_input,NEW\.owner_id,NEW\.generation_id/);
  assert.match(paritySql, /generation_asset_owner_generation_mismatch/);
});

test("Atlas master authoring is fenced once by the current service lease", () => {
  assert.match(paritySql, /CREATE TABLE designpro_private\.flat_atlas_authoring_fences/);
  assert.match(paritySql, /request_id uuid PRIMARY KEY/);
  assert.match(paritySql, /claim_designpro_flat_atlas_authoring/);
  assert.match(paritySql, /v_request\.state<>'leased'/);
  assert.match(paritySql, /v_request\.lease_token IS DISTINCT FROM p_claim_token/);
  assert.match(paritySql, /ON CONFLICT\(request_id\) DO NOTHING/);
  assert.match(paritySql, /RETURN v_inserted=1/);
  assert.match(paritySql, /GRANT EXECUTE ON FUNCTION public\.claim_designpro_flat_atlas_authoring\(uuid,uuid\)[\s\S]*TO service_role/);
  assert.doesNotMatch(paritySql, /GRANT EXECUTE ON FUNCTION public\.claim_designpro_flat_atlas_authoring\(uuid,uuid\)[\s\S]{0,80}TO authenticated/);
});
