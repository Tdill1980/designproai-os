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

test("all four proof-stack sources are byte-identical to the pin", () => {
  // Verified against the pinned commit 2026-08-27.
  assert.equal(sha("supabase/functions/persona-photographer-render/index.ts"), "7aefea1f1b8ca899");
  assert.equal(sha("supabase/functions/_shared/persona-photographer-prompt.ts"), "11cb76524211e42a");
  assert.equal(sha("supabase/functions/_shared/studio-os.ts"), "7b02814bb1e9e867");
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
  assert.match(provider, /STUDIO_ENVIRONMENT/, "the proof prompt must consume the studio kernel");
  for (const invented of ["LED strip", "daylight balanced", "seamless white cyclorama"]) {
    assert.ok(!provider.includes(invented), `the runtime must not restate studio text: ${invented}`);
  }
});
