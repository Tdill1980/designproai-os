import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * THE PRODUCTION CALL-8 PROOF IS RECONCILED, NOT BYTE-COPIED.
 *
 * Canary 35212228736 (2026-09-17) completed every stage -- 6 panels, 6 Topaz
 * masters, 18 outputs, the ZIP, the WrapBox manifest, every hash verified --
 * and failed on ONE assertion: `productionFlatProofExactCopy`, which demanded
 * the two Call-8 proofs be byte-identical. They never can be. RULE 0.19 puts
 * `manifest.resolve` AFTER `await_purchase`, so the free entice proof composes
 * with `manifestHash: null`, and production rebuilds the same sheet against the
 * bound production dimensions and stamps the resolved manifest into it.
 *
 * The real contract is that the ARTWORK is identical, and these cases pin that:
 * a reconciled proof passes only while every tile cites the same master, the
 * same panel and the same placement, and only while production declares what it
 * reconciled. Tamper with any of those and it still refuses.
 */

const src = readFileSync(new URL("../scripts/production-canary.mjs", import.meta.url), "utf8");
const body = src.slice(
  src.indexOf("  // THE PRODUCTION CALL-8 PROOF IS RECONCILED"),
  src.indexOf("  const checks = {"),
);
assert.ok(body.length > 0, "the predicate must be findable in the canary");

const predicate = new Function(
  "enticeProof", "productionProof", "evidence",
  `${body}\nreturn productionFlatProofExactCopy;`,
);

const MASTER = "f".repeat(64);
const ENTICE_RUN = "ca3321bb-c6d4-4d35-9cf3-0f3aa3942ff7";
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];

const tile = (surfaceKey, index) => ({
  surfaceKey,
  sourcePanelHash: `${index}`.repeat(64),
  sourceMasterHash: MASTER,
  print: { x: index * 10, y: index * 20, w: 100, h: 200 },
  trim: { x: index * 10 + 5, y: index * 20 + 5, w: 90, h: 190 },
});

const tiles = () => SURFACES.map((surfaceKey, index) => tile(surfaceKey, index));
const panelHashes = () => Object.fromEntries(SURFACES.map((s, i) => [s, `${i}`.repeat(64)]));

const entice = () => ({
  run: "entice",
  hashVerified: true,
  contentHash: "a".repeat(64),
  storagePath: "designpro/entice/proof.png",
  metadata: { surfaceTiles: tiles(), sourcePanelHashes: panelHashes() },
});

/** What the live run actually produced: same artwork, restamped, declared. */
const reconciled = () => ({
  run: "production",
  hashVerified: true,
  contentHash: "b".repeat(64),
  storagePath: "designpro/production/proof.png",
  metadata: {
    surfaceTiles: tiles(),
    sourcePanelHashes: panelHashes(),
    sourceEnticeRunId: ENTICE_RUN,
    proofReconciledForProduction: true,
    originalEnticeProofHash: "a".repeat(64),
  },
});

/** The logo-only branch, which really does copy the bytes. */
const byteCopy = () => ({
  run: "production",
  hashVerified: true,
  contentHash: "a".repeat(64),
  storagePath: "designpro/production/proof.png",
  metadata: {
    surfaceTiles: tiles(),
    sourcePanelHashes: panelHashes(),
    sourceEnticeRunId: ENTICE_RUN,
    sourceContentHash: "a".repeat(64),
    sourceStoragePath: "designpro/entice/proof.png",
  },
});

const run = (production, ent = entice()) =>
  predicate(ent, production, { enticeRunId: ENTICE_RUN });

test("a reconciled proof passes when the artwork is identical tile for tile", () => {
  assert.equal(run(reconciled()), true);
});

test("a genuine byte copy still passes -- the logo-only branch is unchanged", () => {
  assert.equal(run(byteCopy()), true);
});

test("a production proof cut from DIFFERENT panels is refused", () => {
  const bad = reconciled();
  bad.metadata.surfaceTiles[0].sourcePanelHash = "9".repeat(64);
  assert.equal(run(bad), false, "swapping one surface's panel must refuse");
});

test("a production proof from a different MASTER is refused", () => {
  const bad = reconciled();
  bad.metadata.surfaceTiles = bad.metadata.surfaceTiles.map((t) => ({ ...t, sourceMasterHash: "e".repeat(64) }));
  assert.equal(run(bad), false, "a second design authority must refuse");
});

test("a production proof that MOVES a tile is refused", () => {
  const bad = reconciled();
  bad.metadata.surfaceTiles[2].print = { x: 999, y: 999, w: 100, h: 200 };
  assert.equal(run(bad), false, "same artwork in the wrong place is still wrong");
});

test("a production proof whose panel-hash map disagrees with its tiles is refused", () => {
  const bad = reconciled();
  bad.metadata.sourcePanelHashes = { ...panelHashes(), roof: "7".repeat(64) };
  assert.equal(run(bad), false);
});

test("different bytes with NO declared reconciliation is refused", () => {
  const bad = reconciled();
  delete bad.metadata.proofReconciledForProduction;
  assert.equal(run(bad), false, "an undeclared rebuild is exactly what this exists to catch");
});

test("a reconciliation naming the WRONG entice proof is refused", () => {
  const bad = reconciled();
  bad.metadata.originalEnticeProofHash = "c".repeat(64);
  assert.equal(run(bad), false);
});

test("a reconciliation from another entice RUN is refused", () => {
  const bad = reconciled();
  bad.metadata.sourceEnticeRunId = "00000000-0000-0000-0000-000000000000";
  assert.equal(run(bad), false);
});

test("an unverified hash on either side is refused", () => {
  assert.equal(run({ ...reconciled(), hashVerified: false }), false);
  assert.equal(run(reconciled(), { ...entice(), hashVerified: false }), false);
});

test("fewer than six surfaces on the entice proof is refused", () => {
  const short = entice();
  short.metadata.surfaceTiles = short.metadata.surfaceTiles.slice(0, 5);
  assert.equal(run(reconciled(), short), false, "cardinality is still counted");
});

test("the live 35212228736 evidence shape passes, and it is the reconciled one", () => {
  // The exact shape the failing run produced: different bytes, identical tiles,
  // declared reconciliation naming the entice proof.
  const production = reconciled();
  assert.notEqual(production.contentHash, entice().contentHash, "the fixture must not be a byte copy");
  assert.equal(production.metadata.proofReconciledForProduction, true);
  assert.equal(run(production), true);
});


test("automatic canary approvals reject another owner, revision, or run", async () => {
  const body = src.slice(src.indexOf("async function assertCanaryRun("), src.indexOf("async function confirmOwnerPromotionEntitlement("));
  const verify = new Function("fetchRun", "evidence", "CUSTOMER_EMAIL", "DESIGNATED_CUSTOMER_EMAIL",
    `${body}; return assertCanaryRun;`);
  const evidence = {operator:{id:"operator"},generationId:"gen",revisionId:"rev",enticeRunId:"entice",productionRunId:"prod"};
  const run = {owner_id:"operator",revision_id:"rev"};
  await verify(async()=>run,evidence,"test","test")("prod","gen");
  for (const row of [{...run,owner_id:"customer"},{...run,revision_id:"other"}]) {
    await assert.rejects(verify(async()=>row,evidence,"test","test")("prod","gen"),/outside the designated/);
  }
  await assert.rejects(verify(async()=>run,evidence,"test","test")("other","gen"),/outside the designated/);
  await assert.rejects(verify(async()=>run,evidence,"real-customer","test")("prod","gen"),/outside the designated/);
});

test("three-zone canary proves pristine composition and rejects missing logo or panel identity", () => {
  const body = src.slice(src.indexOf("  const panelProof = atlasRow.metadata?.panelProofAuthoring;"),
    src.indexOf("  // DECLARING THE BRAND FIELDS IS NOT THE SAME AS PROVING THE GRAPH RAN."));
  const verify = new Function("atlasRow","customerLogo","CALL_ONE_SURFACES","COMPANY_NAME","COMPANY_PHONE","COMPANY_WEBSITE","evidence","step",body);
  const logo = {assetRole:"logo",storagePath:"original.png",contentHash:"f".repeat(64),byteSize:100,contentType:"image/png",persisted:true};
  const panel = surfaceKey => ({surfaceKey,positionalPremiseVerified:true,persisted:true,storagePath:surfaceKey,contentHash:"a".repeat(64)});
  const proof = {composition:{contract:"designpro.production-zone-composite.v1",sourceAssetsPreserved:true,
    placements:SURFACES.filter(s=>s!=="roof").map(surfaceKey=>({...logo,role:"logo",surfaceKey,flipped:false}))},
    threeZoneLayout:{required:true},proofStoragePath:"proof.png",proofSha256:"e".repeat(64),
    quadrants:{branded:SURFACES.map(panel),clean:SURFACES.map(panel),cutGraphics:[logo]}};
  const check = p => verify({metadata:{panelProofAuthoring:p}},logo,SURFACES,"","","",{},()=>{});
  check(proof);
  const missingLogo = structuredClone(proof); missingLogo.quadrants.cutGraphics=[];
  assert.throws(()=>check(missingLogo),/preserve the exact uploaded/);
  const melted = structuredClone(proof); melted.composition.placements[0].contentHash="x".repeat(64);
  assert.throws(()=>check(melted),/did not receive pristine/);
  const unverified = structuredClone(proof); unverified.quadrants.clean[0].positionalPremiseVerified=false;
  assert.throws(()=>check(unverified),/unverified panel identities/);
});
