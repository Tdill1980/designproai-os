// ARCHITECTURE_DAG.md chunk 7 — THE CLEAN BASE (owner ruling, 2026-09-17).
//
// Layer 0. Under the element graph the company name, the logo and the contact
// bar are their own deterministic artifacts, composited by code at a known box,
// so the authored surface must carry none of them. This is the RestylePro
// model: the clean base is AUTHORED, never stripped. Stripping smears — which
// is why `liftoverlays` was gated off over there, and why every passenger
// defect since 2026-09-07 has been a re-drop over artwork with type baked in.
//
// What is locked here:
//
//   1. IT REPLACES THE BRAND BLOCK, it does not append to it. Leaving the logo
//      direction in place and then adding "no lettering" is the negative-
//      instruction shape CLAUDE.md warns about in four separate places, and
//      which has failed 4/4 on the field map.
//   2. IT REACHES BOTH HALVES OF HERO-FIRST. A vehicle view with a painted name
//      flattens into a flank with a painted name, so the clean base starts at
//      the render.
//   3. ONE FLAG DECIDES BOTH HALVES. A clean base with no element nodes would
//      ship a wrap with no company name on it at all, so `cleanBaseEnabled`
//      reads the SAME env key the element graph does — they cannot be half-on.
//   4. THE FIELD TAIL IS UNTOUCHED. RULE 0.37 forbids changing it without a
//      side-by-side against the 09-04 Arctic Air and 09-08 Precision sheets.
//      This contract is scoped to the hero author and must not appear in the
//      field or six-surface contracts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const hero = runtimeRequire(join(HERE, "..", "runtime", "atlas-hero-driver.cjs"));
const EDGE = readFileSync(join(HERE, "..", "supabase", "functions", "design-panel-ai-generate", "index.ts"), "utf8");
const RUNTIME = readFileSync(join(HERE, "..", "runtime", "atlas-hero-driver.cjs"), "utf8");

const withFlag = (value, fn) => {
  const before = process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  if (value === null) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
    else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = before;
  }
};

test("the runtime and the edge advance their prompt version TOGETHER", () => {
  const edgeVersion = /const ATLAS_AUTHOR_PROMPT_VERSION = "([^"]+)"/.exec(EDGE)?.[1];
  assert.equal(edgeVersion, hero.HERO_DRIVER_PROMPT_VERSION,
    "a runtime that sends one version to an edge pinned to another is refused at the door");
  assert.match(edgeVersion, /v4-clean-base$/, "the request contract changed, so the version must say so");
});

test("ONE flag decides the clean base and the element nodes", () => {
  assert.equal(withFlag(null, () => hero.cleanBaseEnabled()), false);
  assert.equal(withFlag("off", () => hero.cleanBaseEnabled()), false);
  assert.equal(withFlag("ON PLEASE", () => hero.cleanBaseEnabled()), false, "a typo must not author a nameless wrap");
  assert.equal(withFlag("on", () => hero.cleanBaseEnabled()), true);

  // The same key the graph compiles element nodes from. Half-on is the failure
  // that ships a wrap with no company name anywhere on it.
  assert.match(RUNTIME, /DESIGNPRO_ATLAS_ELEMENT_GRAPH/,
    "cleanBaseEnabled must read the element graph's own key, not a second one");
});

test("the request carries cleanBase only when the flag is on", () => {
  const brief = { companyName: "Precision Climate", phone: "(520) 555-0192", vehicle: { make: "Ford" } };
  const off = withFlag("off", () => hero.heroRequestBody(brief));
  const on = withFlag("on", () => hero.heroRequestBody(brief));
  assert.equal(off.cleanBase, undefined, "off must be byte-identical to the previous contract");
  assert.equal(on.cleanBase, true);

  // The brief's own fields still ride along either way — the element nodes read
  // them, and suppressing them here would leave nothing to set.
  for (const body of [off, on]) {
    assert.equal(body.companyName, "Precision Climate");
    assert.equal(body.phone, "(520) 555-0192");
  }
});

test("the clean base REPLACES the brand block rather than appending a negative", () => {
  assert.match(EDGE, /const ATLAS_CLEAN_BASE_CONTRACT\s*=/);
  const contract = /const ATLAS_CLEAN_BASE_CONTRACT\s*=\s*\n?\s*`([^`]+)`/.exec(EDGE)?.[1];
  assert.ok(contract, "the contract text must be one named constant, not inline prose");
  assert.match(contract, /BACKGROUND ARTWORK ONLY/);
  assert.match(contract, /added afterwards as separate print layers/,
    "it must say WHY there is no type, or the model is only being told not to");

  // Each of the four brand producers is behind the clean-base branch.
  for (const producer of [
    "assembled += ATLAS_CLEAN_BASE_CONTRACT;",
    "} else if (companyName) {",
    "} else if (phone) {",
    "} else if (website) {",
    "} else if (textLayerPrompt) {",
  ]) {
    assert.ok(EDGE.includes(producer), `expected the clean-base branch at: ${producer}`);
  }
  // buildLogoArchitecture is the designed-logo direction. It must be on the
  // ELSE side — a clean base that still asks for a logo is not a clean base.
  const cleanBranch = EDGE.slice(EDGE.indexOf("if (atlasCleanBase) {"), EDGE.indexOf("} else if (companyName) {"));
  assert.ok(!cleanBranch.includes("buildLogoArchitecture"), "the logo direction must not survive into the clean base");
});

test("it reaches BOTH halves of hero-first, not just the flatten", () => {
  // atlasHeroSurface is undefined on the flatten, so a flag hung off that
  // object would silently skip stage 2. It is its own top-level param.
  assert.match(EDGE, /atlasCleanBase: body\.cleanBase === true,/);
  const assembly = EDGE.slice(EDGE.indexOf("atlasFlatMaster: !heroFlatten,"));
  assert.ok(assembly.slice(0, 600).includes("atlasCleanBase:"),
    "the clean base must be set on the shared assembly, beside atlasFlatMaster");
});

test("the FIELD tail is untouched — RULE 0.37 is not being argued with", () => {
  // The field contract has its own function and its own owner-locked wording.
  const fieldContract = EDGE.slice(EDGE.indexOf("function atlasFieldContract"));
  const fieldBody = fieldContract.slice(0, fieldContract.indexOf("\n}\n"));
  assert.ok(!fieldBody.includes("atlasCleanBase"), "the field tail must not read the clean-base flag");
  assert.ok(!fieldBody.includes("ATLAS_CLEAN_BASE_CONTRACT"));

  // And the six-surface flat-master contract likewise.
  const flatContract = EDGE.slice(EDGE.indexOf("function atlasFlatMasterContract"));
  const flatBody = flatContract.slice(0, flatContract.indexOf("\n}\n"));
  assert.ok(!flatBody.includes("ATLAS_CLEAN_BASE_CONTRACT"));
});

test("with the flag off, nothing about the brand block moved", () => {
  // The exact producers the previous contract used are all still present and
  // still reachable — the clean base is a new branch, not a rewrite.
  assert.match(EDGE, /assembled \+= `\\nBusiness: \$\{companyName\}\.\$\{buildLogoArchitecture\(companyName, industryType\)\}`;/);
  assert.match(EDGE, /Contact info \(place in the contact bar\): \$\{phone\}/);
  assert.match(EDGE, /Website \(place in the contact bar\): \$\{website\}/);
  assert.match(EDGE, /TEXT LAYER DIRECTION \(customer-authored\)/);
});
