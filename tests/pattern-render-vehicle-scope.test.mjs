import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * generate-pattern-render CRASHED ON EVERY LIVE RENDER (2026-09-18).
 *
 * Owner reported "Generation failed — Edge Function returned a non-2xx status
 * code" on /pattern-wrap. Supabase logs showed the Gemini render succeeded,
 * the image uploaded, and then:
 *
 *   [PatternPro] Render uploaded: https://.../renders/...
 *   [PatternPro] Error: vehicleYear is not defined
 *
 * `processGeminiResponse` is a top-level function, not a closure nested in
 * the `Deno.serve` handler. The 2026-09-15 fix for null vehicle_year (see the
 * comment still above the DB insert) added `vehicleYear`/`vehicleMake`/
 * `vehicleModel` references inside that function's body without adding them
 * to its parameter list or its call site -- a ReferenceError on every single
 * render, thrown after the image was already generated and uploaded, so the
 * response never reached the customer. Fixed by threading the three values
 * through the call and the signature.
 *
 * This locks that shape so a future edit to either the call site or the
 * signature can't silently drop them again.
 */
const root = resolve(import.meta.dirname, "..");
const SRC = readFileSync(resolve(root, "supabase/functions/generate-pattern-render/index.ts"), "utf8");

test("the single call site passes vehicleYear, vehicleMake and vehicleModel to processGeminiResponse", () => {
  const calls = [...SRC.matchAll(/processGeminiResponse\(([^)]*)\)/g)]
    .filter((m) => SRC.slice(Math.max(0, m.index - 15), m.index) !== "async function ");
  assert.equal(calls.length, 1, "expected exactly one call site (a second call site would need the same audit)");
  const args = calls[0][1];
  assert.match(args, /\bvehicleYear\b/, "the call must pass vehicleYear");
  assert.match(args, /\bvehicleMake\b/, "the call must pass vehicleMake");
  assert.match(args, /\bvehicleModel\b/, "the call must pass vehicleModel");
});

test("processGeminiResponse declares vehicleYear, vehicleMake and vehicleModel as its own parameters", () => {
  const start = SRC.indexOf("async function processGeminiResponse(");
  assert.ok(start > -1, "processGeminiResponse must still exist");
  const sigEnd = SRC.indexOf("): Promise<Response> {", start);
  assert.ok(sigEnd > start, "the function's return type must still be Promise<Response>");
  const signature = SRC.slice(start, sigEnd);
  assert.match(signature, /vehicleYear\?:\s*string/, "vehicleYear must be a declared parameter, not a free identifier");
  assert.match(signature, /vehicleMake\?:\s*string/, "vehicleMake must be a declared parameter, not a free identifier");
  assert.match(signature, /vehicleModel\?:\s*string/, "vehicleModel must be a declared parameter, not a free identifier");
});

test("the DB insert still reads vehicle_year/make/model from those parameters", () => {
  assert.match(SRC, /vehicle_year:\s*vehicleYear\s*\|\|\s*colorData\.vehicleYear\s*\|\|\s*null/);
  assert.match(SRC, /vehicle_make:\s*vehicleMake\s*\|\|\s*colorData\.vehicleMake/);
  assert.match(SRC, /vehicle_model:\s*vehicleModel\s*\|\|\s*colorData\.vehicleModel/);
});
