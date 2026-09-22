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
import { runInNewContext } from "node:vm";
import { loadDesignIQ, ATLAS_PANELS } from "./helpers/load-designiq.mjs";

const require = createRequire(import.meta.url);
const runtime = require("../runtime/atlas-panel-proof-contract.cjs");
const containerTemplate = require("../runtime/atlas-proof-container-template.cjs");

test("Call 1 supplies system-level Studio assembly boundaries and keeps images in user parts", () => {
  const source = readFileSync(new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("const modelRequest = JSON.stringify({");
  const end = source.indexOf("\n    });",start)+7;
  const parts = [{inlineData:{mimeType:"image/png",data:"fixture-template"}}];
  // `designExchange`/`turns` are null on this branch: `separatedArtwork` asks
  // for artwork alone with no document and no container, so it has nothing to
  // split and stays the single turn it has always been. The anchored shape has
  // its own case below.
  const request = JSON.parse(runInNewContext(`${source.slice(start,end)}; modelRequest`,
    {body:{separatedArtwork:true},parts,designExchange:null,turns:null,structuralParts:[]}));
  assert.match(request.systemInstruction.parts[0].text,/A.C.E./);
  assert.match(request.systemInstruction.parts[0].text,/complete three-zone Studio production proof/);
  assert.match(request.systemInstruction.parts[0].text,/Never paint document annotations into panel textures/);
  assert.equal(request.contents[0].role,"user");
  assert.equal(request.contents[0].parts[0].inlineData.data,"fixture-template");
  assert.equal(request.generationConfig.imageConfig.aspectRatio,"3:2");

  // ═══ THE ANCHORED SHAPE — ONE CONVERSATION, NOT ONE BAG ═══
  //
  // Owner, 2026-09-21: "do the multitodal thought signatures", "multi modal",
  // "WHy is model not being anchored".
  //
  // Live sheet 7a72951823648d27 sent `contents: [{role:"user", parts}]` -- ONE
  // turn carrying 5,106 characters and four images, and `thoughtSignatureCount`
  // on its receipt was a signature that came BACK. Nothing was ever replayed
  // IN. Google's documented pattern is the opposite: generate, then continue.
  //
  // THE MODEL TURN IS REPLAYED VERBATIM. That is the assertion that matters:
  // `thoughtSignature` is opaque metadata bound to the part it arrived on, and
  // a tidied-up reconstruction of the model's reply is a NEW conversation that
  // happens to contain an image. `gemini-image-history.mjs` opens with that
  // rule; this pins that this file obeys it.
  const modelTurn = { role: "model", parts: [
    { text: "concept" },
    { inlineData: { mimeType: "image/png", data: "fixture-design" }, thoughtSignature: "sig-abc" },
  ] };
  const userTurn = { role: "user", parts: [{ text: "design ask" }] };
  const anchored = JSON.parse(runInNewContext(`${source.slice(start,end)}; modelRequest`, {
    body: {}, parts,
    designExchange: { user: userTurn, model: modelTurn },
    turns: { design: "design ask", layout: "layout ask" },
    structuralParts: [{ inlineData: { mimeType: "image/png", data: "fixture-container" } }],
  }));
  assert.equal(anchored.contents.length, 3, "design user turn, model reply, layout user turn");
  assert.deepEqual(anchored.contents[0], userTurn);
  assert.deepEqual(anchored.contents[1], modelTurn,
    "the model's reply must be replayed byte for byte, signature on the part it arrived on");
  assert.equal(anchored.contents[1].parts[1].thoughtSignature, "sig-abc");
  assert.equal(anchored.contents[2].role, "user");
  assert.equal(anchored.contents[2].parts[0].text, "layout ask");
  // THE STRUCTURAL REFERENCES RIDE THE LAYOUT TURN, NOT THE DESIGN TURN.
  // RULE 0.24 keeps three reference classes apart and they were all arriving in
  // one undifferentiated bag; a blank container template competing with the
  // customer's own reference photograph is the role dilution Google's guidance
  // names directly.
  assert.equal(anchored.contents[2].parts[1].inlineData.data, "fixture-container");
});
const edgeSource = readFileSync(
  new URL("../supabase/functions/_shared/atlas-panel-proof-prompt.ts", import.meta.url), "utf8");

test("the two anchored turns still carry every section the single prompt does", () => {
  // ANTI-DRIFT, AND HONEST ABOUT WHAT IT CHECKS. `buildPanelProofTurns` and
  // `buildPanelProofPrompt` are not derived from one another -- deliberately,
  // so adding the conversation could not change the single-turn ask by one
  // byte -- and two independent assemblies of the same contract is exactly the
  // shape this repo has watched drift four times ("one artifact, two producers,
  // which is how a fix here keeps coming undone").
  //
  // The tests in this file execute the RUNTIME twin, which has no
  // `buildPanelProofTurns` (it would be dead code there, and dead code is what
  // drifts). So this reads the source and checks the SECTIONS, which is the
  // failure that matters: a constant silently present in one assembly and
  // absent from the other. It cannot check wording, and does not claim to.
  const body = edgeSource.slice(
    edgeSource.indexOf("export function buildPanelProofTurns"),
    edgeSource.indexOf("export function buildPanelProofPrompt"));
  assert.ok(body.length > 0, "buildPanelProofTurns must exist");
  const design = body.slice(0, body.indexOf("const layout: string[] = ["));
  const layout = body.slice(body.indexOf("const layout: string[] = ["));

  // TURN 1 IS THE DESIGN, and the word "document" never reaches it. The panel
  // is a solid rectangle is a property of the ARTWORK, so it belongs here.
  assert.match(design, /INSTALLATION_FACT/);
  assert.match(design, /THE SIX PANELS/);
  assert.match(design, /EXACT TEXT, character for character/);
  // THE SMALL-PANELS LINE IS GONE FROM BOTH ASSEMBLIES (owner, 2026-09-22:
  // "Ace creates a logo font, uses that throughout"). It was a composition
  // rule written by code -- hood, front and rear "carry the logo and ONE line
  // at most" -- standing between the persona and its own judgement. This lock
  // used to REQUIRE it; a lock that pins a defect is the shape this repo has
  // recorded eight times.
  assert.doesNotMatch(design, /THE SMALL PANELS/, "no code-authored composition rule in turn 1");
  assert.doesNotMatch(layout, /THE SMALL PANELS/, "no code-authored composition rule in turn 2");
  for (const documentOnly of ["SYSTEM_JOB", "VERSIONS", "CUT_GRAPHIC_SLOTS", "SHEET_LAYOUT"]) {
    assert.doesNotMatch(design, new RegExp(documentOnly),
      `${documentOnly} is document vocabulary and must not compete with designing in turn 1`);
  }

  // TURN 2 IS THE LAYOUT, and it carries every section the single prompt's
  // document half carries.
  for (const section of ["SYSTEM_JOB", "VERSIONS", "CUT_GRAPHIC_SLOTS", "SHEET_LAYOUT"]) {
    assert.match(layout, new RegExp(section), `turn 2 lost ${section}`);
  }
  // AND IT SAYS IT IS A CONTINUATION. Without this the second turn reads as a
  // fresh brief that happens to follow a picture, which is the thing the
  // conversation exists to stop.
  assert.match(layout, /Keep that exact design/);
});

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

  // THE ASK IS NOW THE ARTWORK, NOT THE DOCUMENT — and that is the fix for the
  // owner's "dimension hallucination", so it is asserted rather than assumed.
  // This used to pin "the document a print shop receives", which asked the model
  // to DRAW the header, the captions and every figure. It did, and live sheet
  // 35393135814 answered one 141 x 78 request with 195.7 x 89.6 in Zone 1,
  // 155.7 x 49.6 in Zone 2 and 105.7 x 49.6 in its own reference table — three
  // answers to one question. Baking the numbers into the attachment had already
  // been shipped and did not help (that container carried "141.0" ten times),
  // because the model redraws the document rather than filling it.
  // A number the model never types is a number it cannot get wrong, so the
  // document is composited by code and the ask is the panels alone.
  assert.match(runtime.SYSTEM_JOB, /DRAW ONLY THE PANELS/);
  assert.match(runtime.SYSTEM_JOB, /printed onto this\s+sheet by the press/,
    "the model must be told the document arrives after it, not that it draws one");
  assert.match(runtime.SYSTEM_JOB, /not a panel plain white/);

  // A positive physical fact, never a prohibition. "Do not draw wheel arches"
  // is the negative shape CLAUDE.md warns about in four places and which has
  // failed 4/4 on the field map.
  assert.match(runtime.INSTALLATION_FACT, /ONE CONTINUOUS PANEL/);
  // THE SENTENCE THAT RULES OUT A DIE-CUT PANEL IS PRESENT, and this is the
  // lock on it. It was once cut to 90 characters for budget and live sheet
  // 35389031759 came back with the windshield cut out of both flanks. RULE
  // 0.32's acceptance contract is not a nice-to-have in this prompt; it IS the
  // prompt.
  assert.match(runtime.INSTALLATION_FACT, /SOLID RECTANGLE of artwork/);

  // ⚠️ THIS LOCK USED TO PIN THE NEGATIVE, UNDER A TEST NAMED "POSITIVE".
  //
  // It asserted the literal "no holes and no vehicle-shaped outline" while its
  // own comment four lines above says a prohibition is "the negative shape
  // CLAUDE.md warns about in four places and which has failed 4/4 on the field
  // map". So the restoration after 35389031759 brought the sentence back in the
  // form the file already knew was wrong, and the lock then held it there.
  //
  // THE EVIDENCE THAT IT DOES NOT WORK: live sheet 7a72951823648d27
  // (2026-09-21) carried that exact clause and still returned both flanks
  // die-cut to the van outline -- diecut.json, zone1 dieCut true, two enclosed
  // openings, the windshield. Zone 2, drawn from the same design in the same
  // pass, came back as clean rectangles. The clause is not what makes the
  // difference, and naming "vehicle-shaped outline" is what the model drew.
  //
  // Google's own published guidance says the same thing under "semantic
  // negative prompts": describe the scene you want rather than the thing to
  // leave out. So the rule stays and its GRAMMAR changes -- the panel is
  // described by what it IS, four straight edges, four square corners.
  assert.match(runtime.INSTALLATION_FACT, /four straight edges, four square corners/);
  assert.doesNotMatch(runtime.INSTALLATION_FACT, /no holes|vehicle-shaped outline/,
    "the installation fact must state the panel's shape, never prohibit the vehicle's");
  assert.match(runtime.INSTALLATION_FACT, /artwork runs straight through the places those openings will be/);

  // AND THE OTHER HALF OF RULE 0.28 §3: "Filled edge to edge. Artwork runs off
  // all four sides of its rectangle." That sentence was absent from this
  // contract entirely -- the prompt said a panel is a solid rectangle and never
  // said its artwork must REACH the cell's four edges, so probe 35430383420
  // measured the branded band at fits of 0.61-0.86 with white inside every
  // cell. A solid rectangle inset in its box is still a solid rectangle; it is
  // just the wrong size, and the cutter then crops white.
  //
  // It is stated as the bleed's own physics and joined to the trim-line
  // sentence, because the frame line is the thing the model was composing
  // inside of.
  assert.match(runtime.INSTALLATION_FACT, /fills its cell corner to corner/);
  assert.match(runtime.INSTALLATION_FACT, /out past the frame line on\nall four sides/);
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
  assert.match(prompt, /THE THREE BANDS, in this order:/);
  assert.match(prompt, /Fill the attached template; do not re-flow it/,
    "the chrome is composited at the container's own cell positions, so a re-flow "
    + "puts every caption under the wrong panel");

  // THE JOB BLOCK LEFT THE PROMPT AND MUST LAND ON THE SHEET ANYWAY. It used to
  // be asserted here, and once the model was told to draw no document that
  // instruction became one it is told to ignore — so the order number has to be
  // drawn by the compositor instead, or removing the ask silently loses it.
  // Asserting the prompt no longer carries it WITHOUT asserting the sheet does
  // is how a field disappears while every test stays green.
  assert.doesNotMatch(prompt, /JOB BLOCK/,
    "the code draws the job block; asking the model for it is noise in the design's budget");
  const chrome = containerTemplate.containerSvg({
    manifest: containerTemplate.parsePanelRows([
      'DRIVER: 165.7" wide x 49.6" high', 'PASSENGER: 165.7" wide x 49.6" high',
      'ROOF: 110.2" wide x 55.1" high', 'HOOD: 55.9" wide x 48.0" high',
      'FRONT: 50.0" wide x 22.0" high', 'REAR: 55.1" wide x 30.7" high',
    ]),
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", mode: "chrome",
    job: { date: "2026-09-18", order: "BS-2012PRIUS-01", designer: "A.L.", version: "1.0" },
  });
  assert.ok(chrome.includes("BS-2012PRIUS-01"), "the job block must reach the header the code draws");
  assert.ok(chrome.includes("A.L."), "every supplied job field must be drawn, not just the order");

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
  //
  // 2600 -> 2700, and the 70 characters that bought it are RULE 0.28 §3's
  // fill-the-cell rule (measured: 2670). That is deliberately the opposite of
  // what happened last time this bound bit: the acceptance contract was the
  // first thing cut for budget, and the next live sheet came back die-cut. This
  // file's own reasoning twenty lines down is that a FIXED TOTAL is the wrong
  // lock -- the meaningful ones are `added <= 1200` and designer-outweighs-
  // paperwork below, and BOTH still pass unchanged at the new value. So the
  // number moved and neither ratio did.
  //
  // Cut packaging to get under it. Never cut the acceptance contract.
  assert.ok(prompt.length < 2700,
    `the document contract alone is ${prompt.length} chars; it must stay under 2700`);

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

/**
 * NO PHOTOGRAPH OF A VEHICLE MAY REACH CALL 1. THIRD TIME THIS HAS BEEN WRITTEN
 * DOWN; FIRST TIME IT IS A TEST.
 *
 * RULE 0.0, on canary 33389124918: "An installed/3D vehicle proof is not a
 * Call-1 teaching input ... the finished-vehicle image OVERPOWERED the
 * flat-source instructions and leaked vehicle/template anatomy into the
 * canonical rectangles." RULE 0.15 records the same finding from the other
 * side: the installed proof "was the strongest visual instruction".
 *
 * Both times it was written as prose, and both times it came back. This studio
 * attached `installer-one-panel-per-side.png` — an installer laying vinyl over
 * a car in a workshop — as "the physical reason a panel is one rectangle", and
 * live sheet 35402317471 returned Zone 1 and Zone 2 as pictures of a van while
 * the prompt said SOLID RECTANGLE and the pinned example showed six plain
 * rectangles. An image outranks a sentence. The sentence keeps the physical
 * fact; the picture does not get to come back.
 *
 * Owner ruling, 2026-09-18: "there shouldn't be any shapes, just the cut logo
 * shapes" — Zones 1 and 2 are plain rectangles and only Zone 3 holds shapes.
 */
test("no photograph of a vehicle is attached to Call 1", () => {
  const fn = readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const pinnedBlock = fn.slice(fn.indexOf("const PINNED_INPUTS"),
    fn.indexOf("] as const;", fn.indexOf("const PINNED_INPUTS")));

  // THE ASSERTION IS ON THE ATTACHED SET, not on one filename — renaming the
  // file would otherwise walk straight through this lock.
  for (const banned of ["installer", "installed", "photo", "vehicle", "truck", "van", "car"]) {
    assert.ok(!new RegExp(banned, "i").test(pinnedBlock),
      `PINNED_INPUTS names "${banned}" — a photograph of a vehicle is the one attachment `
      + "this request may never carry (RULE 0.0, canary 33389124918)");
  }
  // Exactly one pinned image, and it is the owner's flat format sheet.
  const paths = [...pinnedBlock.matchAll(/path:\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(paths, ["PANEL_PROOF_FORMAT_EXAMPLE.path"],
    "the only pinned attachment is the owner's flat proof sheet");

  // AND THE PROMPT MUST NOT ADVERTISE ONE EITHER. A tail that names an
  // attachment the request does not carry is the defect CLAUDE.md records under
  // "a prompt may not cite attachments the request does not carry".
  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  });
  assert.doesNotMatch(prompt, /INSTALLATION PHOTOGRAPH/,
    "the prompt still names a photograph the request no longer sends");

  // The physical fact survives in WORDS, which is where it belongs.
  assert.match(runtime.INSTALLATION_FACT, /ONE CONTINUOUS PANEL/);
  assert.match(runtime.INSTALLATION_FACT, /SOLID RECTANGLE of artwork/);
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
  const loopAt = fn.indexOf("for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS))");
  assert.ok(containerAt > 0 && loopAt > 0, "both attachment paths must exist");
  assert.ok(containerAt < loopAt,
    "the container is attachment (1) in the prompt, so it must be pushed before the pinned loop");
  const pinnedBlock = fn.slice(fn.indexOf("const PINNED_INPUTS"),
    fn.indexOf("] as const;", fn.indexOf("const PINNED_INPUTS")));
  const roles = ["container", ...[...pinnedBlock.matchAll(/role:\s*"([a-z]+)"/g)].map((m) => m[1])];
  assert.deepEqual(roles, ["container", "format"],
    "attachment order changed; the prompt's numbered list must change with it");

  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "X" }, manifest: { zones: [] }, creativeDirection: "y",
  });
  const tail = prompt.slice(prompt.indexOf("ATTACHED: (1)"));
  assert.ok(tail, "the prompt must name its attachments");
  const named = [
    ["container", tail.indexOf("BLANK CONTAINER TEMPLATE")],
    ["format", tail.indexOf("FINISHED PROOF")],
  ];
  for (const [role, at] of named) assert.ok(at >= 0, `the prompt never names the ${role} attachment`);
  assert.deepEqual(named.sort((a, b) => a[1] - b[1]).map(([role]) => role), roles,
    "the prompt lists the attachments in a different order than the function attaches them");

  // THE TWO ATTACHMENTS GOVERN DIFFERENT THINGS, AND THE PROMPT MUST SAY WHICH.
  //
  // Owner, 2026-09-18: "Are we not expecting Gemini to fit in rectangles? Each
  // vehicle's diff. We should fix system example perhaps." Measured across three
  // real manifests, the pinned example's cells are one vehicle's: its driver is
  // 3.34:1 against the Transit's 3.25 (close) and the F250's 4.19 (25% out), and
  // its ROOF is 0.77 — portrait — where the F250's is 1.21, landscape. A sheet
  // that is the standard for LAYOUT is therefore the wrong authority for SHAPE.
  //
  // The container is already redrawn per vehicle and is attachment (1), so the
  // fix is not a per-vehicle example — regenerating that sheet with a model
  // reintroduces the hallucinated figures this whole contract removed. It is to
  // say which attachment owns which decision.
  assert.match(tail, /drawn for THIS vehicle/,
    "the container must be named as the per-vehicle shape authority");
  assert.match(tail, /take no shape or figure from it/,
    "the example must be excluded as a shape authority, or its one vehicle teaches every vehicle");

  // And only the FILLED sheet is the standard. Saying it of the blank one is
  // the exact failure this test exists to catch, so say it of neither by
  // accident: the phrase must sit in item (2), AFTER the container.
  const standardAt = tail.indexOf("the standard for the QUALITY");
  assert.ok(standardAt >= 0, "the prompt no longer names a standard at all");
  assert.ok(standardAt > tail.indexOf("BLANK CONTAINER TEMPLATE"),
    "the standard must describe the finished proof, never the blank template");
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

test("the six-surface master gates are ADVISORY on the panel proof: recorded on the receipt, never a refusal, never a ledger row", async () => {
  // Owner, 2026-09-22: "System must not issue fails because of no atlas." The
  // vehicle-sheet gates convicted a live panel proof on `rear edgeHoleRatio=0.42`
  // (2026-09-21). On this topology both verdicts are measured and RECORDED as
  // `masterGateAdvisory`; the candidate is accepted. The same slice, executed
  // with `panelProof: false`, still refuses -- the gates are unchanged for the
  // topology they were built for.
  const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  const atlas = require("../runtime/flat-first-atlas.cjs");
  // The six-surface branch comes FIRST in the source, deliberately: the
  // output-class gate lock (`atlas-output-class-gate.test.mjs`) reads the
  // loop's ORDER — deterministic checks, then the class gate, then acceptance
  // — and the advisory `else` must not put a `classifyAtlasCandidate` ahead of
  // `deterministic.blockingFailures` in reading order.
  const gateStart = source.indexOf("      if (!panelProof) {\n      stillBlocking = [...(deterministic.blockingFailures");
  const gateEnd = source.indexOf("    const refusalReason = stillBlocking.join", gateStart);
  assert.ok(gateStart > 0 && gateEnd > gateStart, "the advisory branch must exist inside the candidate loop");
  assert.ok(source.slice(gateStart, gateEnd).includes("// ADVISORY ON THE PANEL PROOF"),
    "the advisory branch is the else of the six-surface gate");
  // The slice ends with the advisory `else` closing AND the enclosing
  // `} else {` of the noImage branch closing; drop the outer one so the
  // if/else executes standalone.
  const gate = source.slice(gateStart, gateEnd).replace(/\n\s*\}\s*$/, "\n");
  const deterministic = { accepted: false, blockingFailures: ["rear: edgeHoleRatio 0.42 exceeds 0.35"],
    cutoutFindings: [], zones: [{ surfaceKey: "rear", edgeHoleRatio: 0.42, nonBlackFraction: 0.9, opaqueRatio: 1 }] };
  const outputClass = { contract: "designpro.atlas-output-class-gate.v1", disposition: "vehicle_depiction",
    blocking: true, confidence: 1, evidence: "a truck", candidateSha256: "a".repeat(64) };
  for (const panelProof of [true, false]) {
    // THE CLASS VERDICT IS HELD BACK until the test releases it. On the panel
    // proof the inspector is advisory and runs OFF the critical path (latency,
    // 2026-09-22), so acceptance must complete while this promise is still
    // pending; the pre-change branch awaited it inline and would sit here for
    // the whole Flash round trip -- which the race below turns into a failure
    // instead of a hang. Six-surface still awaits it: the gate is unchanged.
    let releaseVerdict;
    const verdict = new Promise((resolve) => { releaseVerdict = () => resolve(outputClass); });
    const sandbox = {
      panelProof, attempt: 2, provider: {}, masterBytes: Buffer.from("m"), manifest: { zones: [] },
      timings: { outputClassMs: 0, advisoryClass: { offCriticalPath: true, ms: 0, calls: 0 } }, logger() {}, Date,
      deterministic, masterCutoutSurfaces: [], masterCutoutFindings: [],
      outputClassReceipt: null, masterGateAdvisory: null, stillBlocking: null, refusalCode: null,
      async classifyAtlasCandidate() { return panelProof ? verdict : outputClass; },
      panelProofGateAdvisory: atlas._test.panelProofGateAdvisory,
      advisoryClass: null,
    };
    sandbox.advisoryClass = panelProof ? atlas._test.createPanelProofAdvisoryClassifier({
      classify: () => verdict, provider: sandbox.provider, zones: sandbox.manifest.zones,
      timings: sandbox.timings, logger() {},
      publish: (next) => { sandbox.outputClassReceipt = next.outputClassReceipt; sandbox.masterGateAdvisory = next.masterGateAdvisory; },
    }) : null;
    const accepted = runInNewContext(`(async () => { ${gate} })()`, sandbox);
    if (panelProof) {
      const outcome = await Promise.race([accepted.then(() => "accepted"),
        new Promise((resolve) => setTimeout(() => resolve("still waiting on the inspector"), 500).unref())]);
      assert.equal(outcome, "accepted", "the panel proof must be accepted while the class verdict is still in flight");
    } else {
      await accepted;
    }
    // Arrays made inside the VM realm carry the sandbox's Array prototype, so
    // they are spread into host arrays before a strict deep comparison.
    if (panelProof) {
      assert.deepEqual([...sandbox.stillBlocking], [], "the panel proof is ACCEPTED");
      assert.equal(sandbox.refusalCode, null);
      // The deterministic findings are on the receipt BEFORE the verdict: a
      // checkpoint written in this window carries a valid advisory receipt
      // (contract, advisory:true, refused:false) that names the real finding.
      const interim = sandbox.masterGateAdvisory;
      assert.equal(interim.contract, atlas._test.MASTER_GATE_ADVISORY_CONTRACT);
      assert.equal(interim.advisory, true);
      assert.equal(interim.refused, false);
      assert.deepEqual([...interim.findings.map((f) => f.code)], ["flat_atlas_master_deterministic_failed"]);
      assert.equal(interim.outputClass, null, "not measured yet, and never pretended to be");
      assert.equal(sandbox.outputClassReceipt, null);
      assert.equal(sandbox.advisoryClass.pending(), true);
      // Then the verdict lands and is JOINED: the same receipt the inline
      // inspector recorded, class finding included.
      releaseVerdict();
      await sandbox.advisoryClass.settle();
      assert.equal(sandbox.advisoryClass.pending(), false);
      assert.equal(sandbox.timings.advisoryClass.calls, 1);
      assert.equal(sandbox.timings.outputClassMs, 0, "the inspector's time is not billed to the critical path");
      assert.equal(sandbox.outputClassReceipt, outputClass);
      const advisory = sandbox.masterGateAdvisory;
      assert.equal(advisory.contract, atlas._test.MASTER_GATE_ADVISORY_CONTRACT);
      assert.equal(advisory.advisory, true);
      assert.equal(advisory.refused, false);
      assert.equal(advisory.candidate, 2);
      assert.equal(advisory.stage, "candidate");
      assert.deepEqual([...advisory.findings.map((f) => f.code)],
        ["flat_atlas_master_deterministic_failed", "flat_atlas_master_output_class_invalid"]);
      assert.match(advisory.findings[0].finding, /rear: edgeHoleRatio 0\.42/, "the gate's real finding is on the receipt");
      assert.equal(advisory.outputClass.disposition, "vehicle_depiction");
      assert.equal(advisory.deterministic.zones[0].edgeHoleRatio, 0.42);
    } else {
      assert.deepEqual([...sandbox.stillBlocking], ["rear: edgeHoleRatio 0.42 exceeds 0.35"], "six-surface still refuses");
      assert.equal(sandbox.refusalCode, "flat_atlas_master_deterministic_failed");
      assert.equal(sandbox.masterGateAdvisory, null);
    }
  }
  // And the map-drawn verdict keeps its own code on the advisory too.
  const mapped = atlas._test.panelProofGateAdvisory({ candidate: 1, deterministic: { accepted: true, blockingFailures: [], cutoutFindings: [], zones: [] },
    outputClass: { ...outputClass, disposition: "map_drawn" } });
  assert.deepEqual(mapped.findings.map((f) => f.code), ["flat_atlas_master_map_drawn"]);
});

test("a panel-proof budget spent is TERMINAL with the gate's real reason, and never invokes alternate artwork", async () => {
  // The exhausted-budget tail, executed with `panelProof: true`: the refusal
  // carries the recorded code and reason, `retryable` is false, and
  // `failOverToSixSurface` is never called -- there is no other Call 1.
  const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  const start = source.indexOf("    if (attempt === maxAuthoringAttempts) {", source.indexOf("const refusalReason = stillBlocking"));
  const end = source.indexOf("      if (!failoverEnabled) {", start);
  // The slice opens `if (attempt === maxAuthoringAttempts) {` and closes only
  // the inner panel-proof block, so one closer balances it.
  const branch = source.slice(start, end) + "}";
  for (const code of ["flat_atlas_master_no_image", "flat_atlas_master_deterministic_failed"]) {
    let alternateProviderCalls = 0;
    class FlatAtlasError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const reason = "original gate evidence retained verbatim";
    const run = runInNewContext(`(async () => { ${branch} })()`, {
      panelProof: true, attempt: 2, maxAuthoringAttempts: 2, refusalCode: code, refusalReason: reason,
      rawCandidates: "", FlatAtlasError, logger() {},
      async failOverToSixSurface() { alternateProviderCalls++; throw new Error("unexpected alternate provider"); },
    });
    await assert.rejects(run, (error) => error.code === code
      && /failed acceptance 2 times/.test(error.message) && error.message.includes(reason) && error.retryable === false);
    assert.equal(alternateProviderCalls, 0);
  }
  // And nothing ahead of the budget throws for the panel proof any more: the
  // slice from the refusal reason to the exhausted branch names no panelProof
  // throw, so candidate 1 of 2 proceeds to candidate 2.
  const ahead = source.slice(source.indexOf("const refusalReason = stillBlocking"), start);
  assert.ok(!ahead.includes("if (panelProof)"), "no panel-proof throw ahead of the attempt budget");
});

// ═══ CALL 1 READS THE CUSTOMER'S OWN WORDS, IN THE CUSTOMER'S MODE (owner, 2026-09-22) ═══
//
// Owner, on the live New Aura run: "it's not using designer brain" / "Design
// functions not being used or are used improperly." Three things the edge did:
// it let a Flash paraphrase REPLACE the brief whenever it kept 66% of the
// words; it hard-coded `mode: "commercial"` so the restyle persona never ran;
// and it threw away the designer's own DESIGN ANCHOR text, which the
// RestylePro photographer stage has always been handed as `designAnchorText`.
test("Call 1 reads the raw brief, selects the persona by the customer's mode, and keeps the designer's anchor", () => {
  const fn = readFileSync(new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const handler = fn.slice(fn.indexOf("serve(async (req)"));
  // The raw brief is the brief. No word-count rule may substitute a paraphrase.
  assert.match(handler, /const briefText = rawBrief \|\| extracted;/, "the customer's own sentence is the brief");
  assert.ok(!/0\.66/.test(handler), "the 66% paraphrase rule is gone");
  assert.match(handler, /briefSource: "raw"|briefSource = rawBrief \? "raw"/, "the receipt says which brief the designer read");
  // The Flash reader is skipped when the form supplied the company.
  assert.match(handler, /flashSkipped = Boolean\(customerPrompt\) && Boolean\(explicitCompany\)/);
  assert.match(handler, /skipped:company_name_supplied/);
  // The mode is the customer's, never a literal.
  const ace = handler.slice(handler.indexOf("panelProofCreativeHead(buildDesignIQPrompt({"), handler.indexOf("atlasProofSheet: true"));
  assert.ok(!/mode: "commercial"/.test(ace), "the persona is selected by the request's mode, not a literal");
  assert.match(ace, /\n\s*mode,\n/, "buildDesignIQPrompt receives the resolved mode");
  assert.match(handler, /const mode = String\(body\?\.mode \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "restyle" \? "restyle" : "commercial";/);
  // The phase-1 audit proves the persona the mode selects, on the payload.
  assert.match(handler, /Lead Vehicle Wrap Designer\/\.test\(prompt\)/);
  assert.match(handler, /DESIGN AMPLIFICATION: Elevate and enhance the brief\/\.test\(prompt\)/);
  // The designer's text part is captured and returned for the photographer.
  assert.match(handler, /const designAnchor = candidateParts/);
  assert.match(handler, /\n\s*designAnchor,\n/);
  assert.match(handler, /\n\s*mode,\n\s*designAnchor,/);
});

test("the head accepts either persona: the commercial designer or the restyle Lead Vehicle Wrap Designer", () => {
  const restyle = buildDesignIQPrompt({
    mode: "restyle", prompt: "Martini racing livery, white base, navy and red stripes", finish: "Gloss",
    substrate: "standard", vehicleYear: "2022", vehicleMake: "Porsche", vehicleModel: "911 Turbo",
    vehicleType: "car", viewType: "side", atlasFlatMaster: true, atlasProofSheet: true, atlasPanels: ATLAS_PANELS,
  });
  const head = runtime.panelProofCreativeHead(restyle);
  assert.match(head, /You are WePrintWraps\.com Lead Vehicle Wrap Designer/);
  assert.match(head, /DESIGN AMPLIFICATION: Elevate and enhance the brief/);
  // The restyle branch names the proof's own object, as the commercial one does.
  assert.match(head, /the panels themselves, as they look coming off the printer\. ONE design across all of them/);
  assert.ok(!head.includes("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"), "the artboard tail is cut on restyle too");
  assert.throws(() => runtime.panelProofCreativeHead("no designer here\nOUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"),
    /panel_proof_ace_persona_missing/);
});
