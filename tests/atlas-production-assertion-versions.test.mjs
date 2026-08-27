import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  new URL("../ops/assert-atlas-production-schema.sh", import.meta.url),
  "utf8",
);
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const migrationsPath = fileURLToPath(migrationsDir);
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"))
  .join("\n");

/**
 * A VERSION THE MIGRATIONS BUMP MUST NEVER BE PINNED IN THE ASSERTION.
 *
 * `20260826050000` patched the live sibling predicate from
 * `designpanel-ai-generate.artboard.20260822.v1` to `...20260826.v2`, and its
 * own guard REFUSES to ship unless v1 is gone. The production assertion still
 * demanded v1, so from that migration onward every production migration
 * applied cleanly and then failed the verification after it -- reporting
 * "Live DesignProAI schema does not satisfy the A.T.L.A.S. Close-Up/
 * regeneration contract", which names nothing resembling the real cause. It
 * blocked this repository's whole production-migration path, for every branch.
 *
 * The script already knew the lesson: it derives the A.T.L.A.S. prompt version
 * from the migrations, under a comment saying a pinned one goes "out of date
 * exactly when it matters". The artboard port simply never got the same
 * treatment. This asserts that BOTH are derived, so the next version bump
 * carries its assertion with it instead of silently invalidating it.
 */
test("the production assertion derives its versions from the migrations", () => {
  for (const [placeholder, pattern] of [
    ["__ATLAS_PROMPT_VERSION__", /designpro-flat-first-atlas-\d{8}\.v\d+/g],
    ["__ARTBOARD_PORT_VERSION__", /designpanel-ai-generate\.artboard\.\d{8}\.v\d+/g],
  ]) {
    // The query asks for a placeholder...
    assert.ok(
      script.includes(placeholder),
      `the query must ask for ${placeholder} rather than a fixed version`,
    );
    // ...and the script substitutes it from what the migrations install.
    assert.match(
      script,
      new RegExp(`query=\\$\\{query//${placeholder}/\\$[A-Z_]+\\}`),
      `${placeholder} must be substituted from a derived value`,
    );
    // ...and no literal of that shape survives inside the query itself.
    const query = script.slice(
      script.indexOf("read -r -d '' query"),
      script.indexOf("\nSQL\n"),
    );
    assert.equal(
      query.match(pattern),
      null,
      `a fixed version literal in the query goes stale the moment a migration bumps it`,
    );
  }
});

/** And the derived values must actually resolve against today's migrations. */
test("both derived versions exist in the migrations the script reads", () => {
  for (const pattern of [
    /designpro-flat-first-atlas-\d{8}\.v\d+/,
    /designpanel-ai-generate\.artboard\.\d{8}\.v\d+/,
  ]) {
    assert.match(migrations, pattern);
  }
});

/**
 * AND THE DERIVED VALUE MUST BE A WHOLE VERSION, SUFFIX INCLUDED.
 *
 * The query looks the version up as a QUOTED literal, so a truncated
 * extraction is not a near miss — it is a guaranteed no-match. Both live
 * versions carry a build suffix (`.v9-dpag`, `.v10-edge`, `.v3-vendored`,
 * `.v4-edge`) and the extraction pattern stopped at the digits, so it searched
 * the live definition for 'designpro-flat-first-atlas-20260826.v9' while the
 * migration had just written '...v9-dpag'.
 *
 * That is what failed production-migrate run 33023852051 (2026-08-26 23:39):
 * the v9 pin applied cleanly and this fence then refused the database it had
 * itself produced, again reporting the Close-Up contract.
 *
 * Stated without naming any version: whatever the script extracts must be a
 * literal that appears in the migrations, and must not be a strict prefix of a
 * longer literal there — which is exactly what a dropped suffix looks like.
 */
test("the derived versions are complete literals, not prefixes of longer ones", () => {
  const run = (assignment) =>
    execFileSync(
      "bash",
      ["-c", `set -e; ATLAS_MIGRATIONS_DIR=${JSON.stringify(migrationsPath)}\n${assignment}\necho "$V"`],
      { encoding: "utf8" },
    ).trim();

  for (const [name, family] of [
    ["ATLAS_PROMPT_VERSION", /designpro-flat-first-atlas-\d{8}\.v[0-9][A-Za-z0-9.-]*/g],
    ["ARTBOARD_PORT_VERSION", /designpanel-ai-generate\.artboard\.\d{8}\.v[0-9][A-Za-z0-9.-]*/g],
  ]) {
    const line = script
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=$(`));
    assert.ok(line, `${name} must be derived by a shell pipeline`);
    const derived = run(line.replace(`${name}=`, "V="));

    const present = new Set(migrations.match(family) || []);
    assert.ok(present.has(derived), `${name} derived "${derived}", which no migration writes`);
    for (const literal of present) {
      assert.ok(
        literal === derived || !literal.startsWith(derived),
        `${name} derived "${derived}", a truncation of "${literal}" — the quoted lookup can never match`,
      );
    }
  }
});
