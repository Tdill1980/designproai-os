// THE 3D PROOF STACK IS THE REAL RESTYLEPRO STACK, PINNED. (Trish 2026-08-27)
//
//   restylepro-os@113d137dbe8813ca3bf70c8d7265ad081ebd4524
//     supabase/functions/persona-photographer-render/index.ts   -- producer
//     supabase/functions/_shared/persona-photographer-prompt.ts -- prompt
//     supabase/functions/_shared/view-angles-os.ts              -- camera, framing, frame-fill
//     supabase/functions/_shared/studio-os.ts                   -- studio AND lighting
//
// "Do not invent new studio or lighting prompts in the server runtime." So the
// vendored copies are pinned by content hash: a silent edit here is a new
// studio, and a new studio is exactly what makes two views stop matching.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const sha = (rel) => createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex").slice(0, 16);

test("the three AUTHORITY sources are byte-identical to the pin", () => {
  // Verified against the pinned commit 2026-08-27. These three are the ones
  // RULE 0.29 calls authorities -- the words, the room, the light. Nothing in
  // this repository may edit them.
  //
  // ONE TOKEN RE-PINNED, 2026-09-01, BY OWNER RULING: "ATLAS IS CORRECT AT 4K
  // 16:9". The prompt's closing line read "4:3 landscape, 4K" and the render
  // config asked Gemini for 4:3, so every proof came back 4:3 -- about 12.6MP
  // against the 16.9MP of a 16:9 4K frame, and then pillarboxed again by
  // viewports that are 16:9. That is the whole of "the old system looked
  // better".
  //
  // It was never a proven value. RULE 0.29 adopted this stack as "the REAL
  // RestylePro photographer", but `grep -rn persona-photographer-render src/`
  // in restylepro-os returns NOTHING: its own CLAUDE.md says "the persona
  // pipeline is BYPASSED -- not called by any frontend code. All renders go
  // through design-panel-ai-generate", whose golden config is
  // `{ aspectRatio: "16:9", imageSize: "4K" }`. So the pinned bytes came from
  // a function that never rendered anything, and 4:3 rode in with them.
  //
  // This repo's own runtime always disagreed: runtime/view-angles.cjs pins all
  // nine views to "16:9" at "4K" and generation-worker passes that through --
  // the edge function ignored the caller and hardcoded its own.
  //
  // The camera, the room, the light and every other word are untouched: "Canon
  // EOS R5, tack-sharp. INDISTINGUISHABLE from a real photograph." The pin
  // still forbids editing these files; it now pins the aspect the system
  // actually asks for.
  assert.equal(sha("supabase/functions/_shared/persona-photographer-prompt.ts"), "b7d3da05e6d0aac0");
  assert.equal(sha("supabase/functions/_shared/studio-os.ts"), "7b02814bb1e9e867");
});

/**
 * THE PRODUCER IS ADAPTED, BY THE RULE'S OWN INSTRUCTION — AND ONLY AT THE
 * ARTWORK SEAM.
 *
 * RULE 0.29: "Adapt, do not restore blindly. The pinned photographer describes
 * a historical six-shot sequence and an old `heroRenderUrl` continuity
 * dependency. Keep its photographer/studio/view-angle logic; replace the
 * artwork authority with the matching extracted A.T.L.A.S. panel."
 *
 * Owner, 2026-08-28: "DO NOT CREATE ANOTHER 3D EDGE FUNCTION." So the
 * adaptation lands INSIDE this file as `mode: "atlas-proof"`, and the pin moves
 * with it. What the pin cannot do any more is prove the file is unchanged, so
 * these assertions prove the thing that actually matters: the adaptation
 * changed the artwork input and NOTHING about the presentation.
 */
test("the photographer's adaptation touches the artwork input and nothing else", () => {
  const source = readFileSync(join(ROOT, "supabase/functions/persona-photographer-render/index.ts"), "utf8");
  const atlas = source.slice(source.indexOf("async function handleAtlasProof"));
  assert.ok(atlas.length > 500, "the atlas-proof mode is gone");

  // PRESENTATION AUTHORITY, UNCHANGED. The prompt, the camera and the model
  // come from the pinned modules; this mode may not restate any of them.
  assert.match(atlas, /buildPhotographerPrompt\(\{/, "the pinned prompt builder must produce the words");
  assert.match(atlas, /PRIMARY_IMAGE_MODEL/);
  assert.match(atlas, /FALLBACK_IMAGE_MODEL/);
  for (const invented of ["LED strip", "daylight balanced", "seamless white cyclorama", "Camera:", "Framing:"]) {
    assert.ok(!atlas.includes(invented),
      `atlas-proof restates presentation text that belongs to the pinned modules: ${invented}`);
  }

  // ARTWORK AUTHORITY, SWAPPED. The panel is read by storage path and hash —
  // never a hero render, and never a public URL of a private bucket.
  assert.match(atlas, /sourcePanelStoragePath/);
  assert.match(atlas, /atlas_proof_panel_hash_mismatch/);
  assert.match(atlas, /atlas_proof_hero_forbidden/,
    "a hero render must be refused outright in atlas-proof mode");

  // AND THE TWO HERO-PATH BEHAVIOURS THAT MUST NOT SURVIVE THE SWAP.
  assert.ok(!atlas.includes("skipHeroShots"),
    "passenger-side and close-up must not have their artwork authority dropped");
  assert.ok(!/parts: attempt === 1 \? parts : \[\{ text: prompt \}\]/.test(atlas),
    "a retry must not re-send text only — that drops the artwork the proof is of");

  // EVERY SHOT GETS ITS OWN SURFACE, INCLUDING THE ROOF THE SIX-SHOT SEQUENCE
  // NEVER HAD.
  const map = source.slice(source.indexOf("ATLAS_SHOT_SURFACES"), source.indexOf("serve(async"));
  for (const [shot, surface] of [
    ["side", "driver"], ["passenger-side", "passenger"], ["hood_detail", "hood"],
    ["front", "front"], ["rear", "rear"], ["roof", "roof"],
  ]) {
    assert.ok(new RegExp(`"${shot}":\\s*"${surface}"`).test(map),
      `${shot} must be authored by the ${surface} panel`);
  }
  assert.match(atlas, /atlas_proof_surface_mismatch/,
    "a shot handed the wrong surface's panel must be refused, not rendered");
});

test("view-angles is the pin exactly, and HERO is gone", () => {
  // It had drifted by one ADDED shot, `hero-3d`. Owner 2026-08-27: "REMOVE
  // HERO." Restored to the pinned bytes, so all four proof-stack files are now
  // byte-identical to 113d137 and the plan is the canonical seven views.
  assert.equal(sha("supabase/functions/_shared/view-angles-os.ts"), "8890be50c124a2c5");
  const source = readFileSync(join(ROOT, "supabase/functions/_shared/view-angles-os.ts"), "utf8");
  for (const view of ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]) {
    assert.ok(source.includes(view), `the canonical seven must include ${view}`);
  }
  assert.ok(!source.includes("hero-3d"), "hero is removed from the proof stack");
  // studio and lighting are NOT restated here — they live in studio-os.
  assert.ok(!/LED strip/i.test(source), "lighting belongs to studio-os, never to the angle file");
});

test("the runtime does not author its own studio or lighting text", () => {
  // studio-os.cjs is the port; nothing else may describe the room.
  const provider = readFileSync(join(ROOT, "runtime/designpanel-server-provider.cjs"), "utf8");
  assert.match(provider, /STUDIO_ENVIRONMENT/, "the standard reproduction prompt consumes the studio kernel");
  for (const invented of ["LED strip", "daylight balanced", "seamless white cyclorama"]) {
    assert.ok(!provider.includes(invented), `the runtime must not restate studio text: ${invented}`);
  }
});

/**
 * ...AND FOR A.T.L.A.S. IT AUTHORS NO PROOF PROMPT AT ALL.
 *
 * The runtime provider used to build `buildAtlasProjectionPrompt` and call
 * Gemini through the key pool — a second implementation of a stage that already
 * had a proven one. Owner, 2026-08-28: use `persona-photographer-render`. So
 * the A.T.L.A.S. provider is now a transport: resolve the surface's persisted
 * panel, POST, download, verify the hash.
 */
test("the A.T.L.A.S. proof provider is a transport, not a second producer", () => {
  const provider = readFileSync(join(ROOT, "runtime/designpanel-server-provider.cjs"), "utf8");
  // TWO SLICES, ON PURPOSE. The producer constants and the Driver-only
  // restoration set are declared just ABOVE the factory, so the name
  // assertions read the wider region; the "builds no prompt" assertions read
  // the factory body only, because the factory's own header comment NAMES the
  // retired producer in order to record that it was deleted.
  const atlasRegion = provider.slice(
    provider.indexOf('const ATLAS_PROOF_STAGE = "persona-photographer-render"'),
    provider.indexOf("module.exports = {"),
  );
  const atlasProvider = provider.slice(
    provider.indexOf("function createAtlasDesignPanelProvider"),
    provider.indexOf("module.exports = {"),
  );
  assert.ok(atlasProvider.length > 500, "the atlas provider is gone");
  // TWO SANCTIONED PRESENTATION PRODUCERS, ONE ARTWORK AUTHORITY.
  //
  // The Restoration Contract (owner, 2026-09-01) routes DRIVER ONLY to the
  // recovered legacy presentation branch of `design-panel-ai-generate`; the
  // other six shots stay on the pinned photographer. Both take the same
  // hash-bound canonical Call-1 panel as their sole artwork authority, so this
  // is a second producer of PHOTOGRAPHY, never of design -- which is what the
  // rest of this test proves.
  assert.match(atlasRegion, /const ATLAS_PROOF_STAGE = "persona-photographer-render"/,
    "the pinned photographer must still be a producer") ;
  assert.match(atlasRegion, /const ATLAS_PRESENTATION_FUNCTION = "design-panel-ai-generate"/,
    "the restored legacy presentation path must be named");
  assert.match(atlasProvider, /mode: "atlas-proof"/);
  // The restoration is DRIVER ONLY until Driver passes canonical fidelity.
  // Widening this set is an owner decision, not a session's.
  assert.match(atlasRegion, /ATLAS_PRESENTATION_RESTORED_SHOTS = new Set\(\["side"\]\)/,
    "the restored presentation route must stay Driver-only");
  // It resolves THIS surface's panel and sends its path + hash as the artwork.
  assert.match(atlasProvider, /atlas\.panelFor\(sourceViewType\)/);
  assert.match(atlasProvider, /sourcePanelStoragePath: panel\.storagePath/);
  assert.match(atlasProvider, /sourcePanelHash: panel\.contentHash/);
  // No prompt assembly, no direct image call, and no Driver anchor.
  assert.ok(!atlasProvider.includes("buildAtlasProjectionPrompt"),
    "the atlas provider builds its own proof prompt again");
  assert.ok(!atlasProvider.includes("provider.generateImage"),
    "the atlas provider calls Gemini directly again");
  for (const retired of ["driverContinuityReference", "compactAtlasDriverReference", "atlasDriverContinuityOnly"]) {
    assert.ok(!atlasProvider.includes(retired),
      `the Driver continuity anchor is back as ${retired} — the owner ruled it out by name`);
  }
});

/**
 * THE SECOND PROOF IMPLEMENTATION IS DELETED, NOT MERELY UNWIRED.
 *
 * Owner, 2026-08-28: "Delete buildAtlasProjectionPrompt and its obsolete tests
 * instead of leaving a second proof implementation available to reconnect. If
 * deletion is unsafe, add an enforcement test proving there are zero production
 * references or calls."
 *
 * Deletion was safe, so this proves the stronger thing: the symbols do not
 * exist anywhere in the repository -- not as a definition, not as an export,
 * not as an import, not in a test. An unwired producer is one import away from
 * being the producer again.
 */
test("no A.T.L.A.S. proof producer survives anywhere in the repository", async () => {
  const { execFileSync } = await import("node:child_process");
  const DELETED = [
    "buildAtlasProjectionPrompt",
    "buildAtlasProjectionRequest",
    "resolveAtlasConditioningParts",
    "atlasViewIdentity",
    "compactAtlasDriverReference",
    "assertAtlasRequestWithinLimit",
    // The Driver continuity anchor the owner ruled out by name.
    "driverContinuityReference",
  ];
  for (const symbol of DELETED) {
    let hits = "";
    try {
      // `grep -w` so a mention inside a longer identifier cannot mask a real
      // reference, and the tombstone comments are excluded by requiring the
      // symbol to appear OUTSIDE a comment line.
      hits = execFileSync("git", [
        "grep", "-n", "-w", symbol, "--",
        ":!node_modules", ":!*.md", ":!docs/",
        // This file NAMES the forbidden symbols in order to forbid them.
        ":!tests/proof-stack-pinned-sources.test.mjs",
      ], { cwd: ROOT, encoding: "utf8" });
    } catch {
      hits = ""; // git grep exits 1 when there are no matches
    }
    const code = hits.split("\n").filter(Boolean).filter((line) => {
      const text = line.slice(line.indexOf(":", line.indexOf(":") + 1) + 1).trim();
      return !text.startsWith("*") && !text.startsWith("//") && !text.startsWith("/*");
    });
    assert.deepEqual(code, [],
      `${symbol} is referenced in code again — the second proof producer is being reconnected`);
  }
});

/**
 * `atlasDriverContinuityOnly` is a metadata KEY, not a function, so it is not on
 * the zero-reference list above: the fence and several negative fixtures have to
 * keep NAMING it in order to refuse it. What must be true is that nothing
 * WRITES it any more.
 */
test("no runtime code writes the Driver continuity metadata key", async () => {
  const { execFileSync } = await import("node:child_process");
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-n", "atlasDriverContinuityOnly:", "--", "runtime/", "gateway/", "app/"],
      { cwd: ROOT, encoding: "utf8" });
  } catch { hits = ""; }
  assert.equal(hits.trim(), "",
    "something writes atlasDriverContinuityOnly again — the Driver anchor is back");
});

test("the A.T.L.A.S. transport makes no image request of its own", () => {
  const provider = readFileSync(join(ROOT, "runtime/designpanel-server-provider.cjs"), "utf8");
  const transport = provider.slice(
    provider.indexOf('const ATLAS_PROOF_STAGE = "persona-photographer-render"'),
    provider.indexOf("module.exports = {"),
  );
  // It calls the photographer and nothing else. No key pool, no Gemini, no
  // prompt assembly, and no second edge function.
  assert.ok(!transport.includes("generativelanguage"), "the transport reaches Gemini directly");
  assert.ok(!transport.includes("provider.generateImage"), "the transport generates its own image");
  assert.ok(!/\btext:\s*`/.test(transport), "the transport assembles prompt text");
  // The ONE edge call it makes is `/functions/v1/${proofFunction}`, and
  // `proofFunction` can only ever be one of the two sanctioned producers. A
  // third name — or a hardcoded path to anything else — fails here.
  assert.match(transport, /functions\/v1\/\$\{proofFunction\}/,
    "the transport must route through the sanctioned producer variable");
  assert.deepEqual([...new Set(transport.match(/\/functions\/v1\/[a-z-]+/g) || [])], [],
    "the transport hardcodes an edge function path");
  const producers = [...transport.matchAll(/^const ATLAS_(?:PROOF_STAGE|PRESENTATION_FUNCTION) = "([a-z-]+)";$/gm)]
    .map((m) => m[1]).sort();
  assert.deepEqual(producers, ["design-panel-ai-generate", "persona-photographer-render"]);
});
