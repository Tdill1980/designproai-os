/**
 * getArtGenerator — selects the art engine. Swapping Gemini -> Vertex happens
 * HERE and only here; no caller or the compositor changes.
 *
 * Selection precedence: explicit per-request preference, then env flag,
 * then default (Gemini). The Vertex implementation is added later as a new
 * file implementing ArtGenerator and wired in below behind VERTEX_ENABLED.
 */

import type { ArtGenerator } from "./types.ts";
import { GeminiArtGenerator } from "./gemini-art-generator.ts";

export function getArtGenerator(modelPref?: string): ArtGenerator {
  const pref = (modelPref || Deno.env.get("ART_GENERATOR") || "").toLowerCase();

  if (pref === "vertex" && Deno.env.get("VERTEX_ENABLED") === "1") {
    // Phase: DesignDNA. Drop in `new VertexArtGenerator()` here — same interface.
    // Falls through to Gemini until the implementation + flag are in place.
  }

  return new GeminiArtGenerator();
}
