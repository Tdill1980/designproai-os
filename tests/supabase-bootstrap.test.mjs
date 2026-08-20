import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const migrationNames = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const migrations = await Promise.all(
  migrationNames.map((name) => readFile(path.join(migrationDir, name), 'utf8')),
);
const sql = migrations.join('\n');

test('fresh bootstrap contains one ordered thirty-one-migration chain', () => {
  assert.equal(migrationNames.length, 31);
  assert.deepEqual(
    migrationNames.map((name) => name.slice(0, 14)),
    [
      '20260806180000', '20260806180100', '20260806180200', '20260806180300',
      '20260806180400', '20260806180500', '20260806180600', '20260806180700',
      '20260806180800', '20260806180900', '20260806181000', '20260806181100',
      '20260806181200', '20260808024500', '20260812120000', '20260812140000', '20260812170000',
      '20260813190000',
      // The slot-lease layer generation-store.cjs calls, and the completion RPC
      // rewritten to validate the engine's rows in place instead of deleting them.
      '20260814050000', '20260814050100',
      // hero-3d seventh slot and the production handoff it unblocks.
      '20260814060000',
      // Per-view regeneration: one active view per slot, history preserved.
      '20260814070000',
      // The revoke that supersession missed: designpro_generation_view_paths
      // was left executable by PUBLIC, which is anon reach into storage paths.
      '20260814140000',
      // A non-owner read answers NULL, not a raise: the gateway turns NULL into
      // a 404, and raising only for rows that exist is an existence oracle.
      '20260814150000',
      // Storage RLS never covered the calls-1-7 subtree, so an operator could
      // not see the seven views their own generation had just produced.
      '20260814160000',
      // Call 11 schedules panels.delogo, the de-logo duplicate set that
      // PanelPro validates against vehicle templates. It lands after the
      // runner that already understands the stage.
      '20260817060000',
      // The proven-implementation schema/data contract for the migrated
      // DesignPro edge functions and worker (owner decision, PR #73).
      '20260817230000',
      // The Commercial identity carrier: the structured intake reaches the
      // frozen snapshot instead of being reduced to a brief string.
      '20260818173000',
      // The purchase gate: Calls 8-11 prepare for free, and the two
      // entitlements decide what fulfillment may spend.
      '20260818210000', '20260819180000',
      // Opt-in flat-first v3 storage and owner preview contract. v1/v2 remain
      // accepted unchanged and the legacy intake RPC is not replaced.
      '20260820100000',
    ],
  );
});

test('PostgreSQL-incompatible and deprecated role helpers are absent', () => {
  assert.doesNotMatch(sql, /jsonb_object_length/i);
  assert.doesNotMatch(sql, /auth\.role\s*\(/i);
  assert.match(sql, /COALESCE\(auth\.jwt\(\)->>'role'/);
});

test('tenant and Storage identities use the canonical three namespaces', () => {
  assert.match(sql, /v_tenant\s*:=\s*'user_'\s*\|\|\s*v_owner::text/i);
  assert.match(sql, /'users'[^]*'revisions'[^]*'inputs'/);
  assert.match(sql, /'designpro'[^]*r\.tenant_key[^]*r\.id::text/);
  assert.match(sql, /'wrapbox'[^]*r\.tenant_key[^]*r\.entice_pack_id::text[^]*r\.id::text/);
  assert.match(sql, /array_length\(storage\.foldername\(name\),1\) = 6/);
});

test('wrap-files is private, immutable for users, and owner-readable', () => {
  assert.match(sql, /VALUES\(\s*'wrap-files'[\s\S]*?false,\s*50000000000(?:\s|,)/);
  assert.match(sql, /CREATE POLICY designpro_owner_read_wrap_files/);
  assert.match(sql, /CREATE POLICY designpro_owner_insert_revision_inputs/);
  assert.match(sql, /REVOKE UPDATE, DELETE ON storage\.objects FROM authenticated/);
  assert.doesNotMatch(sql, /FOR (?:UPDATE|DELETE)\s+TO authenticated/i);
});

test('revision snapshot requires seven immutable asset identities, not URLs', () => {
  assert.match(sql, /snapshot->'renderAssets'/);
  assert.match(sql, /NOT snapshot \? 'renderUrls'/);
  for (const role of ['driver', 'passenger', 'hood', 'roof', 'front', 'rear', 'hero3d']) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
  assert.match(sql, /seven_distinct_render_asset_hashes_required/);
});

test('Universal GENIE remains candidate evidence until six exact surfaces are approved', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.designpro_vehicle_specs_universal/);
  assert.match(sql, /Estimated coverage only; never accepted as exact Call 8\/9 print geometry/);
  assert.match(sql, /designpro\.genie-validated-surfaces\.v1/);
  assert.match(sql, /ARRAY\['driver','passenger','hood','roof','front','rear'\]/);
  assert.match(sql, /six_exact_surface_pairs_required/);
  assert.match(sql, /genie_dimension_validation_required/);
  assert.match(sql, /SET status = 'retryable'/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS designpro_universal_grounded_identity_uidx/);
  assert.doesNotMatch(sql, /back_(?:width|height)[\s\S]{0,100}(?:front|rear)/i);
});

test('operator bootstrap is confirmed-user based and contains no fixed identity', () => {
  assert.match(sql, /bootstrap_operator_by_email/);
  assert.match(sql, /email_confirmed_at IS NULL/);
  assert.match(sql, /q\.can_preflight/);
  assert.doesNotMatch(sql, /INSERT INTO public\.designpro_qc_members[\s\S]{0,300}'[0-9a-f]{8}-[0-9a-f-]{27,}'/i);
});

test('QC approval identity never trusts user-editable metadata', () => {
  const qcMigration = migrations.find((migration) => migration.includes('approve_designpro_human_gate'));
  assert.doesNotMatch(qcMigration, /raw_user_meta_data/);
  assert.match(qcMigration, /raw_app_meta_data->>'display_name'/);
  assert.match(qcMigration, /email_confirmed_at IS NOT NULL/);
});

test('logo inventory has an explicit none/listed attestation and private asset identity', () => {
  assert.match(sql, /logoInventoryAttestation/);
  assert.match(sql, /explicit_logo_inventory_attestation_required/);
  assert.match(sql, /'identityKey','displayName','surfaceKey','storagePath'/);
  assert.match(sql, /\/inputs\/logo\//);
});

test('final privilege migration clears implicit execution and grants an allowlist', () => {
  const hardening = migrations.find((migration) => migration.includes('DO $hardening$'));
  assert.match(hardening, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(hardening, /ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions/);
  assert.match(hardening, /GRANT EXECUTE ON FUNCTION public\.designpro_schema_readiness\(\) TO service_role/);
  assert.doesNotMatch(hardening, /GRANT EXECUTE[^;]+\bTO\s+(?:PUBLIC|anon)\b/i);
});

test('runtime readiness starts without a seed deadlock and reports capabilities', () => {
  const readiness = migrations.find((migration) => migration.includes("'contract','designpro.runtime-readiness.v2'"));
  assert.ok(readiness);
  assert.match(readiness, /'contract','designpro\.runtime-readiness\.v2'/);
  assert.doesNotMatch(readiness, /designpro\.runtime-readiness\.v1/);
  assert.match(readiness, /'ready',pg_catalog\.jsonb_array_length\(v_missing\)=0[\s\S]*v_grounded_identity_fence[\s\S]*v_heavy_lease_fence[\s\S]*v_wrapbox_fence/);
  assert.match(readiness, /'validatedGeometrySeeded',v_dimension_seed_count>0/);
  assert.match(readiness, /'qcOperatorSeeded',v_qc_seed_count>0/);
  assert.doesNotMatch(readiness, /'ready'[^\n]+v_(?:dimension_seed_count|qc_seed_count)/);
});

test('pack activation creates production transactionally and has a crash reconciler', () => {
  assert.match(sql, /v_stage\.stage_key='pack\.activate'[\s\S]*create_designpro_production_workflow/);
  const readiness = migrations.find((migration) => migration.includes('CREATE OR REPLACE FUNCTION public.reconcile_designpro_automatic_production'));
  assert.ok(readiness);
  assert.match(readiness, /CREATE OR REPLACE FUNCTION public\.reconcile_designpro_automatic_production/);
  assert.match(readiness, /'auto-production:'\|\|v_entice\.id::text/);
  assert.match(readiness, /NOT EXISTS\([\s\S]*sourceEnticeRunId/);
  assert.match(readiness, /'createdOrConfirmed',v_count/);
});

test('output verification proves the existing immutable ledger without reinserting artifacts', () => {
  const workflow = migrations.find((migration) => migration.includes('complete_designpro_stage'));
  assert.match(workflow, /v_stage\.stage_key='output\.verify'[\s\S]*verified_output_artifact_ledger_mismatch/);
  assert.match(workflow, /COALESCE\(p_artifacts,'\[\]'::jsonb\) IS DISTINCT FROM '\[\]'::jsonb/);
  assert.match(workflow, /a\.run_id=v_run\.id AND a\.artifact_kind='output' AND a\.content_hash=lower\(h\)/);
  assert.doesNotMatch(workflow, /verified_output_artifact_required/);
});

test('local Supabase config is production-shaped without embedding secrets', async () => {
  const config = await readFile(path.join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(config, /project_id = "designproai-os-prod"/);
  assert.match(config, /major_version = 17/);
  assert.match(config, /\[storage\.buckets\."wrap-files"\][\s\S]*public = false/);
  assert.match(config, /enable_anonymous_sign_ins = false/);
  assert.doesNotMatch(config, /(?:service_role|secret|password)\s*=\s*"[^"$]+"/i);
});

test('GENIE import schema parses and does not claim verified geometry', async () => {
  const contractPath = path.join(root, 'supabase', 'contracts', 'genie-candidate-catalog.schema.json');
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  assert.equal(contract.properties.contractVersion.const, 'designpro.genie-candidate-catalog.v1');
  assert.equal(contract.$defs.candidate.properties.estimatedPanels.type, 'object');
  assert.equal(contract.$defs.candidate.properties.validatedSurfaces, undefined);
});
