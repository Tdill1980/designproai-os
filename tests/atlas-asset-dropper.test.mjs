// THE CALL-1 ASSET DROPPER — photos, logos and text must all reach the payload.
//
// Measured on designproai-os-prod, two real runs 31 minutes apart:
//
//   Copper Canyon Mobile Bike Repair  083bbc16  19:38Z  graphics 2  vector-originals
//   Northline Solar & Battery         a08df28c  20:09Z  graphics 3  mixed-originals
//
// Both briefs ask in plain words for an original custom logo. Copper Canyon's
// `composition.placements` carry ten entries and every one is `typography` or
// `contact`: the logo never existed, nothing refused, and `imageRequestCount: 1`
// proves the edge never even asked for one. Northline, after the fix, carries
// the logo in Zone 1 and Zone 3 and spends two image requests.
//
// These cases pin every seam that decides whether an asset survives, so a
// silent drop has to break a test instead of a customer's wrap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { proofLogoRequested } from "../supabase/functions/_shared/atlas-proof-elements.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const topology = runtimeRequire(join(HERE, "..", "runtime", "atlas-panel-proof-topology.cjs"));
const { planProductionPanelLockup } = runtimeRequire(join(HERE, "..", "runtime", "atlas-element-lockup.cjs"));
const { compositeProductionPanels } = runtimeRequire(join(HERE, "..", "runtime", "atlas-master-composite.cjs"));
const sharp = runtimeRequire("sharp");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The two briefs exactly as `request_input.brief` stored them.
const COPPER_CANYON = "Create a premium full commercial wrap for Copper Canyon Mobile Bike Repair on a 2012 Toyota Prius. Use midnight navy, burnished copper and warm cream, with sweeping desert-contour textures and clean high-contrast negative space. Generate a new custom bicycle-chain logo: an original copper chain-link emblem forming a bicycle wheel with a small wrench motif; do not use stock clip art or an existing brand. Include a large photorealistic hero scene of a skilled bicycle mechanic repairing a mountain bike, integrated naturally with the desert-inspired graphics. Brand text exactly: Copper Canyon Mobile Bike Repair. Contact text exactly: 602-555-0147 and bikecare.example. Keep the business name and contact details legible on both sides and the rear, and keep the same logo and artwork consistent across all panels and matched vehicle proofs. Gloss finish. No extra slogans or invented contact details.";
const NORTHLINE = "Create a complete commercial full wrap for Northline Solar & Battery on a 2024 Ford F-150 pickup. Use charcoal, electric lime and white with clean high-contrast technical geometry. Create a bold original custom geometric sun-and-lightning logo. Feature a large photoreal solar-panel installation scene across the rear three quarters of both sides. Keep the company name and supplied contact information prominent and legible: 602-555-0193 and northlinesolar.example. Tagline: Own Your Energy. Services: Solar • Storage • Backup. Coordinate the driver, passenger, hood, roof, front and rear panels as one distinctive design. Present the complete three-zone Production Panel Proof, then matched photoreal vehicle proofs of this exact design.";

// The regex this shipped with until 2026-09-20 19:47Z. It only admitted `logo`
// behind a fixed adjective whitelist, so "bicycle-chain logo" was not a logo
// request at all. Kept here as the fixture that reproduces the live drop.
const RETIRED_DETECTOR = /\b(?:create|design|generate|need|want)\s+(?:(?:me|a|an|new|custom|brand|business|company|professional)\s+)*logo\b/i;

test("a described logo subject is a logo request — the Copper Canyon drop", () => {
  assert.equal(RETIRED_DETECTOR.test(COPPER_CANYON), false,
    "fixture check: the retired detector is what dropped 083bbc16's logo");
  for (const [name, brief] of [["Copper Canyon", COPPER_CANYON], ["Northline", NORTHLINE]]) {
    assert.equal(proofLogoRequested({ customerPrompt: brief }), true,
      `${name} asks for an original logo in plain words`);
  }
  // Still narrow. A wrap that USES a supplied logo is not a request to draw one,
  // and an explicit refusal still wins.
  assert.equal(proofLogoRequested({ customerPrompt: "Design a wrap using my existing logo." }), false);
  assert.equal(proofLogoRequested({ customerPrompt: "Create a custom bicycle-chain logo. Do not draw a logo." }), false);
  assert.equal(proofLogoRequested({ customerPrompt: "Create a bold sun logo", hasCustomerLogo: true }), false,
    "a supplied logo always wins and is never regenerated");
});

const manifest = {
  zones: ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey, index) => ({
    surfaceKey, printWidthIn: index < 2 ? 163 : 66, printHeightIn: index < 2 ? 66 : 60,
  })),
};

test("a customer photo survives staging and reaches the edge body and the receipt", async () => {
  const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#2f6f4f" } })
    .png().toBuffer();
  const staged = [];
  const store = {
    async putImmutableBytes({ storagePath, bytes, contentType }) {
      staged.push(storagePath);
      return { storagePath, contentHash: sha256(bytes), byteSize: bytes.length, contentType };
    },
  };
  let sentBody = null;
  const out = await topology.requestProofSheet({
    manifest, input: { brief: COPPER_CANYON, companyName: "Copper Canyon Mobile Bike Repair" },
    providerRequest: {}, store,
    customerImageParts: [{ inlineData: { data: photo.toString("base64"), mimeType: "image/png" } }],
    callProofEdge: async (body) => { sentBody = body; return { bytes: Buffer.from("sheet") }; },
  });

  assert.equal(sentBody.customerAssets.length, 1, "the customer's photo must reach the model request");
  assert.equal(sentBody.customerAssets[0].contentHash, sha256(photo), "by its own identity, not a re-encode");
  assert.match(staged[0], topology.CALL1_INPUT_PATH, "staged where the edge will admit it");
  assert.equal(out.customerAssets.length, 1, "and it is on the receipt, so a drop is queryable");
});

test("a customer photo that cannot be staged refuses instead of reporting no upload", async () => {
  const photo = Buffer.from("a real upload");
  await assert.rejects(topology.requestProofSheet({
    manifest, input: { brief: COPPER_CANYON }, providerRequest: {}, store: {},
    customerImageParts: [{ inlineData: { data: photo.toString("base64"), mimeType: "image/png" } }],
    callProofEdge: async () => assert.fail("a dropped customer asset may never reach the model"),
  }), /customer asset\(s\) supplied and no artifact store/);

  // The only honest empty answer: nothing was uploaded.
  let body = null;
  await topology.requestProofSheet({
    manifest, input: { brief: COPPER_CANYON }, providerRequest: {}, store: {}, customerImageParts: [],
    callProofEdge: async (sent) => { body = sent; return { bytes: Buffer.from("sheet") }; },
  });
  assert.deepEqual(body.customerAssets, []);
});

async function zoneFixture() {
  const panels = [];
  for (const surfaceKey of ["driver", "passenger", "roof", "hood", "front", "rear"]) {
    const flank = ["driver", "passenger"].includes(surfaceKey);
    const rect = { width: flank ? 1200 : 520, height: flank ? 480 : 440 };
    panels.push({
      surfaceKey, rect, zone: "zone2",
      bytes: await sharp({ create: { ...rect, channels: 3, background: "#123b5e" } }).png().toBuffer(),
    });
  }
  const logoBytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#00000000" } })
    .composite([{
      input: await sharp({ create: { width: 360, height: 360, channels: 4, background: "#c87a3c" } }).png().toBuffer(),
      left: 76, top: 76,
    }]).png().toBuffer();
  const text = (label, height) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}" viewBox="0 0 1600 ${height}">`
    + `<rect x="40" y="${Math.round(height * 0.2)}" width="1520" height="${Math.round(height * 0.6)}" fill="#f5f0e6"/>`
    + `<!-- ${label} --></svg>`);
  const typography = text("Copper Canyon Mobile Bike Repair", 260);
  const contact = text("602-555-0147 bikecare.example", 200);
  const assets = [
    { role: "logo", bytes: logoBytes, byteSize: logoBytes.length, contentHash: sha256(logoBytes),
      width: 512, height: 512, contentType: "image/png", vector: false,
      storagePath: `atlas-elements/${sha256(logoBytes)}.png` },
    { role: "typography", bytes: typography, byteSize: typography.length, contentHash: sha256(typography),
      width: 1600, height: 260, contentType: "image/svg+xml", vector: true,
      storagePath: `atlas-elements/${sha256(typography)}.svg` },
    { role: "contact", bytes: contact, byteSize: contact.length, contentHash: sha256(contact),
      width: 1600, height: 200, contentType: "image/svg+xml", vector: true,
      storagePath: `atlas-elements/${sha256(contact)}.svg` },
  ];
  return { panels, assets };
}

test("logo, typography and contact all survive into Zone 1 and Zone 3", async () => {
  const { panels, assets } = await zoneFixture();
  const layout = planProductionPanelLockup({ panels, elements: assets });
  const composed = await compositeProductionPanels({ backgrounds: panels, assets, placements: layout.placements });

  // Zone 3 is the originals array, one entry per asset, byte identity intact.
  const zone3 = assets.map(({ bytes, role, ...asset }) => ({ ...asset, surfaceKey: role, role: "cut-graphic" }));
  assert.deepEqual(zone3.map((a) => a.surfaceKey), ["logo", "typography", "contact"]);
  assert.deepEqual(zone3.map((a) => a.contentHash), assets.map((a) => a.contentHash));

  // Zone 1: every branded surface carries all three, drawn, with visible pixels.
  for (const surfaceKey of ["driver", "passenger", "hood", "front", "rear"]) {
    const panel = composed.panels.find((p) => p.surfaceKey === surfaceKey);
    assert.deepEqual(panel.applied.map((a) => a.role).sort(), ["contact", "logo", "typography"],
      `${surfaceKey} must carry the logo and both text elements`);
    for (const applied of panel.applied) assert.ok(applied.visiblePixels > 0, `${surfaceKey}/${applied.role} drew nothing`);
    assert.notEqual(panel.contentHash, panel.backgroundContentHash, `${surfaceKey} was not composited at all`);
  }
  assert.deepEqual([...(layout.omitted || []), ...(composed.omitted || [])], [],
    "nothing was skipped, and the receipt says so rather than staying silent");
});

test("an asset a panel cannot carry is NAMED, never silently skipped", async () => {
  const { panels, assets } = await zoneFixture();
  // A front fascia so wide and shallow that the text stack falls under the
  // readable width — the live shape that silently lost a rear contact bar.
  const narrow = panels.map((p) => p.surfaceKey === "front"
    ? { ...p, rect: { width: 2000, height: 100 } } : p);
  const layout = planProductionPanelLockup({ panels: narrow, elements: assets });
  const dropped = layout.omitted.filter((o) => o.surfaceKey === "front");
  assert.deepEqual(dropped.map((o) => o.role).sort(), ["contact", "typography"]);
  for (const entry of dropped) {
    assert.equal(entry.reason, "text_stack_below_readable_width");
    assert.ok(entry.contentHash, "an omission names the exact asset, so it can be chased");
  }
  assert.ok(layout.placements.some((p) => p.surfaceKey === "front" && p.role === "logo"),
    "the logo still reaches the narrow surface");
});
