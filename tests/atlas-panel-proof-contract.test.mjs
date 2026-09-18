// CALL 1 AS A FLAT PANEL PRODUCTION PROOF (owner ruling, Trish 2026-09-18).
//
// "Gemini image pro 3's newest model has no issues generating text we need to
//  rely on our custom design persona edge functions and Gemini's own brain and
//  test a flat panel production proof ... it must be fed a real flat panel
//  production proof and given the base prompt system engineering so it knows
//  its job on call 1 and has a clear example and done with thought multi modal
//  best practices."
//
// TWO HOMES, ONE CONTRACT. The runtime module and the edge module carry the
// same words, exactly as atlas-artboard-prompt.ts is locked against
// designiq-prompt.cjs -- because a fix applied to one home and not the other is
// how this repo's prompt contracts keep coming undone. Change both or neither.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtime = require("../runtime/atlas-panel-proof-contract.cjs");
const edgeSource = readFileSync(
  new URL("../supabase/functions/_shared/atlas-panel-proof-prompt.ts", import.meta.url), "utf8");

test("the runtime and the edge carry the SAME contract words", () => {
  // The job statement and the installation fact are the whole conditioning.
  // If they drift, one half of the system is asking for a different object.
  for (const line of runtime.SYSTEM_JOB.split("\n").filter(Boolean)) {
    assert.ok(edgeSource.includes(line),
      `the edge is missing a line of the system job: ${line.slice(0, 60)}`);
  }
  for (const line of runtime.INSTALLATION_FACT.split("\n").filter(Boolean)) {
    assert.ok(edgeSource.includes(line),
      `the edge is missing a line of the installation fact: ${line.slice(0, 60)}`);
  }
  assert.ok(edgeSource.includes(runtime.PANEL_PROOF_CONTRACT),
    "the edge must name the same contract version");
  for (const version of runtime.VERSIONS) {
    assert.ok(edgeSource.includes(version.label), `the edge is missing ${version.key}`);
    assert.ok(edgeSource.includes(version.instruction.slice(0, 50)),
      `the edge's ${version.key} instruction drifted`);
  }
});

test("the owner's format sheet is pinned by hash, and the file on disk IS it", async () => {
  // Owner, 2026-09-18: "Must use this." A pin that nothing checks is a wish.
  const { createHash } = await import("node:crypto");
  const pin = runtime.PANEL_PROOF_FORMAT_EXAMPLE;
  const bytes = readFileSync(new URL(`../runtime/atlas-examples/${pin.path.split("/").pop()}`,
    import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256,
    "the format example on disk is not the owner's sheet — never recreate, crop or re-encode it");
  assert.equal(bytes.length, pin.byteSize);

  // Both homes carry the same pin, and the EDGE refuses a mismatch rather than
  // drawing from whatever happens to be in the bucket. canary 33389124918 is
  // what a silently-different teaching input costs.
  assert.ok(edgeSource.includes(pin.sha256), "the edge is missing the format-sheet hash");
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.match(fn, /panel_proof_format_example_mismatch/,
    "the function must refuse a format example whose bytes are not the pinned ones");

  // AND THE WORKFLOW MUST ACTUALLY SHIP IT. The probe's first live run died on
  // `ENOENT: runtime/atlas-examples/panel-production-proof-three-version.png`
  // because the workflow's payload tar was written against the OLD example
  // filename and never updated when the pin changed. The pin, the function and
  // the probe all agreed; the one place that puts the bytes on the droplet did
  // not, and nothing compared them.
  const workflow = readFileSync(
    new URL("../.github/workflows/atlas-panel-proof-probe.yml", import.meta.url), "utf8");
  const basename = pin.path.split("/").pop();
  assert.ok(workflow.includes(`runtime/atlas-examples/${basename}`),
    `the probe workflow does not ship ${basename} to the droplet, so the probe cannot stage it`);
  const probe = readFileSync(
    new URL("../scripts/atlas-panel-proof-probe.mjs", import.meta.url), "utf8");
  assert.ok(probe.includes(pin.path),
    "the probe stages a different remote path than the contract pins");
});

test("the ask is for a PROOF, and the installation fact is POSITIVE", () => {
  // The object class is the whole point of this contract: every previous
  // experiment changed the ask while keeping the object a bare artboard.
  assert.match(runtime.SYSTEM_JOB, /VEHICLE WRAP PANEL PRODUCTION PROOF/);
  assert.match(runtime.SYSTEM_JOB, /the document a print shop receives/);

  // A positive physical fact, never a prohibition. "Do not draw wheel arches"
  // is the negative shape CLAUDE.md warns about in four places and which has
  // failed 4/4 on the field map.
  assert.match(runtime.INSTALLATION_FACT, /ONE CONTINUOUS PANEL/);
  assert.match(runtime.INSTALLATION_FACT, /trims the wheel openings, handles and glass afterwards/);
  assert.doesNotMatch(runtime.INSTALLATION_FACT, /\bdo not\b/i,
    "the installation fact must state what IS, never what is forbidden");
});

test("three versions, in one pass, and the clean base is one of them", () => {
  const keys = runtime.VERSIONS.map((v) => v.key);
  assert.deepEqual(keys, ["branded", "artwork", "elements"]);
  // V2 is the clean base -- cohesive because the SAME designer drew it, which
  // is the thing no compositor can reproduce. v28 builds it mechanically and
  // the measured result (34613569) is a slate slab at 1.95:1 contrast over
  // mid-blue artwork, clipped mid-word, in a font that knows nothing about the
  // design underneath.
  const artwork = runtime.VERSIONS.find((v) => v.key === "artwork");
  assert.match(artwork.instruction, /artwork continued through where they sat/);
  assert.match(artwork.instruction, /Not erased or blanked/);
});

test("every literal string is stated ONCE and marked exact", () => {
  // The element graph's justification was that a diffusion model cannot be
  // trusted with a phone number -- RestylePro measured exactly that. This
  // contract retests that premise, so the strings must be unambiguous.
  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com" },
    manifest: { zones: [] }, creativeDirection: "blue wave",
  });
  assert.match(prompt, /reproduce each of these character for character/);
  assert.match(prompt, /Invent no other words/);
  assert.equal((prompt.match(/\(520\) 555-0192/g) || []).length, 1,
    "a literal must appear exactly once -- twice is two chances to diverge");
});

test("the exact block carries EVERY literal the wrap wears, not just the contact bar", () => {
  // A commercial wrap carries a tagline, service lines and promotional text as
  // well as a phone number, and a string the contract does not state is a
  // string the model invents. The owner's own Prius brief carries all three, so
  // omitting them would retest the diffusion-text premise on half the lettering.
  const prompt = runtime.buildPanelProofPrompt({
    input: {
      companyName: "Bright Smiles Dental", tagline: "HEALTHY SMILES BRIGHTER LIVES",
      phone: "(520) 555-0192", website: "brightsmiles.com",
      services: ["General Dentistry", "Cosmetic", "Implants"], promo: "NEW PATIENTS WELCOME",
    },
    manifest: { zones: [] }, creativeDirection: "blue wave",
  });
  for (const literal of ["HEALTHY SMILES BRIGHTER LIVES", "General Dentistry, Cosmetic, Implants",
    "NEW PATIENTS WELCOME"]) {
    assert.equal((prompt.match(new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1,
      `${literal} must appear exactly once -- twice is two chances to diverge`);
  }
  // An absent field adds no label at all; a blank "Tagline:" invites one.
  assert.doesNotMatch(runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  }), /Tagline|Services|Promotional text/);
});

test("the LAYOUT reaches the model as prose; the COORDINATES never do", () => {
  // Owner ruling 2026-09-18: the template is a system-level constant so every
  // proof looks like one print shop's line and the croppers know where to look.
  // Both halves of that are here, and they are deliberately in different places.
  for (const line of runtime.SHEET_LAYOUT.split("\n").filter(Boolean)) {
    assert.ok(edgeSource.includes(line), `the edge is missing a layout line: ${line.slice(0, 50)}`);
  }

  const prompt = runtime.buildPanelProofPrompt({
    input: {
      companyName: "Bright Smiles Dental", phone: "(520) 555-0192",
      proofDate: "2026-09-18", orderNumber: "BS-2012PRIUS-01",
      designer: "A.L.", proofVersion: "1.0",
    },
    manifest: { zones: [{ surfaceKey: "driver", trimInches: { widthIn: 165.7, heightIn: 49.6 } }] },
    creativeDirection: "blue wave",
  });
  // THE LANDMARKS MOVED BECAUSE THE OWNER'S LAYOUT MOVED, not to make a failing
  // assertion pass. She supplied the filled twin of the container on 2026-09-18
  // and it is three full-width ZONE bands, not the earlier two-column sheet
  // (VERSION 1 upper half, trim table beside the small panels, VERSION 2 lower
  // left, cut proof lower right). What this test protects is unchanged: the
  // layout reaches the model as PROSE and the coordinates never do.
  assert.match(prompt, /THREE FULL-WIDTH ZONE BANDS/);
  assert.match(prompt, /PANEL DIMENSIONS REFERENCE row/);
  assert.match(prompt, /BS-2012PRIUS-01/, "the job block must reach the header");

  // THE COORDINATE TABLE MUST NEVER REACH CALL 1. atlasFieldContract emitted
  // bare four-decimal rows and FOUR consecutive live runs painted those digits
  // onto the customer's flanks -- 8c525565's went through Topaz onto 150-PPI
  // print panels. That is what the map_drawn gate exists to catch.
  for (const region of Object.keys(runtime.PROOF_REGIONS)) {
    const rect = runtime.PROOF_REGIONS[region];
    for (const value of [rect.x, rect.y, rect.w, rect.h]) {
      if (value === 0 || value === 1) continue; // 0 and 1 are not coordinates a model would paint
      assert.ok(!prompt.includes(String(value)),
        `PROOF_REGIONS.${region} leaked the literal ${value} into the prompt`);
    }
  }
  assert.doesNotMatch(prompt, /0\.\d{3}/, "no fractional coordinate may reach Call 1");
});

test("INCHES, never normalized fractions", () => {
  // RULE 0.33 removed the [0,1] topology table from Call 1 on measured
  // evidence, and the field contract's bare four-decimal rows are what FOUR
  // consecutive runs painted onto the artwork (map_drawn). Trim inches are what
  // a proof legitimately carries.
  const prompt = runtime.buildPanelProofPrompt({
    input: {}, creativeDirection: "x",
    manifest: { zones: [{ surfaceKey: "driver", trimInches: { widthIn: 165.7, heightIn: 49.6 } }] },
  });
  assert.match(prompt, /DRIVER: 165\.7" wide x 49\.6" high/);
  assert.doesNotMatch(prompt, /0\.\d{4}/, "no normalized fractions may reach Call 1");
});

test("it stays inside the prompt budget that CLAUDE.md measured", () => {
  // v19: creative conditioning held at 2,490 chars through the last known-good
  // master; the 4K ceiling is the persona stack's own stated quality limit.
  //
  // THE FIXTURE IS THE MAXIMAL REAL PAYLOAD, and it was not always. It carried
  // three exact strings and no job block while the probe sends SIX strings, a
  // four-line job block and six panel rows -- so the lock passed at 3,317 while
  // the request the probe actually sends measured 4,020. A ceiling test that
  // exercises a thinner payload than production is not a ceiling test, and this
  // repo has recorded that same shape five times (the +-90 rotation fixtures,
  // the hero-view path allowlist, the two-master hash assertion, the empty
  // verify read, the element-graph null). Every field the probe can send is set
  // here; add a field to the contract and it belongs in this fixture too.
  const prompt = runtime.buildPanelProofPrompt({
    input: {
      companyName: "Bright Smiles Dental", tagline: "HEALTHY SMILES BRIGHTER LIVES",
      phone: "(520) 555-0192", website: "brightsmiles.com",
      services: ["General Dentistry", "Cosmetic", "Implants", "Emergency Care"],
      promo: "NEW PATIENTS WELCOME",
      proofDate: "09/17/2025", orderNumber: "BS-2012PRIUS-01",
      designer: "A.L.", proofVersion: "1.0",
      vehicle: { year: "2012", make: "Toyota", model: "Prius" },
    },
    manifest: {
      zones: ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey) => ({
        surfaceKey, trimInches: { widthIn: 165.7, heightIn: 49.6 },
      })),
    },
    // THE PROBE'S OWN DEFAULT BRIEF, VERBATIM (260 chars). The fixture used a
    // shorter one, which is the other half of why this lock passed at 3,317
    // against a real request of 4,020. If the probe's brief changes, change it
    // here too -- the ceiling is only meaningful against the real payload.
    creativeDirection: "Bright Smiles Dental — clean flowing blue and teal wave design, a custom tooth "
      + "logo, the tagline HEALTHY SMILES BRIGHTER LIVES, and a professional photograph of a smiling "
      + "dental patient in a clinical chair inlaid into the rear three-quarter of each side panel.",
  });
  assert.ok(prompt.length < 4000, `assembled prompt is ${prompt.length} chars; the ceiling is 4000`);
});

test("the BLANK CONTAINER TEMPLATE is pinned, shipped, staged and enforced", async () => {
  // Owner, 2026-09-18: "This is just the container template edge function that
  // needs in system instruction along with the version that has graphics" /
  // "produce a blank container template for system". So it is a second pinned
  // system-level attachment and gets exactly the treatment the first one gets:
  // a hash the function REFUSES a mismatch against, bytes on disk that match
  // it, a workflow that actually ships those bytes, and a probe that stages the
  // same remote path. The format sheet's first live run died on a missing file
  // because only three of those four agreed; a second pinned input is a second
  // chance to make that mistake.
  const { createHash } = await import("node:crypto");
  const pin = runtime.PANEL_PROOF_CONTAINER_TEMPLATE;
  const bytes = readFileSync(
    new URL(`../runtime/atlas-examples/${pin.path.split("/").pop()}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256,
    "the container template on disk is not the pinned one");
  assert.equal(bytes.length, pin.byteSize);

  // IT IS DRAWN BY CODE, and that is the reason it can be pinned at all. The
  // owner's generated container read "2012 TOYOTA PRIORS" and "5 BLEON ON ALL
  // FOUR EDGES" -- a teaching input with a typo in it teaches the typo.
  const renderer = require("../runtime/atlas-proof-container-template.cjs");
  assert.equal(renderer.CONTAINER_CONTRACT, pin.contract,
    "the renderer and the pin name different contract versions");
  assert.equal(renderer.WIDTH, pin.width);
  assert.equal(renderer.HEIGHT, pin.height);

  // BOTH SHEETS ARE ONE GEOMETRY. The prompt tells the model the finished proof
  // is this template filled in, and the request asks for 3:2. A container at a
  // different shape would make that sentence false and force a re-flow.
  assert.equal(pin.width / pin.height, 1.5, "the container template must be 3:2");
  assert.equal(pin.width, runtime.PANEL_PROOF_FORMAT_EXAMPLE.width);
  assert.equal(pin.height, runtime.PANEL_PROOF_FORMAT_EXAMPLE.height);

  assert.ok(edgeSource.includes(pin.sha256), "the edge is missing the container-template hash");
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.ok(fn.includes("PANEL_PROOF_CONTAINER_TEMPLATE.sha256"),
    "the function must enforce the container template's hash, not merely attach it");

  const workflow = readFileSync(
    new URL("../.github/workflows/atlas-panel-proof-probe.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes(`runtime/atlas-examples/${pin.path.split("/").pop()}`),
    "the probe workflow does not ship the container template to the droplet");
  const probe = readFileSync(
    new URL("../scripts/atlas-panel-proof-probe.mjs", import.meta.url), "utf8");
  assert.ok(probe.includes(pin.path),
    "the probe stages a different remote path than the contract pins");
});

test("the prompt names the attachments in the order the function sends them", () => {
  // THE ORDER IS LOAD-BEARING AND NOTHING ELSE CHECKS IT. The tail says
  // "ATTACHED, in order: (1) ... (2) ... (3) ...", so a reordered PINNED_INPUTS
  // leaves the text pointing at the wrong image -- the model would be told the
  // blank template is THE STANDARD TO MATCH and produce an empty sheet. That is
  // invisible to every other lock here: the hashes still verify, the workflow
  // still ships all three, and the prompt is still under budget.
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const block = fn.slice(fn.indexOf("const PINNED_INPUTS"), fn.indexOf("] as const;",
    fn.indexOf("const PINNED_INPUTS")));
  const roles = [...block.matchAll(/role:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(roles, ["container", "format", "installation"],
    "PINNED_INPUTS order changed; the prompt's numbered list must change with it");

  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  });
  const tail = prompt.slice(prompt.indexOf("ATTACHED, in order:"));
  assert.ok(tail, "the prompt must name its attachments");
  const named = [
    ["container", tail.indexOf("BLANK CONTAINER TEMPLATE")],
    ["format", tail.indexOf("FINISHED PROOF")],
    ["installation", tail.indexOf("INSTALLATION PHOTOGRAPH")],
  ];
  for (const [role, at] of named) assert.ok(at >= 0, `the prompt never names the ${role} attachment`);
  assert.deepEqual(named.sort((a, b) => a[1] - b[1]).map(([role]) => role), roles,
    "the prompt lists the attachments in a different order than the function attaches them");

  // And only the FILLED sheet is the standard. Saying it of the blank one is
  // the exact failure this test exists to catch, so say it of neither by
  // accident: the phrase must sit in item (2).
  const standardAt = tail.indexOf("THE STANDARD TO MATCH");
  assert.ok(standardAt > tail.indexOf("BLANK CONTAINER TEMPLATE"),
    "THE STANDARD TO MATCH must describe the finished proof, never the blank template");
});
