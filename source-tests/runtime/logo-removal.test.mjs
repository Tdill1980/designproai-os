import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  LOGO_LOCATE_PROMPT,
  collapseContainedLogoElements,
  isHonestNoOp,
  locateLogoElements,
  logoBoxesToPixelRects,
  strictGeminiBox2d,
} = require("../../runtime/logo-removal.cjs");

test("a missing box_2d throws rather than being guessed or dropped", () => {
  assert.throws(() => strictGeminiBox2d({ label: "emblem" }, 0), /has no box_2d coordinates/);
  assert.throws(() => strictGeminiBox2d({ box_2d: [10, 10, 20] }, 0), /exactly four coordinates/);
  assert.throws(() => strictGeminiBox2d({ box_2d: [10, 10, 5, 20] }, 0), /not an ordered box/);
  assert.throws(() => strictGeminiBox2d({ box_2d: [0, 0, 1200, 10] }, 0), /within 0\.\.1000/);
});

test("the live Gemini box_2d_ alias is accepted, and a conflicting alias is refused", () => {
  assert.deepEqual(strictGeminiBox2d({ box_2d_: [1, 2, 3, 4] }, 0), [1, 2, 3, 4]);
  assert.deepEqual(strictGeminiBox2d({ box_2d: [1, 2, 3, 4], box: [1, 2, 3, 4] }, 0), [1, 2, 3, 4]);
  assert.throws(() => strictGeminiBox2d({ box_2d: [1, 2, 3, 4], box: [5, 6, 7, 8] }, 0), /conflicting coordinate fields/);
});

test("a box wholly inside another collapses into it and keeps both labels", () => {
  const collapsed = collapseContainedLogoElements([
    { label: "lockup", b: [0, 0, 500, 500] },
    { label: "emblem", b: [100, 100, 200, 200] },
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].label, "lockup + emblem");
  const disjoint = collapseContainedLogoElements([
    { label: "left", b: [0, 0, 100, 100] },
    { label: "right", b: [500, 500, 600, 600] },
  ]);
  assert.equal(disjoint.length, 2);
});

test("boxes dilate about 3 percent, clamp to the panel and drop detector noise", () => {
  const [rect] = logoBoxesToPixelRects([{ label: "emblem", b: [500, 500, 600, 600] }], 1000, 1000);
  // 30/1000 of a 1000px panel is 30px of dilation on every side.
  assert.deepEqual(rect, { label: "emblem", x: 470, y: 470, w: 160, h: 160 });

  const [clamped] = logoBoxesToPixelRects([{ label: "edge", b: [0, 0, 100, 100] }], 1000, 1000);
  assert.equal(clamped.x, 0, "must not clamp to a negative origin");
  assert.equal(clamped.y, 0);

  const [full] = logoBoxesToPixelRects([{ label: "wide", b: [900, 900, 1000, 1000] }], 1000, 1000);
  assert.equal(full.x + full.w, 1000, "must not exceed the panel width");

  assert.equal(
    logoBoxesToPixelRects([{ label: "speck", b: [500, 500, 501, 501] }], 100, 100).length,
    0,
    "a box under the minimum size is detector noise and is dropped",
  );
});

test("the locate loop re-asks up to three times before failing", async () => {
  let calls = 0;
  const elements = await locateLogoElements("Zm9v", {
    geminiJson: async () => {
      calls += 1;
      if (calls < 3) return { elements: [{ label: "emblem" }] }; // no box_2d — unusable
      return { elements: [{ label: "emblem", box_2d: [10, 10, 20, 20] }] };
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(elements, [{ label: "emblem", b: [10, 10, 20, 20] }]);

  await assert.rejects(
    locateLogoElements("Zm9v", { geminiJson: async () => ({ elements: [{ label: "x" }] }) }),
    /has no box_2d coordinates/,
    "exhausting the re-asks must fail loudly, never return a partial set",
  );
});

test("a bare array and alternate keys are accepted", async () => {
  const bare = await locateLogoElements("Zm9v", { geminiJson: async () => [{ label: "a", box_2d: [1, 1, 2, 2] }] });
  assert.equal(bare.length, 1);
  const keyed = await locateLogoElements("Zm9v", { geminiJson: async () => ({ logos: [{ label: "a", box_2d: [1, 1, 2, 2] }] }) });
  assert.equal(keyed.length, 1);
});

test("no logo mark is an honest no-op, not a failure", async () => {
  const none = await locateLogoElements("Zm9v", { geminiJson: async () => ({ elements: [] }) });
  assert.deepEqual(none, []);
  assert.equal(isHonestNoOp(logoBoxesToPixelRects(none, 1000, 1000)), true);
  assert.equal(isHonestNoOp([{ label: "emblem", x: 0, y: 0, w: 10, h: 10 }]), false);
});

test("the prompt targets logo marks only and never general lettering", () => {
  // Owner decision 2: Call 11 removes logos. A.C.E.-authored company name,
  // contact text and designed lettering may remain, and Call 11 must not
  // become a general text-removal system.
  for (const excluded of ["phone number", "website", "tagline", "street address"]) {
    assert.match(LOGO_LOCATE_PROMPT, new RegExp(excluded, "i"), `${excluded} must be named as excluded`);
  }
  assert.match(LOGO_LOCATE_PROMPT, /Do NOT box/, "the prompt must carry an explicit exclusion block");
  assert.match(LOGO_LOCATE_PROMPT, /ONLY the LOGO MARKS/, "the prompt must scope detection to logo marks");
});
