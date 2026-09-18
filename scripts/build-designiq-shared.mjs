#!/usr/bin/env node
/**
 * Generate `_shared/designiq-assembly.ts` — A.C.E., importable by another
 * edge function WITHOUT re-typing one word of it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "Must use our suite of custom design edge
 * functions no fucking excuses!!!" — after a panel proof came back as generic
 * blue waves and stock photography. Measured cause: `production-panel-proof`
 * carried a designer paragraph I wrote, and NONE of the proven commercial
 * persona. Its prompt was 3,906 characters of which about 40 were the
 * customer's brief and zero were A.C.E.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN, AND WHY IT IS NOT THE THING RULE 0.26
 * DELETED. That rule deleted a RECONSTRUCTED persona bridge — a hand-made
 * second copy of the creative text, which drifts because nothing forces it not
 * to. This is the opposite object: it is sliced mechanically out of the
 * deployed `design-panel-ai-generate/index.ts`, byte for byte, and
 * `tests/designiq-shared-assembly.test.mjs` regenerates it and fails if what is
 * checked in differs by a character. Edit index.ts and this file must be
 * regenerated or the build goes red. It is the same move
 * `scripts/build-control-prompt.mjs` already makes for the A/B harness, whose
 * own header states the principle: "NOTHING IS REWRITTEN ... a drifted
 * vendored copy fails the run rather than quietly becoming the control."
 *
 * WHY NOT JUST IMPORT index.ts. It calls `serve()` at module scope, so
 * importing it from another function would start an HTTP server inside that
 * function's isolate. The `serve(` call is exactly the boundary sliced at.
 *
 * WHY NOT MOVE THE REGION INSTEAD, WHICH WOULD LEAVE ONE HOME. Because
 * `design-panel-ai-generate` is the sole Call-1 endpoint every customer
 * generation runs through (RULE 0.26), and this change exists to improve a
 * PROBE surface. A generated copy with a drift lock buys the same guarantee at
 * zero risk to that path; relocating the region does not. If the assembly is
 * ever refactored for its own reasons, collapsing these two into one module is
 * the right follow-up — and the lock will make that safe to do.
 *
 * THE IMPORT HEADER IS THE ONE THING THAT CHANGES, and only by DELETION: the
 * `serve` import goes, because the sliced region never calls it and keeping it
 * would pull the server in behind the prompt builder. Every other import is
 * kept verbatim, so the region cannot reference an identifier that is not
 * there. The control-prompt slicer strips all imports and re-adds three, which
 * is right for a Node test harness and wrong for a deployed module: esbuild
 * does not type-check, so an unresolved identifier would bundle cleanly and
 * fail in front of a customer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SOURCE = join(REPO, "supabase/functions/design-panel-ai-generate/index.ts");
export const GENERATED = join(REPO, "supabase/functions/_shared/designiq-assembly.ts");

/** What the generated module hands to anything that imports it. */
const EXPORTS = ["buildDesignIQPrompt", "briefWantsPhoto", "splitStyleAndText"];

const BANNER = `// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  GENERATED FILE — DO NOT EDIT. Run scripts/build-designiq-shared.mjs.  ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// A.C.E., sliced byte-for-byte out of the deployed
// supabase/functions/design-panel-ai-generate/index.ts at its serve() boundary,
// so a second edge function can EXECUTE the real creative assembly instead of
// re-describing it (owner ruling, Trish 2026-09-18: "Must use our suite of
// custom design edge functions"). The only edit is the removal of the \`serve\`
// import, which the sliced region never calls.
//
// tests/designiq-shared-assembly.test.mjs regenerates this and fails on a
// single character of difference, so it cannot drift from the function that is
// actually deployed. Change index.ts, regenerate, commit both.
`;

export function buildDesignIQShared() {
  const source = readFileSync(SOURCE, "utf8");
  const boundary = source.indexOf("\nserve(async (req)");
  if (boundary < 0) {
    throw new Error("design-panel-ai-generate no longer contains the serve() boundary");
  }
  const pure = source.slice(0, boundary);
  // DELETE THE SERVE IMPORT, KEEP EVERY OTHER ONE. Matched on its exact line so
  // a reordered or renamed import fails here rather than silently leaving the
  // server import in a module that must not start one.
  const serveImport = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";\n`;
  if (!pure.includes(serveImport)) {
    throw new Error("the serve import is not in its expected form; check the slice before regenerating");
  }
  const withoutServe = pure.replace(serveImport, "");
  if (/\bserve\s*\(/.test(withoutServe)) {
    throw new Error("the sliced region still calls serve(); the boundary is wrong");
  }
  return `${BANNER}\n${withoutServe.trimEnd()}\n\nexport { ${EXPORTS.join(", ")} };\n`;
}

if (process.argv[1] && process.argv[1].endsWith("build-designiq-shared.mjs")) {
  const generated = buildDesignIQShared();
  writeFileSync(GENERATED, generated);
  console.log(`${GENERATED} — ${generated.length} chars`);
}
