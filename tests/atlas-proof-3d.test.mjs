/**
 * CALL 2 IS A CALLER. IT BUILDS NO PROMPT AND CREATES NO EDGE FUNCTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18: "2nd call is 3d proofs using our native design edge
 * functions suites. Feed the productionpanelproof."
 *
 * And RULE 0.29, verbatim, which is the rule this file exists to keep: "DO NOT
 * CREATE ANOTHER 3D EDGE FUNCTION ... ATLAS panel = artwork authority.
 * Photographer + angles + studio + lighting = presentation authority only."
 *
 * That was written after a second implementation of the proven stage drifted —
 * its own prompt at 3.5K against the photographer's 1.4K, its own retry ladder,
 * its own aspect ratio, a Driver continuity photograph the proven stack never
 * sent. Every one of the eight refusals on request f3eb40c1 was a judge verdict
 * on a rendered image. So the assertions below are mostly about what this file
 * must NOT do.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const call2 = require_("../runtime/atlas-proof-3d.cjs");

const PANELS = ["driver", "passenger", "hood", "front", "rear", "roof"].map((surfaceKey, i) => ({
  surfaceKey,
  storagePath: `atlas-panel-proof/${surfaceKey}.png`,
  contentHash: String(i).repeat(64).slice(0, 64),
}));

/** A stand-in edge that records exactly what it was sent. */
function recorder(overrides = {}) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, json: async () => ({ success: true, renderUrl: "x", ...overrides }) };
  };
  return { sent, fetchImpl };
}

const BASE = {
  supabaseUrl: "https://example.supabase.co", serviceKey: "svc", ownerId: "owner-1",
  vehicle: { year: "2022", make: "Ford", model: "Transit High Roof" },
};

test("it calls the DEPLOYED photographer, in atlas-proof mode, and nothing else", async () => {
  const { sent, fetchImpl } = recorder();
  await call2.renderProofShot({
    ...BASE, shotKey: "side", surfaceKey: "driver", panel: PANELS[0], fetchImpl,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/functions\/v1\/persona-photographer-render$/,
    "RULE 0.29: do not create another 3D edge function");
  assert.equal(sent[0].body.mode, "atlas-proof");
});

test("NO PROMPT IS ASSEMBLED HERE — the words belong to the pinned stack", () => {
  const source = readFileSync(new URL("../runtime/atlas-proof-3d.cjs", import.meta.url), "utf8");
  // Strip comments first: the header QUOTES the rule, and a lock that trips on
  // its own explanation is one nobody can satisfy without deleting the reason.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const banned of [
    "STUDIO", "CAMERA", "photorealistic", "buildPhotographerPrompt",
    "prompt", "lighting", "angle",
  ]) {
    assert.ok(!new RegExp(banned, "i").test(code),
      `Call 2 mentions "${banned}" — presentation authority belongs to `
      + "persona-photographer-prompt / view-angles-os / studio-os, not here");
  }
});

test("every shot is paired with ITS OWN panel, and the mapping is the edge's", () => {
  const plan = call2.planProofShots(PANELS);
  assert.equal(plan.length, 7, "seven canonical views");
  // Read from the edge's own shared module so a drift between the two homes
  // fails here rather than as a refusal in front of a customer.
  const edge = readFileSync(
    new URL("../supabase/functions/_shared/atlas-proof-presentation.ts", import.meta.url), "utf8");
  const table = edge.slice(edge.indexOf("ATLAS_SHOT_SURFACES"), edge.indexOf("ATLAS_REAL_SURFACES"));
  for (const [shotKey, surfaceKey] of Object.entries(call2.SHOT_SURFACES)) {
    const want = surfaceKey === null ? "null" : `"${surfaceKey}"`;
    assert.ok(table.includes(`"${shotKey}": ${want}`),
      `the edge maps ${shotKey} differently — a mismatch is refused, not rendered`);
  }
  for (const entry of plan) {
    assert.ok(entry.panel, `${entry.shotKey} has no panel`);
    assert.equal(entry.panel.surfaceKey, entry.surfaceKey,
      `${entry.shotKey} was handed the ${entry.panel.surfaceKey} panel`);
  }
});

test("DRIVER FIRST, then the other six together — RULE 0.23", async () => {
  // Not an optimisation: "the customer must not wait for seven proofs to see
  // whether the design is right." A revision supersedes the other six anyway.
  const order = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const render = async (entry) => {
    order.push(entry.shotKey);
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { shotKey: entry.shotKey, surfaceKey: entry.surfaceKey };
  };
  const out = await call2.renderProofSet({ ...BASE, panels: PANELS, render });
  assert.equal(order[0], "side", "the driver view is rendered first and alone");
  assert.equal(maxConcurrent, 6, "the remaining six render concurrently, not serially");
  assert.equal(out.accepted, 7);
});

test("a failed shot does not take the other six down", async () => {
  const render = async (entry) => {
    if (entry.shotKey === "roof") throw new Error("provider_attempts_exhausted");
    return { shotKey: entry.shotKey, surfaceKey: entry.surfaceKey };
  };
  const out = await call2.renderProofSet({ ...BASE, panels: PANELS, render });
  assert.equal(out.accepted, 6);
  assert.equal(out.refused.length, 1);
  assert.equal(out.refused[0].shotKey, "roof");
  assert.match(out.refused[0].error, /provider_attempts_exhausted/);
});

test("the panel travels as an IDENTITY — never bytes, never a public URL", async () => {
  const { sent, fetchImpl } = recorder();
  await call2.renderProofShot({
    ...BASE, shotKey: "rear", surfaceKey: "rear", panel: PANELS[4], fetchImpl,
  });
  const body = sent[0].body;
  assert.equal(body.sourcePanelStoragePath, PANELS[4].storagePath);
  assert.equal(body.sourcePanelHash, PANELS[4].contentHash);
  // wrap-files is private: a public URL 400s, and it is RULE 0.29's fourth
  // banned behaviour by name.
  const asText = JSON.stringify(body);
  assert.ok(!/https?:\/\//.test(asText.replace(BASE.supabaseUrl, "")),
    "no URL may stand in for the panel");
  assert.ok(!/base64|inlineData|data:image/.test(asText),
    "a node boundary carries an identity, never a blob (RULE 0.39)");
});

test("a hero render is never sent, and a missing panel is refused not substituted", async () => {
  const { sent, fetchImpl } = recorder();
  await call2.renderProofShot({
    ...BASE, shotKey: "side", surfaceKey: "driver", panel: PANELS[0], fetchImpl,
  });
  // The edge refuses `heroRenderUrl` outright (atlas_proof_hero_forbidden);
  // sending one is the hero dependency RULE 0.29 removed by name.
  assert.ok(!("heroRenderUrl" in sent[0].body));

  // AND A MISSING PANEL THROWS RATHER THAN BORROWING A NEIGHBOUR'S. "Do not use
  // Driver as artwork continuity authority" — a substituted panel renders a
  // plausible proof of the wrong flank.
  await assert.rejects(
    () => call2.renderProofShot({ ...BASE, shotKey: "roof", surfaceKey: "roof", panel: null, fetchImpl }),
    /atlas_proof_3d_panel_missing:roof/);

  await assert.rejects(
    () => call2.renderProofShot({
      ...BASE, shotKey: "passenger-side", surfaceKey: "driver", panel: PANELS[0], fetchImpl }),
    /atlas_proof_3d_surface_mismatch/);
});

test("close-up NAMES its surface — it is never defaulted invisibly", () => {
  // The edge maps close-up to null and refuses an unnamed one rather than
  // defaulting to Driver. A silent default is a close-up of the wrong side of
  // the vehicle, and it looks entirely plausible.
  assert.equal(call2.SHOT_SURFACES["close-up"], null);
  const onRear = call2.planProofShots(PANELS, { closeUpSurface: "rear" })
    .find((p) => p.shotKey === "close-up");
  assert.equal(onRear.surfaceKey, "rear");
  assert.equal(onRear.panel.surfaceKey, "rear");
});

test("every shot that renders gets its panel — none is skipped", async () => {
  // `skipHeroShots = ['passenger-side', 'close-up']` dropped the reference for
  // those two under a hero, and RULE 0.29 kills that reasoning with the swap:
  // the passenger panel is not a driver photograph, and dropping it leaves the
  // model to invent that flank.
  const { sent, fetchImpl } = recorder();
  for (const entry of call2.planProofShots(PANELS)) {
    await call2.renderProofShot({ ...BASE, ...entry, fetchImpl });
  }
  assert.equal(sent.length, 7);
  for (const call of sent) {
    assert.ok(call.body.sourcePanelStoragePath, `${call.body.shotKey} was sent without its panel`);
  }
});
