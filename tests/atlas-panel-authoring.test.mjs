import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { captureImageTurn, replayImageTurn } from "../supabase/functions/_shared/gemini-image-history.mjs";

const require = createRequire(import.meta.url);
// sharp is installed under runtime/, not at the repo root.
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const authoring = require("../runtime/atlas-panel-authoring.cjs");
const { assertPanelAncestry } = require("../runtime/production-provenance.cjs");

const runtimeSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edgeSrc = fs.readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

/** A solid sheet of artwork at a given size. No holes. */
async function solid(width, height, colour = { r: 40, g: 120, b: 200 }) {
  return sharp({ create: { width, height, channels: 4, background: { ...colour, alpha: 255 } } })
    .png().toBuffer();
}

/** The same sheet with a black disc punched out of it — a wheel-well cutout. */
async function holed(width, height, radius) {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const disc = Buffer.from(
    `<svg width="${width}" height="${height}"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="#000000"/></svg>`,
  );
  return sharp(await solid(width, height))
    .composite([{ input: disc }])
    .png().toBuffer();
}

function panelFixture(bytes, { width, height, surfaceKey = "driver" }) {
  return {
    surfaceKey,
    bytes,
    contentHash: "a".repeat(64),
    pixelWidth: width,
    pixelHeight: height,
  };
}

test("the finishing pass is OFF unless the flag says on, and a bad value fails safe", () => {
  // The flag lives in the runtime, so this reads the real gate rather than a
  // copy of it. A misspelling must resolve OFF -- the same direction
  // DESIGNPRO_STANDARD_TRANSPORT fails, for the same reason.
  assert.match(
    runtimeSrc,
    /String\(process\.env\.DESIGNPRO_ATLAS_PANEL_FINISH \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "on"/,
  );
  const gate = runtimeSrc.slice(runtimeSrc.indexOf("function atlasPanelFinisher("));
  assert.match(gate.slice(0, 600), /return null;/,
    "an unset or misspelled flag must return no finisher at all");
});

test("cutCallOnePanels without a finisher is byte-for-byte the deterministic crop", () => {
  // The finishing hook is optional and the resume path passes nothing, so the
  // default branch must still stamp the deterministic provenance. If this ever
  // flips, every historical panel's ancestry claim changes meaning.
  assert.match(runtimeSrc, /method: "deterministic_atlas_crop",\s*\n\s*deterministic: true,/);
  assert.match(runtimeSrc, /if \(typeof finishPanel === "function"\) \{/);
  const hook = runtimeSrc.slice(
    runtimeSrc.indexOf('if (typeof finishPanel === "function") {'),
    runtimeSrc.indexOf("panels.push(panel);"),
  );
  assert.match(hook, /finish\?\.applied === true && finish\.bytes\?\.length/,
    "only an APPLIED finish may replace the crop");
});

test("the finished panel is substituted BEFORE it is released, never after", () => {
  // Everything downstream binds to contentHash -- the persisted bytes, the
  // PanelPro row, the proof's artwork authority. Finishing after onPanel would
  // publish one panel and print another.
  const loop = runtimeSrc.slice(
    runtimeSrc.indexOf("for (const surfaceKey of PANEL_EXTRACTION_ORDER)"),
    runtimeSrc.indexOf("async function cutOnePanel(surfaceKey)"),
  );
  const finished = loop.indexOf('if (typeof finishPanel === "function")');
  const released = loop.indexOf("await onPanel(panel,");
  assert.ok(finished > 0 && released > finished,
    "the finishing pass must run before the panel is released to the graph");
});

test("PASSENGER IS AUTHORED FROM DRIVER, NEVER MIRRORED FROM IT", () => {
  // The owner's sketch said "then flipped passenger". A horizontal flip
  // mirrors every letterform, so a phone number would print backwards down the
  // flank -- and RULE 0 already forbids mirrored Driver pixels standing in for
  // Passenger. The cascade delivers the same intent by SHOWING Driver to
  // Passenger's own authoring pass.
  assert.deepEqual(authoring.PANEL_NEIGHBOURS.passenger, ["driver"]);
  assert.deepEqual(authoring.PANEL_NEIGHBOURS.driver, []);
  const module = fs.readFileSync(new URL("../runtime/atlas-panel-authoring.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(module, /\.flop\(\)|\bmirrorPassenger|flip: true/,
    "the finishing module must never mirror one surface into another");
});

test("EVERY surface is shown every sheet already finished before it", () => {
  // Owner ruling 2026-09-08: "make sure each side is getting Atlas example as
  // well as the other sides". The cascade is therefore cumulative -- each
  // surface sees ALL of its predecessors, not a hand-picked subset.
  assert.deepEqual(authoring.PANEL_CASCADE_ORDER,
    ["driver", "passenger", "hood", "roof", "front", "rear"]);
  authoring.PANEL_CASCADE_ORDER.forEach((surfaceKey, index) => {
    assert.deepEqual(
      authoring.PANEL_NEIGHBOURS[surfaceKey],
      authoring.PANEL_CASCADE_ORDER.slice(0, index),
      `${surfaceKey} must be shown every sheet finished before it`,
    );
  });
  // Rear is last and therefore the widest request: five siblings, plus the
  // A.T.L.A.S. and the subject sheet, is seven assets against a ceiling of 14.
  assert.equal(authoring.PANEL_NEIGHBOURS.rear.length, 5);
  assert.match(edgeSrc, /ATLAS_PANEL_MAX_NEIGHBOURS = 5/);
  assert.match(edgeSrc, /ATLAS_PANEL_MAX_REFERENCE_ASSETS = 14/);
  assert.match(edgeSrc, /atlas_panel_reference_budget_exceeded/);
});

test("every surface is shown the whole A.T.L.A.S. as visual DNA", async () => {
  // The master is what keeps six independently-finished sheets from drifting
  // away from the design Call 1 actually authored.
  assert.match(runtimeSrc, /atlasReferenceBytes: surfaceSourceBytes,/);
  const staged = [];
  const bytes = await solid(600, 300);
  await authoring.finishPanel(panelFixture(bytes, { width: 600, height: 300 }), {
    atlasReferenceBytes: await solid(4096, 4096),
    neighbours: [],
    store: { putImmutableBytes: async ({ storagePath }) => { staged.push(storagePath); } },
    callEdge: async (request) => {
      assert.ok(request.atlasReferenceStoragePath, "the A.T.L.A.S. must reach the request");
      assert.match(request.atlasReferenceStoragePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
      throw new Error("stop here");
    },
  });
  assert.equal(staged.filter((p) => p.endsWith(".png")).length, 1, "the subject sheet stays lossless PNG");
  assert.ok(staged.some((p) => p.endsWith(".jpg")), "the A.T.L.A.S. reference is downscaled");
});

test("references travel downscaled; the subject sheet does not", async () => {
  // Six lossless 4K references would exhaust the ~20MB model-request budget
  // long before the 14-asset ceiling mattered -- the bytes bind, not the count.
  const bytes = await solid(600, 300);
  const uploads = new Map();
  await authoring.finishPanel(panelFixture(bytes, { width: 600, height: 300 }), {
    atlasReferenceBytes: await solid(4096, 4096),
    neighbours: [{ surfaceKey: "driver", bytes: await solid(4096, 980) }],
    store: {
      putImmutableBytes: async ({ storagePath, bytes: staged }) => { uploads.set(storagePath, staged); },
    },
    callEdge: async () => { throw new Error("stop here"); },
  });
  for (const [path, staged] of uploads) {
    if (!path.endsWith(".jpg")) continue;
    const meta = await sharp(staged).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 1280, `${path} must be downscaled`);
    assert.ok(staged.length < 900_000, `${path} must be small enough to attach six of`);
  }
  // The subject sheet is untouched: it is the only image whose pixels are redrawn.
  const subject = [...uploads].find(([path]) => path.endsWith(".png"))[1];
  assert.deepEqual(subject, bytes);
});

test("a candidate returned at the wrong proportion is refused, and the crop wins", async () => {
  // The edge deliberately asks for NO aspect ratio so the edit follows its
  // input. This is where that assumption is checked instead of trusted: a
  // 4.2:1 flank answered at 1:1 is a different shape, not a rounding error.
  const panel = panelFixture(await solid(2100, 500), { width: 2100, height: 500 });
  const square = await solid(1024, 1024);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: square }, 0.05);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /^aspect_drift:/);
});

test("a candidate that OPENS holes is refused — a finishing pass may not regress", async () => {
  const clean = await solid(800, 400);
  const panel = panelFixture(clean, { width: 800, height: 400 });
  const before = await authoring._test.holeRatio(clean);
  const worse = await holed(800, 400, 90);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: worse }, before);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /^holes_increased:/);
});

test("a candidate that CLOSES holes is accepted, resized to the exact zone rectangle", async () => {
  // Every downstream dimension, PPI and square-footage field is computed from
  // the zone, so the finished sheet has to occupy exactly the crop's pixels.
  const punched = await holed(800, 400, 90);
  const before = await authoring._test.holeRatio(punched);
  assert.ok(before > 0.05, "the fixture must actually contain a hole");
  const panel = panelFixture(punched, { width: 800, height: 400 });
  // Same proportion, different pixel count -- the model returns its own size.
  const repaired = await solid(1600, 800);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: repaired }, before);
  assert.equal(verdict.accepted, true, verdict.reason);
  const meta = await sharp(verdict.bytes).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 400);
  assert.ok(verdict.afterHoles < before);
});

test("every failure path returns the crop unchanged — this can never lose a run", async () => {
  const bytes = await solid(600, 300);
  const panel = panelFixture(bytes, { width: 600, height: 300 });
  // No transport at all.
  const noTransport = await authoring.finishPanel(panel, {});
  assert.equal(noTransport.applied, false);
  assert.equal(noTransport.bytes, bytes);
  assert.equal(noTransport.contentHash, panel.contentHash);

  // Transport present, edge throws on every attempt.
  let calls = 0;
  const refused = await authoring.finishPanel(panel, {
    store: { putImmutableBytes: async () => {} },
    callEdge: async () => { calls += 1; throw new Error("boom"); },
  });
  assert.equal(refused.applied, false);
  assert.equal(refused.bytes, bytes, "the deterministic crop must survive an edge failure");
  assert.equal(calls, authoring.PANEL_FINISH_ATTEMPTS, "the budget is spent, then it gives up quietly");
  assert.match(refused.reason, /^edge_failed:/);
});

/** A model turn as the edge hands it back: image by reference, signature on it. */
function modelTurnFixture(signature = "sig-abc") {
  return {
    role: "model",
    parts: [{
      imageRef: { storagePath: "atlas-panel/x.png", contentHash: "e".repeat(64) },
      thoughtSignature: signature,
    }],
  };
}

test("the cascade is ONE conversation — thought signatures carry forward", async () => {
  // Gemini 3's documented practice for chained image editing. Six surfaces
  // finished in sequence is that workflow: the model that drew the flanks
  // should still be holding why when it reaches the hood.
  const bytes = await solid(600, 300);
  const seen = [];
  const originalUserTurn = { role: "user", parts: [{ text: "Original instructions, not a summary" }, { imageRef: { storagePath: "subject.png", contentHash: "f".repeat(64) } }] };
  const earlier = {
    surfaceKey: "driver",
    imageBytes: 1000,
    turns: [{ role: "user", parts: [{ text: "earlier" }] }, modelTurnFixture("sig-driver")],
  };
  const finish = await authoring.finishPanel(panelFixture(bytes, { width: 600, height: 300, surfaceKey: "hood" }), {
    priorExchanges: [earlier],
    store: { putImmutableBytes: async () => {} },
    callEdge: async (request) => {
      seen.push(request.priorTurns);
      return {
        bytes: await solid(600, 300),
        userTurn: originalUserTurn,
        modelTurn: modelTurnFixture("sig-hood"),
        thoughtSignatureCount: 1,
        panelByteSize: 2000,
        historyImageBytes: 3500,
      };
    },
  });
  assert.equal(finish.applied, true, finish.reason);
  // The prior exchange is flattened into turns and sent verbatim.
  assert.deepEqual(seen[0], earlier.turns);
  // The chain handed onward is exchanges, newest last.
  assert.equal(finish.nextExchanges.length, 2);
  assert.equal(finish.nextExchanges[0].surfaceKey, "driver");
  assert.equal(finish.nextExchanges[1].surfaceKey, "hood");
  assert.equal(finish.nextExchanges[1].imageBytes, 3500, "budget includes user inputs and every returned image");
  assert.deepEqual(finish.nextExchanges[1].turns[0], originalUserTurn);
  assert.deepEqual(finish.nextExchanges[1].turns[1], modelTurnFixture("sig-hood"));
  assert.equal(finish.thoughtSignatureCount, 1);
  assert.match(runtimeSrc, /priorExchanges: reasoningChain,/);
  assert.match(runtimeSrc, /reasoningChain = finish\.nextExchanges;/);
});

test("signed multipart replies round-trip exactly, including distinct thought images and long text", async () => {
  const original = { role: "model", parts: [
    { text: "x".repeat(6000), thought: true, thoughtSignature: "sig-text" },
    { inlineData: { mimeType: "image/jpeg", data: "first-image" }, thought: true, thoughtSignature: "sig-first" },
    { text: " " },
    { inlineData: { mimeType: "image/png", data: "final-image" }, thoughtSignature: "sig-final" },
  ] };
  const before = structuredClone(original);
  const images = new Map();
  const stored = await captureImageTurn(original, async (inlineData, index) => {
    images.set(`image-${index}`, inlineData.data);
    return { storagePath: `image-${index}`, contentHash: String(index).repeat(64) };
  });
  assert.notEqual(stored.parts[1].imageRef.storagePath, stored.parts[3].imageRef.storagePath);
  const replayed = await replayImageTurn(stored, async (path) => images.get(path));
  assert.deepEqual(replayed, original, "text, image MIME, part order, flags and signature attachment must survive");
  assert.deepEqual(original, before, "capture must not mutate the provider response");
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasPanel("));
  assert.match(handler, /replayImageTurn\(turn, downloadHistoryImage\)/);
  assert.match(handler, /captureImageTurn\(payload\.candidates\[0\]\.content/);
});

test("replayed history images are hash-verified and restricted to declared input/output paths", async () => {
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasPanel("));
  const loader = handler.slice(handler.indexOf("const downloadHistoryImage ="));
  // atlas-panel/ is where this function writes every sheet it makes, so the
  // prefix is what stops history replaying an arbitrary bucket object.
  assert.match(loader, /\^atlas-panel\\\/\[0-9a-f-\]\{36\}\\\.png\$/);
  assert.match(loader, /atlas_panel_history_hash_mismatch/);
  assert.match(loader, /atlas_panel_history_hash_invalid/);
  await assert.rejects(replayImageTurn({ role: "model", parts: [{ inlineData: { data: "unverified" } }] }, async () => ""), /atlas_panel_prior_turn_carries_inline_image/);
  await assert.rejects(replayImageTurn({ role: "system", parts: [{ text: "invalid" }] }, async () => ""), /atlas_panel_prior_turn_role_invalid/);
  await assert.rejects(replayImageTurn(modelTurnFixture(), async () => { throw new Error("atlas_panel_history_hash_mismatch"); }), /atlas_panel_history_hash_mismatch/);
  assert.match(handler, /atlas_panel_prior_turn_budget_exceeded/);
  assert.match(handler, /contents: \[\.\.\.priorTurns, \{ role: "user", parts \}\]/);
});

test("the conversation is trimmed from the oldest end, in whole exchanges", () => {
  // A replayed model turn re-sends a full sheet, so six of them would exceed
  // the model-request budget. Trimming keeps the newest, which are the
  // strongest constraint on the sheet about to be drawn.
  const exchange = (surfaceKey, imageBytes) => ({
    surfaceKey,
    imageBytes,
    turns: [{ role: "user", parts: [{ text: surfaceKey }] }, modelTurnFixture(surfaceKey)],
  });
  const big = 3 * 1024 * 1024;
  const kept = authoring._test.trimHistory([
    exchange("driver", big), exchange("passenger", big), exchange("hood", big),
  ]);
  assert.deepEqual(kept.map((e) => e.surfaceKey), ["passenger", "hood"],
    "the oldest exchange is dropped when the budget cannot hold all three");
  // Never more than the exchange cap, however small the images.
  const many = ["a", "b", "c", "d", "e"].map((k) => exchange(k, 1));
  assert.equal(authoring._test.trimHistory(many).length, authoring.MAX_HISTORY_EXCHANGES);
  // A single exchange too large for the budget is dropped, not kept alone:
  // keeping it would guarantee the request-too-large this trim prevents.
  assert.deepEqual(authoring._test.trimHistory([exchange("driver", 99 * 1024 * 1024)]), []);
});

test("a rejected reasoning chain degrades to images only, never to a lost panel", async () => {
  // Signature acceptance rules are the provider's, not ours, and a malformed
  // history would fail EVERY surface identically. So attempt 2 drops it.
  const bytes = await solid(600, 300);
  const sent = [];
  const finish = await authoring.finishPanel(panelFixture(bytes, { width: 600, height: 300, surfaceKey: "passenger" }), {
    neighbours: [{ surfaceKey: "driver", bytes }],
    priorExchanges: [{
      surfaceKey: "driver",
      imageBytes: 1000,
      turns: [{ role: "user", parts: [{ text: "x" }] }, modelTurnFixture("stale")],
    }],
    store: { putImmutableBytes: async () => {} },
    callEdge: async (request) => {
      sent.push(request.priorTurns.length);
      if (request.priorTurns.length > 0) {
        assert.deepEqual(request.neighbours, [], "do not duplicate retained images");
        throw new Error("atlas_panel_history_hash_mismatch");
      }
      assert.deepEqual(request.neighbours.map((n) => n.surfaceKey), ["driver"], "dropping history must restore its sibling references");
      return { bytes: await solid(600, 300), modelTurn: null, thoughtSignatureCount: 0, panelByteSize: 10 };
    },
  });
  assert.deepEqual(sent, [2, 0], "the second attempt must drop the history");
  assert.equal(finish.applied, true, "the panel still lands without the chain");
  // Continuity was never acknowledged, so the chain restarts from this sheet
  // rather than claiming a lineage the provider did not confirm.
  assert.equal(finish.priorTurnsApplied, 0);
  assert.deepEqual(finish.nextExchanges, [], "an older edge without an exact exchange must not create invented history");
});

test("a RESUMED finished revision re-reads its panels instead of re-cutting them", () => {
  // The bug this locks: rowIdentity re-cut panels on resume and asserted they
  // reproduced the recorded hash. A finished panel is a model edit, so a re-cut
  // yields the CROP it started from -- a structural mismatch that would have
  // raised flat_atlas_panel_rebuild_mismatch on every resumed generation with
  // finishing on, permanently, not transiently.
  const body = runtimeSrc.slice(
    runtimeSrc.indexOf("async function rowIdentity("),
    runtimeSrc.indexOf("const viewAuthorities = await buildViewAuthorities(authorityPanels)"),
  );
  assert.match(body, /finishedRecords = recorded\.filter\(\(entry\) => entry\?\.panelAuthoringContract\)/);
  // Finished: re-read from immutable storage, hash-verified.
  assert.match(body, /bytes: await downloadVerified\(/);
  assert.match(body, /flat_atlas_panel_reload_transport_missing/);
  // Deterministic: recomputation is the stronger check and stays exactly as it
  // was. It must NOT have been softened into a storage read for everyone.
  assert.match(body, /authorityPanels = await cutCallOnePanels\(/);
  assert.match(body, /flat_atlas_panel_rebuild_mismatch/);
  const recut = body.indexOf("authorityPanels = await cutCallOnePanels(");
  const finished = body.indexOf("finishedRecords.length");
  assert.ok(finished > 0 && finished < recut,
    "the finished branch must be chosen before falling back to re-cutting");
  // And the resume caller must actually hand it a client to read with.
  assert.match(runtimeSrc, /\{ reused: true, supabase \}/);
});

test("holeRatio uses the SAME hole predicate as the master gate", () => {
  // Two definitions of "hole" would let this module accept a sheet the gate
  // convicts. CLAUDE.md makes the same point about the deterministic fill.
  const module = fs.readFileSync(new URL("../runtime/atlas-panel-authoring.cjs", import.meta.url), "utf8");
  assert.match(module, /require\("\.\/atlas-master-qc\.cjs"\)/);
  assert.match(module, /CUTOUT_ALPHA_MAX/);
  assert.match(module, /FLAT_BLACK_CHANNEL_MAX/);
});

test("production provenance accepts a FINISHED panel only with its full chain", () => {
  const base = {
    surfaceKey: "driver",
    metadata: {
      source: "atlas-call1-panel",
      promotedFrom: "atlas-call1",
      sourceStoragePath: "tenant/gen/revisions/1/panels/x.png",
      sourceContentHash: "b".repeat(64),
      sourceMasterHash: "c".repeat(64),
    },
  };
  // The deterministic crop is unchanged.
  assert.doesNotThrow(() => assertPanelAncestry({
    ...base, metadata: { ...base.metadata, deterministic: true },
  }));
  // A finished panel that names its contract AND the crop it came from.
  assert.doesNotThrow(() => assertPanelAncestry({
    ...base,
    metadata: {
      ...base.metadata,
      deterministic: false,
      panelAuthoringContract: authoring.PANEL_AUTHORING_CONTRACT,
      preFinishHash: "d".repeat(64),
    },
  }));
  // The refusal CODE is the contract downstream reads, not the prose.
  const refusalCode = (metadata) => {
    try {
      assertPanelAncestry({ ...base, metadata: { ...base.metadata, ...metadata } });
    } catch (cause) {
      return cause.code;
    }
    return "accepted";
  };
  // Neither claim: refused exactly as before this widening existed.
  assert.equal(refusalCode({ deterministic: false }), "production_ancestry_not_deterministic");
  // Contract named, but the crop behind it is not -- the chain is broken, so
  // nobody could prove what these pixels were finished from.
  assert.equal(
    refusalCode({ deterministic: false, panelAuthoringContract: authoring.PANEL_AUTHORING_CONTRACT }),
    "production_ancestry_incomplete",
  );
  // An unknown contract is not a passport.
  assert.equal(
    refusalCode({
      deterministic: false,
      panelAuthoringContract: "designpro.some-other-thing.v9",
      preFinishHash: "d".repeat(64),
    }),
    "production_ancestry_not_deterministic",
  );
});

test("the edge finishing prompt hands the model no vehicle anatomy", () => {
  // The measured lesson this repo keeps re-learning: naming a part makes the
  // model draw it (Desert Ridge c3a8ff40 carried ten anatomy refusals and came
  // back a van elevation). The finishing text states what the sheet IS.
  const tail = edgeSrc.slice(
    edgeSrc.indexOf("function atlasPanelFinishPrompt("),
    edgeSrc.indexOf("async function handleAtlasPanel("),
  );
  assert.ok(tail.length > 0, "the finishing prompt builder must exist");
  // Strip the builder's own comments before the sweep. The rule is about what
  // reaches the MODEL, and a comment explaining why a word is banned is not
  // the word being handed over -- this repo has convicted its own prose that
  // way before. Anchoring on a specific call shape is the other trap: this
  // used to slice from `lines.push`, and silently checked nothing the moment
  // the builder switched to an array literal.
  const emitted = tail
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  for (const forbidden of [
    "vehicle", "wheel", "window", "glass", "door", "arch", "bumper", "fender",
    "silhouette", "truck", "van", "car", "panel", "artboard", "template",
  ]) {
    // Whole words on both sides: a bare `\bcar` prefix convicts "carry", and
    // a test that fires on its own prose teaches nothing.
    assert.ok(
      !new RegExp(`\\b${forbidden}s?\\b`, "i").test(emitted),
      `the finishing prompt must not hand the image model "${forbidden}"`,
    );
  }
  assert.match(emitted, /the same composition, the same palette/);
  assert.match(emitted, /corner to corner, running off all four edges/);
  assert.match(emitted, /completed with the artwork that already surrounds it/);
});

test("the finishing prompt follows the provider's own structured-input guidance", () => {
  const tail = edgeSrc.slice(
    edgeSrc.indexOf("function atlasPanelFinishPrompt("),
    edgeSrc.indexOf("async function handleAtlasPanel("),
  );
  // Instructions separated from visual inputs with explicit markup, and every
  // attached asset declared with the role it plays.
  for (const tag of ["<task>", "<inputs>", "<subject>", "<instructions>", "<identity>"]) {
    assert.ok(tail.includes(tag), `the prompt must carry the ${tag} section`);
  }
  assert.match(tail, /role="subject"/);
  assert.match(tail, /role="visual-dna"/);
  assert.match(tail, /role="sibling-sheet"/);
  // Ask for an image explicitly, or a multimodal model may answer with text.
  assert.match(tail, /Generate an image/);
  // Legible typography is a native capability worth directing at.
  assert.match(tail, /same words, same spelling, same order/);
  assert.match(tail, /upright, whole, sharp/);
  // Say what the output IS, never what to avoid.
  assert.doesNotMatch(tail.slice(tail.indexOf("<task>")), /\bdo not draw\b|\bavoid\b|\bnever draw\b/i);
});

test("the declared input order is the order the handler actually attaches", () => {
  // The <inputs> block names subject → A.T.L.A.S. → siblings. If the handler
  // pushes them in any other order, every role description points at the wrong
  // image and nothing would fail loudly.
  const tail = edgeSrc.slice(
    edgeSrc.indexOf("function atlasPanelFinishPrompt("),
    edgeSrc.indexOf("async function handleAtlasPanel("),
  );
  const declared = ["role=\"subject\"", "role=\"visual-dna\"", "role=\"sibling-sheet\""]
    .map((role) => tail.indexOf(role));
  assert.ok(declared[0] < declared[1] && declared[1] < declared[2], "declared order");

  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasPanel("));
  const attached = [
    handler.indexOf("attach(body.sourcePanelStoragePath"),
    handler.indexOf("await attach(atlasReferencePath"),
    handler.indexOf("for (const neighbour of neighboursIn)"),
  ];
  assert.ok(attached.every((at) => at > 0), "all three attachment sites must exist");
  assert.ok(attached[0] < attached[1] && attached[1] < attached[2], "attachment order must match");
});

test("the edge and the runtime finish against the same pinned contract", () => {
  assert.match(edgeSrc, /ATLAS_PANEL_PROMPT_VERSION = "atlas-panel-finish\.20260908\.v5-exact-exchanges"/);
  assert.equal(authoring.PANEL_AUTHORING_PROMPT_VERSION, "atlas-panel-finish.20260908.v5-exact-exchanges");
  // The runtime and the function ship through DIFFERENT workflows, so a
  // runtime-first deploy must refuse rather than be answered by the old edge.
  assert.match(runtimeSrc, /flat_atlas_panel_edge_prompt_version_mismatch/);
  assert.match(runtimeSrc, /flat_atlas_panel_edge_surface_mismatch/);
});

test("the atlas-panel edge mode is internal-only and makes exactly one image request", () => {
  assert.match(edgeSrc, /if \(body\?\.mode === "atlas-panel"\) \{/);
  const dispatch = edgeSrc.slice(
    edgeSrc.indexOf('if (body?.mode === "atlas-panel") {'),
    edgeSrc.indexOf("return await handleAtlasPanel(body);"),
  );
  assert.match(dispatch, /atlas_panel_internal_only/);
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasPanel("));
  assert.match(handler, /imageRequestCount: 1,/);
  // One fetch to the model, and the subject sheet is the FIRST image -- the
  // prompt says "the first image", so an ordering change silently re-points
  // the whole instruction at a neighbour.
  assert.equal((handler.match(/await fetch\(geminiUrl/g) || []).length, 1);
  const source = handler.indexOf("attach(body.sourcePanelStoragePath");
  const neighbours = handler.indexOf("for (const neighbour of neighboursIn)");
  assert.ok(source > 0 && neighbours > source);
  // No aspect ratio is requested: an edit follows its input, and the flanks
  // are steeper than the model's aspect menu goes.
  const request = handler.slice(handler.indexOf("const modelRequest = JSON.stringify("), handler.indexOf("modelRequestByteSize"));
  assert.doesNotMatch(request, /aspectRatio/);
});
