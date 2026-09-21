/**
 * A.C.E. HAS ONE SOURCE, AND THE SHARED COPY CANNOT DRIFT FROM IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "Must use our suite of custom design edge
 * functions no fucking excuses!!!"
 *
 * `production-panel-proof` now executes the real `buildDesignIQPrompt`, which
 * lives inside `design-panel-ai-generate/index.ts` — a file that calls `serve()`
 * at module scope, so it cannot be imported from another function. The answer is
 * a module sliced mechanically out of it by `scripts/build-designiq-shared.mjs`.
 *
 * A SLICED COPY IS ONLY SAFE WHILE SOMETHING PROVES IT IS STILL THE ORIGINAL.
 * RULE 0.26 deleted a reconstructed persona bridge for exactly this reason — a
 * hand-made second copy of the creative text, with nothing forcing it to stay
 * true. So this regenerates the module and fails on a single character of
 * difference. Edit index.ts and the build goes red until it is regenerated.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDesignIQShared, GENERATED } from "../scripts/build-designiq-shared.mjs";

test("the shared assembly is byte-identical to a fresh slice of the deployed function", () => {
  assert.equal(readFileSync(GENERATED, "utf8"), buildDesignIQShared(),
    "supabase/functions/_shared/designiq-assembly.ts is stale — "
    + "run `node scripts/build-designiq-shared.mjs` and commit the result");
});

test("the slice starts no server and keeps every other import", () => {
  const generated = readFileSync(GENERATED, "utf8");
  // The ONE deletion. Everything else stays, because esbuild does not
  // type-check: an identifier the header no longer provides would bundle
  // cleanly and fail in front of a customer.
  assert.ok(!/from "https:\/\/deno\.land\/std@[^"]*\/http\/server\.ts"/.test(generated),
    "the serve import must not reach a module that other functions import");
  // Line comments stripped first: the banner itself explains the serve()
  // boundary, and a lock that trips on its own documentation is a lock nobody
  // can satisfy without deleting the explanation.
  const code = generated.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bserve\s*\(/.test(code), "the sliced region must not call serve()");

  const source = readFileSync(
    new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
  const sourceImports = (source.slice(0, source.indexOf("\nserve(async (req)"))
    .match(/^import .*$/gm) || []).filter((line) => !line.includes("/http/server.ts"));
  for (const line of sourceImports) {
    assert.ok(generated.includes(line), `the slice dropped an import it still needs: ${line.slice(0, 60)}`);
  }
});

test("it exports what the panel studio executes", () => {
  const generated = readFileSync(GENERATED, "utf8");
  assert.match(generated, /export \{ buildDesignIQPrompt, briefWantsPhoto, splitStyleAndText \};/);
  assert.match(generated, /GENERATED FILE — DO NOT EDIT/,
    "a generated file that does not say so gets hand-edited, and then it is not a slice");
});

test("the panel studio executes it, and swaps ONLY the output tail", () => {
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");

  // THE IMPORT IS THE LOCK. A comment saying the persona is used proves
  // nothing; the live sheet that came back as blue waves was produced by a
  // function whose own header claimed it relied on "our custom design persona
  // edge functions" while importing none of them.
  assert.match(fn, /import \{ buildDesignIQPrompt \} from "\.\.\/_shared\/designiq-assembly\.ts"/,
    "the studio must import the real assembly");
  assert.match(fn, /atlasFlatMaster: true/,
    "it must run the same branch Call 1 runs, not a different one");
  assert.match(fn, /panelProofCreativeHead\(buildDesignIQPrompt\(/,
    "the assembly must be EXECUTED and its tail swapped, never paraphrased");
  assert.match(fn, /creativeHead,/, "the head must reach the proof contract");

  // AND THE CUSTOMER'S OWN FIELDS MUST REACH IT. A.C.E. selects the finish spec
  // from FINISH_SPECS and states the exact phone and web address; passing none
  // of that would execute the persona over an empty brief, which is a different
  // way of having no designer.
  for (const field of ["companyName:", "phone:", "website:", "finish:", "vehicleMake:"]) {
    assert.ok(fn.includes(field), `the assembly is not being given ${field}`);
  }
});

test("the head it feeds the proof is the persona, and the artboard tail is gone", async () => {
  const { loadDesignIQ, ATLAS_PANELS } = await import("./helpers/load-designiq.mjs");
  const { buildDesignIQPrompt } = await loadDesignIQ();
  const { createRequire } = await import("node:module");
  const runtime = createRequire(import.meta.url)("../runtime/atlas-panel-proof-contract.cjs");

  const assembled = buildDesignIQPrompt({
    mode: "commercial", prompt: "clean modern dental wrap, teal and white", finish: "Gloss",
    substrate: "standard", companyName: "Bright Smiles Dental", phone: "(520) 555-0192",
    website: "brightsmiles.com", vehicleYear: "2012", vehicleMake: "Toyota",
    vehicleModel: "Prius", vehicleType: "car", viewType: "side",
    atlasFlatMaster: true, atlasPanels: ATLAS_PANELS,
  });
  const head = runtime.panelProofCreativeHead(assembled);

  // THE PERSONA SURVIVES THE CUT — these are the exact blocks that were missing
  // from the proof entirely, each measured in CLAUDE.md as proven direction.
  assert.match(head, /senior graphic designer and vehicle-wrap specialist/, "the persona identity");
  assert.match(head, /native Gemini 3 Pro Image design knowledge/, "native model design knowledge");
  assert.match(head, /built from layered elements/, "COMMERCIAL_DEPTH's build order");
  assert.match(head, /Translate anything the brief names into concrete design/, "the translation block");
  assert.match(head, /clean modern dental wrap, teal and white/, "the customer's own brief");
  assert.match(head, /GLOSS/, "the customer-selected finish spec");
  assert.match(head, /\(520\) 555-0192/, "the exact contact string");

  // AND THE SIX-RECTANGLE CONTRACT DOES NOT. Leaving it in would hand the model
  // two output contracts at once — an A.T.L.A.S. artboard and a three-zone
  // proof — which is the one thing this split exists to prevent.
  assert.ok(!head.includes("OUTPUT FORMAT"), "the artboard output contract must be cut");
  assert.ok(!head.includes("the tall panel down the left"), "the artboard panel list must be cut");
  assert.ok(head.length < assembled.length, "nothing was actually cut");

  // THE SEAM FAILS LOUDLY, NEVER SILENTLY. If the marker ever moves, a silent
  // fall-through would ship the contradictory prompt described above.
  assert.throws(() => runtime.panelProofCreativeHead("a prompt with no marker in it"),
    /panel_proof_ace_output_tail_marker_missing/);
  assert.throws(() => runtime.panelProofCreativeHead(
    "no persona here\nOUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas."),
    /panel_proof_ace_persona_missing/);
});

/**
 * THE CUT REMOVED THE TAIL AND LEFT THE SCENE — AND THE LOCK ABOVE MISSED IT.
 *
 * The test above asserts "the six-rectangle contract does not [survive]" and
 * then only checks the OUTPUT FORMAT block and the panel list. Both are at the
 * END of the assembly, which is exactly where the cut is. The presentation
 * sentence is at POSITION 2, so it survived every one of those assertions:
 *
 *   "as ONE FLAT print-production master — flat orthographic panels ...
 *    never an on-vehicle photograph ... not six independent graphics."
 *
 * followed, one blank line later, by SYSTEM_JOB asking for a three-band proof
 * sheet carrying the six panels three times. Two output contracts in one
 * prompt, with the wrong one first — the precise thing the cut exists to
 * prevent, passing a green lock. This repo has now recorded that shape five
 * times: WHEN A LOCK NAMES TWO THINGS, ASSERT BOTH OF THEM.
 *
 * So DesignIQ names the object itself (`atlasProofSheet`), and this asserts the
 * swap in both directions — gone from the proof, still there for Call 1.
 */
test("DesignIQ names the proof's own object, and Call 1 still names the artboard's", async () => {
  const { loadDesignIQ, ATLAS_PANELS } = await import("./helpers/load-designiq.mjs");
  const { buildDesignIQPrompt } = await loadDesignIQ();
  const { createRequire } = await import("node:module");
  const runtime = createRequire(import.meta.url)("../runtime/atlas-panel-proof-contract.cjs");

  const params = {
    mode: "commercial", prompt: "clean modern dental wrap, teal and white", finish: "Gloss",
    substrate: "standard", companyName: "Bright Smiles Dental", phone: "(520) 555-0192",
    website: "brightsmiles.com", vehicleYear: "2012", vehicleMake: "Toyota",
    vehicleModel: "Prius", vehicleType: "car", viewType: "side",
    atlasFlatMaster: true, atlasPanels: ATLAS_PANELS,
  };
  const artboard = runtime.panelProofCreativeHead(buildDesignIQPrompt(params));
  const proof = runtime.panelProofCreativeHead(
    buildDesignIQPrompt({ ...params, atlasProofSheet: true }));

  // THE COMPETING OBJECT IS GONE FROM THE PROOF. Each of these is a sentence
  // naming a DIFFERENT deliverable than the one SYSTEM_JOB asks for.
  for (const competing of [
    "ONE FLAT print-production master",
    "not six independent graphics",
    "flat orthographic panels",
  ]) {
    assert.ok(!proof.includes(competing),
      `the proof head still asks for the artboard: "${competing}"`);
  }

  // AND SO IS THE NEGATIVE. "never an on-vehicle photograph" is the prompt
  // shape that has failed 4/4 on the field map; SYSTEM_JOB states the same
  // requirement positively, so carrying both is cost with no benefit.
  assert.ok(!/never an on-vehicle photograph/.test(proof),
    "the proof head carries a negative instruction SYSTEM_JOB already states positively");

  // THE VALUABLE HALF SURVIVES. If a future edit swaps the object by deleting
  // the creative direction with it, the proof loses its designer again — which
  // is the 2026-09-18 defect (3,906 chars, ~40 of brief, zero of A.C.E.).
  assert.match(proof, /senior graphic designer and vehicle-wrap specialist/, "the persona");
  assert.match(proof, /built from layered elements/, "COMMERCIAL_DEPTH's build order");
  assert.match(proof, /mid-ground graphic motion/, "the layered build order's middle term");
  assert.match(proof, /clean modern dental wrap, teal and white/, "the customer's brief");
  assert.match(proof, /\(520\) 555-0192/, "the exact contact string");

  // IT IS A SWAP, NOT AN ADDITION. The owner's constraint was explicit: no
  // bloat, no added latency. A proof head longer than the artboard head means
  // something was appended rather than replaced.
  assert.ok(proof.length < artboard.length,
    `the proof head must not grow (artboard ${artboard.length}, proof ${proof.length})`);

  // AND IT IS SCOPED. Call 1 is what every customer generation runs through;
  // its head must still name the artboard, byte for byte as before.
  assert.ok(artboard.includes("ONE FLAT print-production master"),
    "Call 1 lost its own output object — this change must not touch the artboard path");
  assert.ok(!proof.includes("OUTPUT FORMAT") && !artboard.includes("OUTPUT FORMAT"),
    "the artboard tail is still cut from both");
});
