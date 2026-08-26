import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");

/**
 * THREE REFERENCE CLASSES, THREE AUTHORITIES, NEVER INTERCHANGEABLE.
 * (Owner correction, 2026-08-26.)
 *
 *   STRUCTURAL   the bundled Houdini flattened-top-view pair. It teaches how ONE
 *                cohesive wrap is represented across a flattened master. It is
 *                NOT a creative-style reference unless the customer supplies it
 *                as one.
 *   CREATIVE     the customer's own VisionBoard images. Artwork authority under
 *                exact_reference; style authority under style_inspiration.
 *   PRESENTATION the 3D proof example and Studio OS. They may teach vehicle
 *                presentation, camera, studio and photorealism. They may never
 *                contribute artwork or redesign the customer's wrap.
 *
 * Authority order for a 3D proof: accepted A.T.L.A.S. source design is the
 * ARTWORK authority; YMM + angle contract is the VEHICLE/VIEW authority; the 3D
 * example + Studio OS are PRESENTATION only. Mixing these roles is a design-drift
 * mechanism, so the separation is locked here rather than left to prose.
 */

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey) => ({
  surfaceKey, widthInches: 100, heightInches: 60, surfaceSqFt: 41,
  bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));
const manifest = atlas.buildAtlasManifest(SURFACES);
const VEHICLE = { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" };
const authored = (input) => atlas._test.atlasPrompt({ vehicle: VEHICLE, finish: "Gloss", ...input }, manifest, {});

const swatch = async (color) => sharp({
  create: { width: 64, height: 64, channels: 3, background: color },
}).png().toBuffer();

// THE STRUCTURAL EXAMPLE CARRIES NO STYLE.
//
// The Houdini pair is attached to teach the OUTPUT FORMAT. Every part that
// carries it must refuse its artwork, wording, logo, colour and brand — the
// example is a layout lesson, and a session that lets it become a style source
// has introduced a second, unrequested designer into the call.
test("the structural topology example is attached as layout only, never as style", async () => {
  const parts = await atlas._test.topologyExampleParts([{
    kind: "paired-flat-to-finished",
    flattenedTopView: { bytes: await swatch("#3355aa") },
    finished3dProof: { bytes: await swatch("#aa5533") },
  }]);
  const text = parts.filter((part) => part.text).map((part) => part.text).join("\n");

  assert.match(text, /PAIRED TOPOLOGY EXAMPLE/);
  assert.match(text, /Copy no artwork, wording, logo, color or brand/,
    "the flattened example must refuse its own artwork");
  assert.match(text, /copy no style/i, "the finished proof must refuse its own style");
  // It must never announce itself as artwork or brand authority.
  assert.doesNotMatch(text, /artwork authority|style authority|brand authority/i);
});

// THE CUSTOMER'S REFERENCE IS THE ONLY ONE THAT MAY CARRY ARTWORK AUTHORITY,
// and it says so in the same breath as disclaiming the installer map.
test("a customer reference declares artwork authority and distinguishes itself from the topology example", () => {
  const exact = authored({
    mode: "commercial", brief: "Wrap for Acme", companyName: "Acme",
    visionboardIntent: "exact_reference", visionBoardImages: [{}],
  });
  assert.match(exact, /EXACT REFERENCE: The provided reference is the customer's own approved wrap design/);
  assert.match(exact, /Installer-map examples remain topology-only and must never influence style/);

  const inspiration = authored({
    mode: "commercial", brief: "Wrap for Acme", companyName: "Acme",
    visionboardIntent: "style_inspiration", visionBoardImages: [{}],
  });
  assert.match(inspiration, /REFERENCE FIREWALL/);
  assert.match(inspiration, /TOPOLOGY\/LAYOUT references only/);
});

// WITH NO CUSTOMER REFERENCE, THE FIREWALL STILL STANDS.
//
// This is the case that matters: 0 of 11 real runs supplied a reference image,
// so on every real run so far the only attached example has been the structural
// one — and nothing may take style from it.
test("with no customer reference at all, the structural example is still firewalled", () => {
  const prompt = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme" });
  assert.match(prompt, /REFERENCE FIREWALL/);
  assert.match(prompt, /IGNORE their palette, imagery, text, logos, brand and style/);
});

// THE METADATA KEEPS THE CLASSES APART.
//
// Structural examples and customer references are counted and identified under
// different keys, so a later reader cannot mistake one for the other.
test("the two reference classes are recorded under separate metadata keys", () => {
  const source = require("node:fs").readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(source, /topologyExamplesApplied: topologyExamples\.length/);
  assert.match(source, /topologyExampleIdentities: topologyExamples/);
  assert.match(source, /verifiedCustomerReferenceCount: Array\.isArray\(input\?\.visionBoardImages\)/);
  // The customer-reference count must never be fed from the topology examples.
  assert.doesNotMatch(source, /verifiedCustomerReferenceCount:[^\n]*topologyExamples/);
});

// PRESENTATION MAY NEVER BECOME ARTWORK.
//
// A 3D proof's artwork authority is the accepted A.T.L.A.S. surface crop, bound
// by hash. Anything else — a presentation example, a studio reference, another
// zone's pixels — cannot pass this gate, which is what stops a render example
// from redesigning the wrap.
test("a 3D proof's artwork authority is the atlas master and nothing else can substitute", () => {
  const surfaceHash = "b".repeat(64);
  const bytes = Buffer.from("proof-authority-bytes");
  const good = {
    // The authority is bound to the SURFACE SOURCE — the repaired sheet the
    // panels are cut from, which equals the canonical master byte for byte
    // whenever the sheet arrived without cut-outs.
    metadata: { panelSourceHash: surfaceHash },
    master: { contentHash: surfaceHash },
    viewAuthorities: {
      side: {
        contract: atlas.VIEW_AUTHORITY_CONTRACT, sourceViewType: "side", surfaceKey: "driver",
        contentType: "image/jpeg", bytes, byteSize: bytes.length,
        contentHash: require("node:crypto").createHash("sha256").update(bytes).digest("hex"),
        sourceMasterHash: surfaceHash,
      },
    },
  };
  assert.equal(atlas.viewAuthorityFor(good, "side").surfaceKey, "driver");

  // A presentation example's bytes, however well formed, are bound to no master.
  const impostor = {
    ...good,
    viewAuthorities: { side: { ...good.viewAuthorities.side, sourceMasterHash: "c".repeat(64) } },
  };
  assert.throws(() => atlas.viewAuthorityFor(impostor, "side"),
    (error) => error?.code === "flat_atlas_view_authority_identity_mismatch");

  // And a zone that is not this view's surface cannot stand in for it either.
  const wrongSurface = {
    ...good,
    viewAuthorities: { side: { ...good.viewAuthorities.side, surfaceKey: "roof" } },
  };
  assert.throws(() => atlas.viewAuthorityFor(wrongSurface, "side"),
    (error) => error?.code === "flat_atlas_view_authority_identity_mismatch");
});

// NO INVENTED CUSTOMER CONTACT INFORMATION, PER FIELD.
//
// Each contact field decides its own instruction: supplied means preserve it
// exactly, absent means invent nothing for THAT field. The per-field shape
// matters — a single combined guard only fired when BOTH were missing.
test("contact information is preserved exactly when supplied and never invented when not", () => {
  const none = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme" });
  assert.match(none, /do NOT invent, fabricate, or display any phone number/);
  assert.match(none, /invent no website/);
  assert.match(none, /display none anywhere/);

  const phoneOnly = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme", phone: "555-0142" });
  assert.match(phoneOnly, /555-0142 — display this EXACT number, digit for digit/);
  assert.match(phoneOnly, /invent no website/, "the website guard must still fire when only the phone is supplied");

  const both = authored({
    mode: "commercial", brief: "Wrap for Acme", companyName: "Acme",
    phone: "555-0142", website: "acme.com",
  });
  assert.match(both, /display this EXACT URL, character for character/);
  assert.doesNotMatch(both, /invent, fabricate, or display any phone number|invent no website/);
});
