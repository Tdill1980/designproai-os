/**
 * atlas-proof-container-render.ts — THE CONTAINER, RASTERISED INSIDE THE EDGE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "just use template wired as a studio edge
 * function", and earlier, on the shape of it: "The request handler must import
 * ... `renderPanelStudioContainer` directly from your shared internal modules."
 * This is that module.
 *
 * THE CORRECTION THIS FILE CARRIES. I said repeatedly that the container could
 * not be rendered in the edge function. The true statement is narrower: *sharp*
 * cannot, because it is libvips through a native binding and Deno has no loader
 * for one. `@resvg/resvg-wasm` is a WebAssembly build of the same resvg the
 * Rust world uses, it runs in Deno, and the sheet is 1.6 MP rather than the
 * 17 MP a returned proof is — so the memory objection that keeps pixel
 * validation off this side does not apply to drawing a 1536x1024 document.
 *
 * THE DRAWING IS NOT IN HERE, DELIBERATELY. `atlas-proof-container-template.ts`
 * builds the SVG and imports nothing; this file only turns that string into
 * PNG bytes. So a change to the sheet never touches wasm plumbing, a wasm
 * failure can never change a glyph, and the byte-lock against the runtime twin
 * can execute the drawing without instantiating a module at all.
 *
 * THE WASM IS FETCHED ONCE PER ISOLATE AND THE FONT IS NOT FETCHED AT ALL.
 * resvg carries no system fonts, so the font is embedded beside this file
 * (`atlas-proof-sans.ts`, a 14 KB subset); a network round trip for the glyphs
 * would be a second way for the sheet to come back blank. The wasm itself is
 * 1.2 MB and cannot reasonably be inlined, so it is fetched from a pinned
 * jsDelivr URL at the exact version this module imports — a floating version
 * against a pinned import is how an ABI mismatch arrives silently.
 *
 * IT RETURNS A REFERENCE, NEVER BYTES, TO WHATEVER CALLS IT ACROSS A BOUNDARY.
 * `stageProofContainer` writes the PNG to `atlas-call1-inputs/<sha256>.png` and
 * hands back `{storagePath, contentHash, byteSize}` — RULE 0.39's rule for a
 * node handoff, and it lands the object on exactly the content-addressed path
 * the Call-1 input allowlist admits, so the same three checks that guard the
 * hero view guard this too.
 */

import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";
import {
  CONTAINER_CONTRACT,
  containerSvg,
  HEIGHT,
  parsePanelRows,
  WIDTH,
  type ContainerOptions,
} from "./atlas-proof-container-template.ts";
import { PROOF_SANS_FAMILY, proofSansBytes } from "./atlas-proof-sans.ts";

/** Pinned to the version imported above. These two must move together. */
const RESVG_VERSION = "2.6.2";
const RESVG_WASM_URL =
  `https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@${RESVG_VERSION}/index_bg.wasm`;

/**
 * `initWasm` throws if it is called twice, and a Deno isolate serves many
 * requests, so the promise is memoised rather than the call repeated. A FAILED
 * init is not memoised as a success: the promise is cleared so the next request
 * retries instead of inheriting one bad cold start forever.
 */
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(fetch(RESVG_WASM_URL)).catch((error) => {
      wasmReady = null;
      throw new Error(`panel_proof_container_wasm_unavailable:${String((error as Error)?.message || error)}`);
    });
  }
  return wasmReady;
}

export interface RenderedContainer {
  bytes: Uint8Array;
  width: number;
  height: number;
  contract: string;
  svgChars: number;
}

/** Draw the container for THIS request's six panels and rasterise it. */
export async function renderPanelStudioContainer(options: ContainerOptions): Promise<RenderedContainer> {
  const svg = containerSvg(options);
  await ensureWasm();
  const resvg = new Resvg(svg, {
    // loadSystemFonts stays FALSE on purpose: there are none, and leaving it on
    // makes resvg probe a filesystem that cannot answer. The embedded subset is
    // the only face, and `defaultFontFamily` is what `sans-serif` resolves to.
    font: {
      fontBuffers: [proofSansBytes()],
      defaultFontFamily: { sansSerifFamily: PROOF_SANS_FAMILY },
      loadSystemFonts: false,
    },
  });
  const bytes = resvg.render().asPng();
  // A SHEET WITH NO INK ON IT IS THE FAILURE THIS WHOLE FILE EXISTS TO AVOID.
  // If the font ever fails to attach, resvg still returns a valid PNG — a white
  // one — and a blank teaching input reads to an image model as content to
  // interpret rather than as a document to fill. The Prius sheet is ~109 KB and
  // the F250's is the same order; an all-white 1536x1024 PNG compresses to a
  // few kilobytes, so the byte size separates the two cases without a decode.
  if (bytes.length < (options.mode === "artwork" ? 100 : 20_000)) {
    throw new Error(`panel_proof_container_render_empty:${bytes.length}`);
  }
  return { bytes, width: WIDTH, height: HEIGHT, contract: CONTAINER_CONTRACT, svgChars: svg.length };
}

export interface StagedContainer {
  storagePath: string;
  contentHash: string;
  byteSize: number;
  contract: string;
  width: number;
  height: number;
  svgChars: number;
}

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Render it and put it where a Call-1 input is allowed to live.
 *
 * `upsert: false` with an "exists" tolerance is the right shape for a
 * content-addressed write: the same manifest and the same strings produce the
 * same bytes, so a repeat request finds its own object already there and must
 * not treat that as an error — nor overwrite it, because identical bytes cannot
 * need overwriting and non-identical bytes could not reach this path.
 */
export async function stageProofContainer(
  // Structurally typed rather than importing the storage client: this module is
  // shared, and a supabase-js version bump must not be able to break a drawing.
  storage: { upload: (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) => Promise<{ error: unknown }> },
  options: ContainerOptions,
): Promise<StagedContainer> {
  const rendered = await renderPanelStudioContainer(options);
  const contentHash = await sha256Hex(rendered.bytes);
  const storagePath = `atlas-call1-inputs/${contentHash}.png`;
  const { error } = await storage.upload(storagePath, rendered.bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (error && !/exists/i.test(String((error as { message?: string })?.message || error))) {
    throw new Error(`panel_proof_container_stage_failed:${String((error as { message?: string })?.message || error)}`);
  }
  return {
    storagePath,
    contentHash,
    byteSize: rendered.bytes.length,
    contract: rendered.contract,
    width: rendered.width,
    height: rendered.height,
    svgChars: rendered.svgChars,
  };
}

export { parsePanelRows };
