import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/**
 * SIDE IDENTITY IS ADDRESSED, NEVER SEARCHED FOR.
 *
 * Every surface already has two deterministic addresses: its own full-resolution
 * tile (`MasterSheetTile.sourceUrl`) and its exact pixel rectangle on the
 * composed sheet (x/y/w/h). Nothing downstream has any reason to ask a model
 * which side it is looking at.
 *
 * When it did, the answer skewed one way. An ambiguous search over an
 * all-sides proof resolves to the largest, most legible tile, and on every
 * proof sheet that is the DRIVER SIDE — the defect MASTER_SHEET_VERSION 6
 * exists to record ("v4 treated one driver field as an all-sides master"), seen
 * live as a giant driver lockup on FRONT.
 *
 * These assertions make a driver fallback impossible by construction rather
 * than by judgement, in every place a surface is resolved.
 */

test("panels address the master sheet by side, and a missing tile is an honest gap", () => {
  const entice = read("app/src/lib/enticePanelsFromProof.ts");

  // Addressed by side identity, not by position or by "the first one".
  assert.match(entice, /sheet\.tiles\.find\(\(t\) => t\.side === side\)/);
  assert.doesNotMatch(entice, /sheet\.tiles\[0\]/);

  // A side with no tile is recorded as missing and blocks the whole pack.
  // Borrowing another surface's pixels to fill the hole is the failure mode.
  assert.match(entice, /missingTiles\.push\(side\)/);
  assert.match(entice, /atomic panel build blocked; missing sides/);
  assert.match(entice, /panels\.length !== expectedSides\.length/);
});

test("the proof extractor is fed one side's own crop and is never asked to locate a side", () => {
  const sheet = read("app/src/lib/flatMasterSheet.ts");
  const extractor = sheet.slice(
    sheet.indexOf("const extractSideFromProof"),
    sheet.indexOf("// Per-side tile chain"),
  );
  assert.ok(extractor.length > 400, "extractSideFromProof moved — re-anchor this lock");

  // No tile for this side means no extraction rung at all.
  assert.match(extractor, /const tileUrl = tileCropBySide\.get\(side\);\s*\n\s*if \(!tileUrl\) return null;/);

  // The whole-proof feed is what let the extractor wander onto a neighbouring
  // tile, the sheet header, or the driver lockup. It must not come back.
  assert.doesNotMatch(extractor, /tileCropBySide\.get\(side\) \|\| proofUrl/);
  assert.doesNotMatch(extractor, /imageUrl: proofUrl/);
  assert.match(extractor, /imageUrl: tileUrl/);

  // The driver artboard may only ever reach the driver surface.
  assert.match(extractor, /side === "DRIVER SIDE" && params\.fallbackArtboardUrl/);
});

test("the server pack consumes its own rendered surface per side and refuses reuse", () => {
  const claimant = read("runtime/designpro-standalone-claimant.cjs");
  const call9 = claimant.slice(
    claimant.indexOf('if (stage.stage_key === "panels.build")'),
    claimant.indexOf('if (stage.stage_key === "logos.extract")'),
  );
  assert.ok(call9.length > 400, "the panels.build stage moved — re-anchor this lock");

  // One rendered surface per output side: nothing to crop, nothing to locate.
  assert.match(call9, /Consume, never cut/);
  // Two sides that share bytes mean one side was reused for another.
  assert.match(call9, /call9_surface_reuse/);
  assert.match(call9, /panelHashes\.driver === panelHashes\.passenger/);
  assert.match(call9, /call9_driver_passenger_reuse/);
  // Geometry comes from the bound GENIE manifest, per surface key.
  assert.match(call9, /call9_geometry_drift/);
  assert.match(call9, /call9_surface_changed/);
});

test("the flat-master producer never borrows a surface to fill a gap", () => {
  const producer = read("app/shared/designpro-flat-master-producer.mjs");
  assert.match(producer, /Never borrow another surface and never ship an\s*\n\s*\/\/ unknown or failed verdict/);
  // Production panels are proof-authoritative unless a caller explicitly opts
  // out, and no production caller does.
  assert.match(producer, /allowGenerativeFallbacks =\s*\n?\s*options\.allowGenerativeFallbacks === true/);
  // Canonical manifest order is by side, independent of completion order, and
  // passenger is a first-class surface rather than a mirror of driver.
  assert.match(producer, /expectedSides\s*\n?\s*\.map\(\(side\) => built\.find\(\(panel\) => panel\?\.side === side\)\)/);
  assert.match(producer, /never synthesizes,\s*\n\s*\/\/ mirrors, or aliases one side from another/);
});
