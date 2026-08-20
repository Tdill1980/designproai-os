import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const gateway = readFileSync(join(root, "gateway", "src", "server.mjs"), "utf8");
const worker = readFileSync(join(root, "runtime", "generation-worker.cjs"), "utf8");
const prompt = readFileSync(join(root, "runtime", "designiq-prompt.cjs"), "utf8");

/**
 * The defect this exists to prevent, in the exact shape it occurred:
 * CALLS_1_7_V2_KEYS is a CLOSED allowlist -- `if (extraKeys.length …)` refuses
 * the request. The worker read eight fields the allowlist did not carry, so a
 * brief that named a finish, a mascot or a VisionBoardIQ reference did not lose
 * them quietly; it 400'd. The two lists were written against different field
 * sets and nothing held them together.
 */
test("every field the worker reads is a field the gateway admits", () => {
  const declared = gateway.match(/const CALLS_1_7_V2_KEYS = \[([\s\S]*?)\];/);
  assert.ok(declared, "CALLS_1_7_V2_KEYS must remain a readable literal");
  const allowed = new Set([...declared[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]));

  // What the worker actually reaches for, read out of the source rather than
  // restated here -- a hand-kept second list is how this drifted the first time.
  const read = new Set([...worker.matchAll(/input\?\.([a-zA-Z]+)/g)].map((m) => m[1]));
  // Names the worker resolves internally rather than receiving from the client.
  for (const derived of ["designBrief", "description", "business", "bodyText"]) read.delete(derived);

  const refused = [...read].filter((key) => !allowed.has(key)).sort();
  assert.deepEqual(refused, [], `the gateway refuses fields the worker reads: ${refused.join(", ")}`);
});

test("the reference images reach the model, and the two forbidden anchors do not", () => {
  // restylepro-os design-panel-ai-generate index.ts:1300 sends text + image
  // parts. This runtime sent text only, so the verified logo and the VisionBoard
  // references were stored and never shown to A.C.E.
  assert.match(worker, /inlineData: \{ mimeType: contentType, data: bytes\.toString\("base64"\) \}/,
    "references must be sent as inlineData parts");
  assert.match(worker, /verifySourceBytes\(asset,/,
    "reference bytes must be re-verified against their registered identity");
  assert.match(worker, /return \[\{ text: `\$\{design\}\$\{revision\}` \}, \.\.\.imageParts\]/,
    "the prompt part must be followed by the image parts");
  // Fetched once per request, not once per slot: seven slots share one logo.
  assert.match(worker, /const imageParts = await referenceImageParts\(supabase, claim\.input\)/);
  assert.doesNotMatch(worker, /promptPartsFor\(input, sourceViewType, instructions\[sourceViewType\]\)/,
    "slots must pass the image parts through");

  // The hero anchor put driver artwork on every panel and was deleted on
  // purpose. Porting it back from restylepro would reintroduce a known defect.
  // Comments are stripped first: referenceImageParts documents by name the two
  // arrays it deliberately does NOT port, and a rule must not fail on its own
  // statement of itself.
  const workerCode = worker
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/studioAnchorParts/, /cross-vehicle design anchor/i]) {
    assert.doesNotMatch(workerCode, forbidden, "the deleted hero anchor must not return");
  }
});

test("A.C.E. carries both personas, and an unset mode still means commercial", () => {
  assert.match(prompt, /function buildRestylePrompt\(/, "the restyle half of A.C.E. must be ported");
  assert.match(prompt, /You are WePrintWraps\.com Lead Vehicle Wrap Designer/,
    "the golden restyle identity must be carried verbatim");
  assert.match(prompt, /You are the senior graphic designer at a sign and wrap company/,
    "the commercial identity must be unchanged");
  assert.match(prompt, /String\(mode \|\| ""\)\.toLowerCase\(\) === "restyle"/,
    "the persona must be chosen by mode, the way index.ts:446 does");
  assert.match(worker, /mode: input\?\.mode/, "the worker must thread mode into the prompt");
});

test("both personas stay inside the prompt-length ceiling", async () => {
  const { buildDesignIQPrompt } = await import(`file://${join(root, "runtime", "designiq-prompt.cjs")}`)
    .then((m) => m.default ?? m);
  const brief = {
    prompt: "distressed Martini livery", finish: "Gloss", companyName: "Summit Ridge Electric",
    phone: "(555) 872-4400", industryType: "electrical", viewType: "side",
    vehicleYear: "1973", vehicleMake: "Porsche", vehicleModel: "911",
  };
  const restyle = buildDesignIQPrompt({ ...brief, mode: "restyle" });
  const commercial = buildDesignIQPrompt({ ...brief, mode: "commercial" });
  // "If a prompt exceeds ~6,000 characters, it's too long" -- prompt length is
  // the documented quality killer for this model.
  for (const [label, text] of [["restyle", restyle], ["commercial", commercial]]) {
    assert.ok(text.length < 6000, `${label} prompt is ${text.length} chars, over the 6000 ceiling`);
  }
  assert.notEqual(restyle, commercial, "the two personas must actually differ");
  assert.equal(buildDesignIQPrompt(brief), commercial, "an unset mode must behave exactly as before");
});
