import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const runtimeDir = new URL("../../runtime/", import.meta.url);
const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);

// Every table the source generation path wrote to that must never appear here,
// plus the wider set the standalone runtime contract already prohibits. If one
// of these reaches the new Calls 1-7 runtime, the old data coupling has been
// rebuilt inside the standalone system and the isolation is gone.
const FORBIDDEN_TABLES = [
  "color_visualizations", "user_roles", "vinyl_reference_images", "vinyl_swatches",
  "render_templates", "vehicle_renders", "moderation_log", "manufacturer_colors",
  "blocked_users", "panelizer_jobs", "designiq_generations", "design_version_commits",
  "production_flow_assets", "workforce_runs", "workflow_stage_runs",
];
const FORBIDDEN_HOSTS = ["kfapjdyythzyvnpdeghu", "restylepro", "143.110.237.145"];

// The Calls 1-7 runtime surface. Kept explicit so a new module has to be added
// here deliberately rather than slipping past the sweep.
const GENERATION_MODULES = ["view-angles.cjs", "generation-provider.cjs"];

function read(name) {
  return readFileSync(new URL(name, runtimeDir), "utf8");
}

/**
 * Comments are evidence, not dependencies. A module that records where it was
 * ported from, or names a table precisely to say it must never be used, is
 * documenting the boundary rather than crossing it. Only executable references
 * count.
 */
function code(name) {
  return read(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("no legacy or shared table reaches the Calls 1-7 runtime", () => {
  for (const name of GENERATION_MODULES) {
    const source = code(name);
    for (const table of FORBIDDEN_TABLES) {
      assert.doesNotMatch(source, new RegExp(`["'\`]${table}["'\`]|from\\(['"\`]${table}`),
        `${name} references the prohibited table ${table}`);
    }
    for (const host of FORBIDDEN_HOSTS) {
      assert.doesNotMatch(source, new RegExp(host, "i"), `${name} references ${host}`);
    }
  }
});

test("the sweep covers every runtime module, not just the declared list", () => {
  // A future module that touches a prohibited table must fail the build even if
  // someone forgets to add it to GENERATION_MODULES above.
  const modules = readdirSync(runtimeDir).filter((name) => name.endsWith(".cjs") || name.endsWith(".js"));
  assert.ok(modules.length >= 16, "runtime module set looks truncated");
  for (const name of modules) {
    const source = read(name);
    for (const table of FORBIDDEN_TABLES) {
      // A comment naming a table as prohibited is evidence, not a dependency.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      assert.doesNotMatch(stripped, new RegExp(`from\\(\\s*["'\`]${table}["'\`]`),
        `${name} queries the prohibited table ${table}`);
    }
  }
});

test("Calls 1-7 persists only to designpro_ objects", () => {
  const migration = readFileSync(new URL("20260812170000_designpro_generation_attempts.sql", migrationsDir), "utf8");
  const tables = [...migration.matchAll(/(?:CREATE TABLE(?: IF NOT EXISTS)?|REFERENCES|ALTER TABLE)\s+public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 0);
  for (const table of new Set(tables)) {
    assert.match(table, /^designpro_/, `migration touches non-DesignPro table ${table}`);
  }
});

test("an accepted generation slot is immutable and cannot be deleted", () => {
  const migration = readFileSync(new URL("20260812170000_designpro_generation_attempts.sql", migrationsDir), "utf8");
  // Retries may add attempts. An accepted slot's bytes are what the seven-view
  // handoff pinned and what Calls 8+ hashed, so replacing them would silently
  // invalidate every downstream receipt.
  assert.match(migration, /accepted_generation_view_is_immutable/);
  assert.match(migration, /accepted_generation_view_cannot_be_deleted/);
  assert.match(migration, /BEFORE UPDATE ON public\.designpro_generation_views/);
  assert.match(migration, /BEFORE DELETE ON public\.designpro_generation_views/);
  for (const column of ["storage_path", "content_hash", "byte_size", "content_type", "source_view_type", "consumer_role"]) {
    assert.match(migration, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
      `${column} is not protected against replacement`);
  }
});

test("provider attempt history is recorded, and never records a key", () => {
  const migration = readFileSync(new URL("20260812170000_designpro_generation_attempts.sql", migrationsDir), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.designpro_generation_attempts/);
  for (const column of ["model", "key_fingerprint", "outcome", "http_status", "detail", "duration_ms", "attempt"]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`), `attempt history is missing ${column}`);
  }
  // Fingerprint shape is enforced in the schema so a full key cannot be stored
  // in that column even by mistake.
  assert.match(migration, /key_fingerprint text NOT NULL CHECK \(key_fingerprint ~ '\^\[0-9a-f\]\{12\}\$'\)/);
  assert.match(migration, /outcome <> 'accepted' OR content_hash IS NOT NULL/);
  assert.match(migration, /GRANT SELECT, INSERT ON public\.designpro_generation_attempts TO service_role/);
  assert.doesNotMatch(migration, /GRANT[^\n]*TO (anon|authenticated)/);
});

test("the seven-view handoff is unchanged by this port", () => {
  // Calls 8+ read these exact slots. The port targets them; it does not
  // redefine them.
  const claimant = read("designpro-standalone-claimant.cjs");
  const angles = read("view-angles.cjs");
  // The six production surfaces are untouched. The seventh slot is a hero-3d
  // view carrying the hero3d role, because 'closeup' is not a role the revision
  // contract accepts and the handoff could never complete while it was.
  for (const view of ["side", "passenger-side", "hood_detail", "front", "rear", "hero-3d", "roof"]) {
    assert.ok(claimant.includes(`"${view}"`), `claimant lost source slot ${view}`);
    assert.ok(angles.includes(`"${view}"`), `view contract lost slot ${view}`);
  }
  for (const role of ["driver", "passenger", "hood", "front", "rear", "hero3d", "roof"]) {
    assert.ok(claimant.includes(`"${role}"`), `claimant lost consumer role ${role}`);
  }
});
