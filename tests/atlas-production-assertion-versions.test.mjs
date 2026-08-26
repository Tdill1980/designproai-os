import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const script = readFileSync(
  new URL("../ops/assert-atlas-production-schema.sh", import.meta.url),
  "utf8",
);
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
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
