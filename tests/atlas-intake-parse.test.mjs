/**
 * RAW CUSTOMER TEXT → THE STRUCTURED SCHEMA, AND THE PROBE MUST USE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "you shouldn't test it by giving it the same
 * design prompt as the example. How are we supposed to validate that it can
 * design if it's just recreating from the system example."
 *
 * That is a defect in the TEST, and it is the worst kind: one that cannot fail.
 * The probe's default brief was a description of the pinned example sheet,
 * attached to the same request as the standard to match, so the model was asked
 * to reproduce a picture it was holding. Whatever came back proved nothing
 * about whether a designer was in the loop.
 *
 * So the last case here is the one that matters most — it convicts a fixture
 * that describes the example. A harness that can only pass is not a harness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";

const require = createRequire(import.meta.url);
const runtime = require("../runtime/atlas-intake-parse.cjs");
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const EDGE = join(REPO, "supabase/functions/_shared/atlas-intake-parse.ts");

let edgeModule = null;
async function edge() {
  if (!edgeModule) {
    const out = join(mkdtempSync(join(tmpdir(), "intake-")), "intake.mjs");
    execFileSync(resolveEsbuild(), [EDGE, "--bundle", "--format=esm", "--platform=neutral",
      `--outfile=${out}`], { stdio: "pipe" });
    edgeModule = await import(`file://${out}`);
  }
  return edgeModule;
}

/** The kind of text a customer actually types into an order form. */
const MESSAGES = [
  "need a wrap for my 2019 ford transit 250 high roof - company is Cedar & Stone Tree Care, "
  + "we do tree removal, stump grinding and storm cleanup. want it rugged and outdoorsy, deep "
  + "forest green with a weathered wood grain texture and a big pine silhouette down the side. "
  + "phone 520-555-0192 and cedarandstonetree.com, put FREE ESTIMATES on there",
  "Wrap for a 2022 Chevy Silverado 2500 HD. Summit Roofing. 480.555.7788, summitroofs.co",
  "wrap my 2018 mercedes-benz sprinter 3500 please — call (602) 555-1212",
  "2021 RAM ProMaster 2500 for Vera Tile & Stone. thanks!",
];

test("the deterministic pass reads what a regex can decide, on real messages", () => {
  const [tree, roof, sprinter, tile] = MESSAGES.map((m) => runtime.extractDeterministic(m));

  assert.deepEqual(tree, {
    phone: "(520) 555-0192", website: "cedarandstonetree.com",
    vehicleYear: "2019", vehicleMake: "Ford", vehicleModel: "Transit 250 High Roof",
    // THE BODY CLASS, inferred from the model name. A.C.E. prints it into its
    // own opening line, and with nothing there it reads "(vehicle)" -- the
    // designer told nothing about the shape of what it is designing for.
    vehicleType: "van",
  });
  // A DASH, NOT A FULL STOP, ends that model — "transit 250 high roof - company
  // is ..." would otherwise put the whole sentence on the vehicle.
  assert.ok(!tree.vehicleModel.includes("Company"));

  assert.equal(roof.vehicleMake, "Chevrolet", "an abbreviation resolves to the catalog's own make");
  assert.equal(roof.phone, "(480) 555-7788", "a dotted number normalises to the printed form");
  assert.equal(roof.website, "summitroofs.co");

  // HYPHENS ARE WORD BOUNDARIES. Splitting on spaces alone gave "Mercedes-benz",
  // which is nobody's brand, and the longest-make-first order stops the same
  // string being truncated to "Mercedes".
  assert.equal(sprinter.vehicleMake, "Mercedes-Benz");
  // COURTESY WORDS ARE CLAUSE BOUNDARIES. This read "Sprinter 3500 Please",
  // which then prints on the proof and is looked up against the GENIE catalog.
  assert.equal(sprinter.vehicleModel, "Sprinter 3500");
  assert.equal(sprinter.website, "", "a message with no web address gets no web address");

  assert.equal(tile.vehicleMake, "Ram");
  assert.equal(roof.vehicleType, "truck");
  assert.equal(sprinter.vehicleType, "van");
  // HONESTLY EMPTY when the name decides nothing. A Prius is not a van, a truck
  // or an SUV, and guessing "car" to fill the field is a guess.
  assert.equal(runtime.extractDeterministic("2012 toyota prius").vehicleType, "");
  assert.equal(tile.phone, "", "an honest empty string, never a plausible number");
});

test("it never invents a contact, and never matches one out of ordinary prose", () => {
  for (const text of [
    "wrap for a 2020 ford f150, no phone on it please",
    "budget is 5000-7500 for the 2019 gmc savana",
    "email me at dave@example.com about the 2018 nissan nv200",
  ]) {
    const seen = runtime.extractDeterministic(text);
    assert.equal(seen.phone, "", `a phone number was invented from: ${text}`);
  }
  // An email address is not a web address — "example.com" inside dave@example.com
  // must not become the wrap's website.
  assert.equal(runtime.extractDeterministic("email me at dave@example.com").website, "");
});

test("a whole-word make, so 'ram' does not match inside another word", () => {
  assert.equal(runtime.extractDeterministic("2020 frame off resto").vehicleMake, "");
  assert.equal(runtime.extractDeterministic("2020 ram 1500").vehicleMake, "Ram");
});

test("the deterministic answer wins over whatever the reader returned", () => {
  const deterministic = runtime.extractDeterministic(MESSAGES[0]);
  // A READER THAT DISAGREES ABOUT A PHONE NUMBER IS WRONG BY CONSTRUCTION, and
  // this is the one place that can never reach a print panel. The whole element
  // graph exists because a model put 877-555-0000 on a customer's wrap.
  const merged = runtime.mergeIntake(deterministic, {
    companyName: "Cedar & Stone Tree Care",
    phone: "(800) 555-9999",
    website: "somewhere-else.com",
    vehicleModel: "Econoline",
    creativeDirection: "rugged and outdoorsy, deep forest green",
  });
  assert.equal(merged.phone, "(520) 555-0192");
  assert.equal(merged.website, "cedarandstonetree.com");
  assert.equal(merged.vehicleModel, "Transit 250 High Roof");
  // And it keeps what only the reader could decide.
  assert.equal(merged.companyName, "Cedar & Stone Tree Care");
  assert.match(merged.creativeDirection, /deep forest green/);
});

test("the intake prompt forbids composing, and asks for the brief unshortened", () => {
  const prompt = runtime.intakePrompt(MESSAGES[0]);
  assert.match(prompt, /You are a form, not a designer/,
    "intake must not become a second creative authority in front of A.C.E.");
  assert.match(prompt, /Never invent, improve, expand or rephrase/);
  assert.match(prompt, /never a\s+\* phone number, web address or price|never a\n.*phone number/s);
  assert.match(prompt, /must not be shortened/);
  assert.ok(prompt.includes(MESSAGES[0]), "the customer's own message must be in the prompt");
});

test("both homes parse identically and carry the same contract", async () => {
  const edgeMod = await edge();
  for (const message of MESSAGES) {
    assert.deepEqual(edgeMod.extractDeterministic(message), runtime.extractDeterministic(message));
    assert.equal(edgeMod.intakePrompt(message), runtime.intakePrompt(message));
  }
  assert.equal(edgeMod.INTAKE_CONTRACT, runtime.INTAKE_CONTRACT);
  assert.deepEqual(edgeMod.INTAKE_SCHEMA, runtime.INTAKE_SCHEMA);
});

test("the edge runs intake as node 0, deterministic-first and failing soft", () => {
  const fn = readFileSync(join(REPO, "supabase/functions/production-panel-proof/index.ts"), "utf8");
  assert.match(fn, /import \{[\s\S]*extractDeterministic[\s\S]*\} from "\.\.\/_shared\/atlas-intake-parse\.ts"/);
  // Intake runs before the design and only on raw text — and the Flash
  // reader runs only when the form left the company name blank (owner,
  // 2026-09-22: "it's not using designer brain"). With the company stated the
  // deterministic pass is everything intake can add, and the customer's own
  // words are the brief either way (`briefSource: "raw"`).
  assert.match(fn, /const intake = !customerPrompt \? null\n\s*: flashSkipped\n\s*\? \{ \.\.\.mergeIntake\(extractDeterministic\(customerPrompt\), \{ creativeDirection: customerPrompt \}\),\n\s*intakeRead: "skipped:company_name_supplied" \}\n\s*: await parseCustomerIntake\(customerPrompt\);/,
    "intake must run before the design, only on raw text, and skip the Flash reader when the company is stated");
  assert.match(fn, /const flashSkipped = Boolean\(customerPrompt\) && Boolean\(explicitCompany\);/);
  assert.match(fn, /const briefText = rawBrief \|\| extracted;/, "the customer's words are the brief; intake never replaces them");
  assert.match(fn, /temperature: 0/, "the reader is a form, so it is deterministic");
  assert.match(fn, /responseSchema: INTAKE_SCHEMA/, "it must be schema-bound, not prose");
  assert.match(fn, /intakeRead: `unavailable:/,
    "a reader that is down must not cost a design — it fails soft and says so");
  assert.match(fn, /intake: intake\n\s*\? \{ contract: INTAKE_CONTRACT, \.\.\.intake, briefSource, flashSkipped, contactSupplied, excludedSurfaces \}\n\s*: \{ briefSource, flashSkipped: false, contactSupplied, excludedSurfaces \}/,
    "what the raw message became must be on the receipt, with briefSource and flashSkipped; a wrong parse is otherwise invisible");
  // The explicit field wins: intake is a convenience for free text, not an
  // override of a caller that stated a value.
  assert.match(fn, /return explicit \|\| String\(\(intake as Record<string, unknown>\)/);
});

test("⚠️ THE PROBE MUST NOT DESCRIBE THE EXAMPLE SHEET BACK TO THE MODEL", () => {
  // THE CASE THE OWNER CAUGHT, AND THE ONLY ONE HERE THAT COULD HAVE SAVED US.
  // The probe's brief named the example's own company, palette, motif, tagline
  // and photograph while that example was attached as "THE STANDARD TO MATCH".
  // That test could only pass.
  const probe = readFileSync(join(REPO, "scripts/atlas-panel-proof-probe.mjs"), "utf8");
  const defaults = probe.slice(probe.indexOf("const customerPrompt = arg("),
    probe.indexOf("const request = {"));

  // The example sheet's identity, motif and palette. None of them may be what
  // the probe asks for, in any casing.
  for (const echo of ["Bright Smiles", "tooth", "dental", "HEALTHY SMILES", "teal", "brightsmiles.com"]) {
    assert.ok(!defaults.toLowerCase().includes(echo.toLowerCase()),
      `the probe's own brief echoes the pinned example ("${echo}") — it is testing playback, not design`);
  }
  // Not the example's vehicle either. Owner, 2026-09-18: "Don't use Prius."
  assert.ok(!defaults.toLowerCase().includes("prius"));

  // AND IT MUST BE RAW TEXT, not a filled-in form. A probe that sends
  // companyName/tagline/services alongside is a probe where intake never had to
  // find anything.
  const request = probe.slice(probe.indexOf("const request = {"), probe.indexOf("panelRows: panelRows()"));
  for (const field of ["companyName:", "tagline:", "services:", "promo:", "creativeDirection:",
    "vehicleYear:", "vehicleMake:", "vehicleModel:"]) {
    assert.ok(!request.includes(field),
      `the probe pre-fills ${field} — intake must parse it out of the raw message instead`);
  }
  assert.match(request, /customerPrompt,/, "the probe must send the raw customer message");

  // AND THE PARSER MUST REACH THE DROPLET. The probe runs inside the runtime
  // image from a payload tar; a module the tar does not carry cannot run at
  // all. The pinned format sheet's first live run died on exactly that, and the
  // probe now requires this file to draw its fallback container.
  const workflow = readFileSync(
    join(REPO, ".github/workflows/atlas-panel-proof-probe.yml"), "utf8");
  assert.ok(workflow.includes("runtime/atlas-intake-parse.cjs"),
    "the probe workflow does not ship the intake parser to the droplet");

  // The message has to actually contain what intake is expected to find, or the
  // probe is testing a parser against a sentence with nothing in it.
  const parsed = runtime.extractDeterministic(defaults);
  assert.ok(parsed.phone && parsed.website && parsed.vehicleYear && parsed.vehicleMake,
    `the probe's message does not carry a parseable vehicle and contact: ${JSON.stringify(parsed)}`);
});
