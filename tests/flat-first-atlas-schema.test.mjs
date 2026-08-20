import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL(
  "../supabase/migrations/20260820100000_designpro_flat_first_atlas_v1.sql",
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
