// A REFUSED VIEW DOES NOT CANCEL THE OTHERS. (Trish 2026-08-27)
//
// "A failed Hood 3D proof cannot prevent the Hood production panel from
// existing. A failed Close-Up cannot cancel Driver/Passenger/Front/Rear/Roof
// artifacts."
//
// The engine marks the whole request failed when ANY slot fails — right for
// Standard, wrong for A.T.L.A.S., whose six panels were cut from the accepted
// master inside Call 1 before a single proof was dispatched. Live cost,
// 04cc0b29: five accepted proofs and six good panels reported `failed`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const worker = readFileSync(join(ROOT, "runtime/generation-worker.cjs"), "utf8");
const engine = readFileSync(join(ROOT, "runtime/generation-engine.cjs"), "utf8");
const migration = readFileSync(
  join(ROOT, "supabase/migrations/20260827030000_designpro_partial_view_completion.sql"),
  "utf8",
);

test("only A.T.L.A.S. completes partially — Standard keeps exact semantics", () => {
  assert.match(worker, /const atlasPartial = isFlatFirst\s*\n\s*&& result\.state !== "outputs_ready"\s*\n\s*&& acceptedSlots\.length > 0;/);
  // The engine itself is untouched: a mixed result is still "failed" there.
  assert.match(engine, /state: failed\.length \? "failed" : allAccepted \? "outputs_ready" : "pending"/);
});

test("a partial run never pretends to be whole", () => {
  // The refusals are named on the receipt…
  assert.match(worker, /refusedViews: refusedSlots\.map/);
  // …and the call count is the real one, not a constant.
  assert.match(worker, /callsCompleted: String\(views\.length\)/);
  assert.ok(!/callsCompleted: "7"/.test(worker), "the constant must be gone");
});

test("every view present still proves its lineage; only set completeness relaxes", () => {
  assert.match(worker, /assertAtlasViewLineage\(\{ views, flatAtlas, requireComplete: !atlasPartial \}\)/);
  // And a partial set must match exactly the slots that were accepted.
  assert.match(worker, /views\.length !== acceptedSlots\.length/);
});

test("the DB is what actually enforced it, and the patch tightens the receipt", () => {
  // Relaxing the view count alone changes nothing: callsCompleted was pinned
  // to the literal '7', so a short set still raised on the receipt guard.
  assert.match(migration, /NOT BETWEEN 1 AND 7/);
  assert.match(migration, /jsonb_array_length\(p_views\)::text/);
  // Patch-not-restate, with the surrounding contract asserted intact.
  assert.match(migration, /generation_lease_lost/);
  assert.match(migration, /designpro\.calls-1-7-receipt\.v1/);
  assert.match(migration, /frozen_generation_engine_receipt_invalid/);
  // Idempotent.
  assert.match(migration, /a second apply is a no-op/);
});

test("the migration is in the ordered chain", () => {
  const names = readdirSync(join(ROOT, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
  // Position, not "last". Asserting the tail made every subsequent migration
  // fail this test for no reason of its own; what matters is that this one
  // lands after the function it patches and before nothing in particular.
  const index = names.indexOf("20260827030000_designpro_partial_view_completion.sql");
  assert.ok(index > 0, "the partial-completion migration is in the chain");
  assert.ok(
    names.slice(0, index).some((name) => name.includes("designpro_functions_contract")),
    "it lands after the function contract that creates what it patches",
  );
});
