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
import { loadDesignIQ, ATLAS_PANELS } from "./helpers/load-designiq.mjs";

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
  // THE SENTENCE THAT FORBIDS A DIE-CUT PANEL IS BACK, and this is the lock on
  // it. I cut it to 90 characters for budget and live sheet 35389031759 came
  // back with the windshield cut out of both flanks. RULE 0.32's acceptance
  // contract is not a nice-to-have in this prompt; it IS the prompt.
  assert.match(runtime.INSTALLATION_FACT, /SOLID RECTANGLE of artwork/);
  assert.match(runtime.INSTALLATION_FACT, /no holes and no vehicle-shaped outline/);
  assert.match(runtime.INSTALLATION_FACT, /artwork runs straight through the places those openings will be/);
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
  assert.match(artwork.instruction, /as if they had never carried type/);
  // The band LABEL is the rule now — it is drawn on the sheet and it says the
  // whole thing — so the instruction beside it stays one clause. Restating a
  // label in prose is budget the designer needed and did not have.
  assert.match(artwork.label, /BACKGROUNDS ONLY \(NO TEXT OR LOGO\)/);
});

test("every literal string is stated ONCE and marked exact", () => {
  // The element graph's justification was that a diffusion model cannot be
  // trusted with a phone number -- RestylePro measured exactly that. This
  // contract retests that premise, so the strings must be unambiguous.
  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com" },
    manifest: { zones: [] }, creativeDirection: "blue wave",
  });
  assert.match(prompt, /EXACT TEXT, character for character/);
  assert.match(prompt, /invent no other words, numerals or web address/);
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
  // The zone bands are DRAWN on the attached container, so the prompt names them
  // by their titles and tells the model to fill the sheet rather than describing
  // a layout it can already see. Describing it twice was budget the designer
  // needed: the proof shipped with zero characters of A.C.E. to stay under 4000.
  assert.match(prompt, /each band titled exactly as written/);
  assert.match(prompt, /Fill the attached template; do not re-flow it/);
  // The reference row is DRAWN on the attached container, so the prompt points
  // at it rather than re-describing the sheet it is looking at.
  assert.match(prompt, /identical in every zone and in the reference row/);
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

// A.C.E. AS THE EDGE ACTUALLY ASSEMBLES IT, transpiled and EXECUTED — never a
// paraphrase. `loadDesignIQ` bundles the real buildDesignIQPrompt out of the
// deployed design-panel-ai-generate, which is the same source
// scripts/build-designiq-shared.mjs ships to the edge.
const { buildDesignIQPrompt } = await loadDesignIQ();
// THE SAME BRIEF GOES TO BOTH HALVES, because in a real request it only goes
// to ONE of them: the customer's words reach A.C.E. and the document contract
// no longer restates them. Giving the head a four-word brief while the doc
// fixture carried a 260-character one made the paperwork look heavier than the
// designer by construction, which is the exact ratio this file asserts on.
const FIXTURE_BRIEF = "Bright Smiles Dental — clean flowing blue and teal wave design, a custom tooth "
  + "logo, the tagline HEALTHY SMILES BRIGHTER LIVES, and a professional photograph of a smiling "
  + "dental patient in a clinical chair inlaid into the rear three-quarter of each side panel.";

const ACE_FIXTURE = buildDesignIQPrompt({
  mode: "commercial", prompt: FIXTURE_BRIEF, finish: "Gloss",
  substrate: "standard", companyName: "Bright Smiles Dental", phone: "(520) 555-0192",
  website: "brightsmiles.com", vehicleYear: "2012", vehicleMake: "Toyota", vehicleModel: "Prius",
  vehicleType: "car", viewType: "side", atlasFlatMaster: true, atlasPanels: ATLAS_PANELS,
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
  const FIXTURE_ARGS = {
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
    creativeDirection: FIXTURE_BRIEF,
  };
  const prompt = runtime.buildPanelProofPrompt(FIXTURE_ARGS);
  // WITHOUT THE A.C.E. HEAD this is the document contract alone, and it must
  // stay small — it is packaging, and the budget belongs to the design.
  assert.ok(prompt.length < 2600,
    `the document contract alone is ${prompt.length} chars; it must stay under 2600`);

  // ⚠️ THE CEILING IS NOT A FIXED TOTAL, AND WRITING IT AS ONE WAS THE MISTAKE
  // BEHIND EVERY OTHER MISTAKE IN THIS FILE.
  //
  // 4000 was this file's reading of the persona stack's own rule — "Prompt
  // length = quality killer. Keep under 4K chars total." What that rule was
  // measured on is a RATIO, not a length: CLAUDE.md records the wall prompt at
  // "4,501 characters, of which 3,342 were generic persona boilerplate and 44
  // were the customer's brief — the persona outweighed the design 76 to 1".
  //
  // A FIXED TOTAL PENALISES A CUSTOMER WHO WRITES MORE. The assembled prompt
  // grows with the brief, because A.C.E. carries the brief — measured, same
  // payload, brief of 24 chars against one of 260: the Call-1 assembly goes
  // 3,691 -> 4,192 and this prompt goes 4,772 -> 5,273. Nothing got more
  // bloated; the customer said more. Holding a fixed number would mean cutting
  // the document contract every time somebody typed a longer sentence, and the
  // first thing cut for budget last time was RULE 0.32's own acceptance
  // contract — after which the very next live sheet came back die-cut.
  //
  // So the lock is on WHAT THIS CONTRACT ADDS to the prompt Call 1 already
  // sends. That number is constant at 1,081 across both briefs, because the
  // document half is constant and the artboard tail it replaces is constant.
  const head = runtime.panelProofCreativeHead(ACE_FIXTURE);
  const full = runtime.buildPanelProofPrompt({ ...FIXTURE_ARGS, creativeHead: head });
  const added = full.length - ACE_FIXTURE.length;
  assert.ok(added <= 1200,
    `the document contract adds ${added} chars over Call 1's own assembly; the budget is 1200`);

  // AND IT STILL CANNOT BE SATISFIED BY DELETING THE DESIGNER, which is what
  // the old ceiling was satisfied by: the proof shipped at 3,906 chars UNDER
  // 4000 with 40 characters of brief and zero of A.C.E.
  assert.ok(head.length >= full.length - head.length,
    `the designer (${head.length}) must not be outweighed by the paperwork `
    + `(${full.length - head.length}) — that ratio is the defect this lock exists for`);
});

test("the CONTAINER TEMPLATE is rendered per vehicle and verified, not byte-pinned", async () => {
  // Owner, 2026-09-18: "produce a blank container template for system", then
  // the architecture note: the template is generated "using the target
  // vehicle's exact panel dimensions".
  //
  // THE FIRST VERSION OF THIS SHIPPED A FIXED PNG and pinned its sha256. That
  // PNG is drawn for the Prius -- 165.7" x 49.6" flanks -- so every other
  // vehicle would have been shown a template dimensioned for a car it is not,
  // and the pin would have verified it happily: a hash proves the bytes are the
  // ones we pinned, never that they are the ones THIS request needs.
  const renderer = require("../runtime/atlas-proof-container-template.cjs");
  const rows = [
    'DRIVER: 165.7" wide x 49.6" high', 'PASSENGER: 165.7" wide x 49.6" high',
    'ROOF: 43" wide x 56" high', 'HOOD: 50" wide x 41" high',
    'FRONT: 50" wide x 22" high', 'REAR: 58" wide x 40" high',
  ];
  // ONE FORMAT, PARSED ONCE. The prompt states the panels to the model in these
  // exact words; the container must draw those same six rectangles.
  const manifest = renderer.parsePanelRows(rows);
  assert.equal(manifest.zones.length, 6, "the contract's own row format must parse");
  assert.deepEqual(manifest.zones.map((z) => z.surfaceKey).sort(),
    ["driver", "front", "hood", "passenger", "rear", "roof"]);

  // DETERMINISM IS WHAT REPLACES THE BYTE PIN. Same manifest in, identical
  // bytes out -- that is the property that makes a rendered teaching input as
  // trustworthy as a pinned one, and it is why the container is code and not a
  // generation (the owner's generated one read "2012 TOYOTA PRIORS").
  const { createHash } = await import("node:crypto");
  const draw = (m, vehicle) => renderer.renderContainerTemplate({
    manifest: m, companyName: "BRIGHT SMILES DENTAL", vehicle, bleedInches: 5 });
  const [a, b] = await Promise.all([draw(manifest, "2012 TOYOTA PRIUS"), draw(manifest, "2012 TOYOTA PRIUS")]);
  assert.equal(createHash("sha256").update(a).digest("hex"),
    createHash("sha256").update(b).digest("hex"), "the renderer must be deterministic");

  // AND A DIFFERENT VEHICLE MUST PRODUCE A DIFFERENT SHEET. This is the whole
  // defect: if these two matched, the F250 would be shown the Prius's numbers.
  const f250 = renderer.parsePanelRows([
    'DRIVER: 251" wide x 60" high', 'PASSENGER: 251" wide x 60" high',
    'ROOF: 79" wide x 68" high', 'HOOD: 66" wide x 55" high',
    'FRONT: 80" wide x 32" high', 'REAR: 80" wide x 60" high',
  ]);
  // HOLD EVERY OTHER INPUT CONSTANT. The first version of this assertion also
  // changed the vehicle NAME, which is printed in the header -- so the bytes
  // differed for that reason alone and the check passed against a renderer
  // hard-wired to the Prius. Verified: with the name varying too, a container
  // that ignores its manifest entirely still slips through. Only the manifest
  // moves here, so only the dimensions can move the bytes.
  const other = await draw(f250, "2012 TOYOTA PRIUS");
  assert.notEqual(createHash("sha256").update(a).digest("hex"),
    createHash("sha256").update(other).digest("hex"),
    "the container ignored its manifest -- a second vehicle got the first one's dimensions");

  assert.equal(renderer.WIDTH / renderer.HEIGHT, 1.5, "the container must be 3:2");
  assert.equal(renderer.WIDTH, runtime.PANEL_PROOF_FORMAT_EXAMPLE.width);
  assert.equal(renderer.HEIGHT, runtime.PANEL_PROOF_FORMAT_EXAMPLE.height);
  assert.equal(renderer.CONTAINER_CONTRACT, runtime.PANEL_PROOF_CONTAINER_TEMPLATE.contract);

  // THE STUDIO DRAWS ITS OWN CONTAINER -- owner, 2026-09-18: "just use template
  // wired as a studio edge function". Asserting the IMPORT is what makes this a
  // lock and not a comment: the function must reach the shared renderer, not
  // describe reaching it, and it must parse the panel rows it has just stated
  // to the model rather than deriving the geometry a second way.
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.match(fn, /import \{[^}]*stageProofContainer[^}]*\} from "\.\.\/_shared\/atlas-proof-container-render\.ts"/,
    "the studio must import the shared container renderer");
  assert.match(fn, /stageProofContainer\(svc\.storage\.from\(BUCKET\), \{\s*\n\s*manifest: parsePanelRows\(panelRows\)/,
    "the container must be drawn from the SAME panelRows the prompt states");
  // The caller-staged path survives ONLY as a fallback, and it must announce
  // itself. A probe that silently stopped drawing its own sheet would look
  // exactly like one that never could.
  assert.match(fn, /panel_proof_container_unavailable/,
    "with neither a drawn nor a supplied container the request must refuse, not draw blind");
  assert.match(fn, /origin: "studio"/, "the response must record that the studio drew it");
  assert.match(fn, /origin: "caller", studioRenderFailed/,
    "a fallback must carry the reason the studio render failed");

  // THE EDGE STILL VERIFIES THE REFERENCE -- the three checks RULE 0.39 runs on
  // the hero view, unchanged, and they now guard both origins.
  assert.match(fn, /CALL1_INPUT_PATH\.test\(containerPath\)/, "the path must be allowlisted");
  assert.match(fn, /panel_proof_container_not_content_addressed/,
    "the filename must be proven to be the content hash");
  assert.match(fn, /panel_proof_container_hash_mismatch/,
    "the bytes must be proven to be what the caller claimed");
  assert.ok(!fn.includes("PANEL_PROOF_CONTAINER_TEMPLATE.sha256"),
    "a per-vehicle artifact must not be byte-pinned");

  // AND THE RENDERER MUST REACH THE DROPLET. The probe runs inside the runtime
  // image from a payload tar; a renderer the tar does not carry cannot run at
  // all. This is the same four-places-must-agree check the format sheet needs,
  // whose first live run died on exactly that.
  const workflow = readFileSync(
    new URL("../.github/workflows/atlas-panel-proof-probe.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("runtime/atlas-proof-container-template.cjs"),
    "the probe workflow does not ship the container renderer to the droplet");
  const probe = readFileSync(
    new URL("../scripts/atlas-panel-proof-probe.mjs", import.meta.url), "utf8");
  assert.match(probe, /stageContainerTemplate/, "the probe must render and stage the container");
  assert.match(probe, /atlas-call1-inputs\/\$\{digest\}\.png/,
    "the probe must stage it content-addressed under the Call-1 input prefix");
});

test("the prompt names the attachments in the order the function sends them", () => {
  // THE ORDER IS LOAD-BEARING AND NOTHING ELSE CHECKS IT. The tail says
  // "ATTACHED: (1) ... (2) ... (3) ...", so a reordered PINNED_INPUTS
  // leaves the text pointing at the wrong image -- the model would be told the
  // blank template is THE STANDARD TO MATCH and produce an empty sheet. That is
  // invisible to every other lock here: the hashes still verify, the workflow
  // still ships all three, and the prompt is still under budget.
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  // THE EFFECTIVE ORDER IS TWO PIECES NOW, because the container is rendered
  // per vehicle and attached from the request rather than from PINNED_INPUTS.
  // Both pieces have to be read, or the lock would check half the sequence.
  const containerAt = fn.indexOf('role: "container"');
  const loopAt = fn.indexOf("for (const pinned of PINNED_INPUTS)");
  assert.ok(containerAt > 0 && loopAt > 0, "both attachment paths must exist");
  assert.ok(containerAt < loopAt,
    "the container is attachment (1) in the prompt, so it must be pushed before the pinned loop");
  const pinnedBlock = fn.slice(fn.indexOf("const PINNED_INPUTS"),
    fn.indexOf("] as const;", fn.indexOf("const PINNED_INPUTS")));
  const roles = ["container", ...[...pinnedBlock.matchAll(/role:\s*"([a-z]+)"/g)].map((m) => m[1])];
  assert.deepEqual(roles, ["container", "format", "installation"],
    "attachment order changed; the prompt's numbered list must change with it");

  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  });
  const tail = prompt.slice(prompt.indexOf("ATTACHED: (1)"));
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

test("the sheet's SHAPE is gated in the edge, and JPEG is what actually comes back", async () => {
  // Owner: the gate runs before the payload reaches the UI, with no stubs.
  // This is the half that can honestly execute in Deno -- the pixel gate needs
  // sharp, which Deno cannot load, and ImageScript decoding the real 17.15 MP
  // sheet costs ~69 MB of RGBA in a worker that has already died on a 504.
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.match(fn, /assertProofSheetShape\(bytes\)/, "the gate must run on the returned bytes");
  assert.ok(fn.indexOf("assertProofSheetShape(bytes)") < fn.indexOf("const storagePath"),
    "the gate must run BEFORE the sheet is stored or returned");
  assert.match(fn, /panel_proof_sheet_reflowed/,
    "a re-flowed sheet makes every fractional coordinate point elsewhere");

  // ⚠️ THE MODEL RETURNS JPEG. The first version of this gate read the PNG IHDR
  // at fixed offsets and threw on the real artifact -- it would have refused
  // EVERY proof on deploy. d5314267's bytes begin ff d8 ff e0 and `file` reads
  // "JPEG image data ... 5056x3392", while the upload named it .png with
  // contentType image/png. Both halves are fixed; this pins them.
  assert.match(fn, /readJpegSize/, "the gate must understand the format the model returns");
  assert.match(fn, /\$\{sha256\}\.\$\{sheetShape\.extension\}/,
    "a JPEG must not be stored under a .png name");
  assert.match(fn, /contentType: sheetShape\.mime/,
    "a JPEG must not be served as image/png");
  assert.ok(!/\.png`, bytes, \{ contentType: "image\/png"/.test(fn),
    "the hardcoded png upload must be gone");
});

test("the six panels are demanded ONCE each, because the live sheet drew FRONT twice", () => {
  // d5314267: ZONE 1 came back with SEVEN panels -- FRONT at 50.0" x 22.0"
  // drawn twice -- and ZONE 3 left two of its boxes empty. The contract had no
  // sentence forbidding either, so the model was not wrong to do it.
  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  });
  assert.match(prompt, /each drawn ONCE/);
  assert.match(prompt, /never repeated, never a seventh, never an empty box/);
  // AND THE EMPTY BOX IS NOW NAMED WITH WHAT FILLS IT. Zone 3 came back with
  // three of five boxes blank under a rule that only forbade blankness; a rule
  // with no content behind it cannot be followed.
  assert.match(prompt, /ZONE 3'S FIVE BOXES, every one filled:/);
  for (const slot of runtime.CUT_GRAPHIC_SLOTS) {
    assert.ok(prompt.includes(`  ${slot.caption}: `), `Zone 3 slot ${slot.caption} is unfilled`);
  }
});
