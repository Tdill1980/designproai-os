"use strict";
/**
 * runtime/atlas-proof-3d.cjs — CALL 2: THE SEVEN 3D PROOFS, FROM THE PANELS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18: "2nd call is 3d proofs using our native design edge
 * functions suites. Feed the productionpanelproof."
 *
 * So this feeds each Zone-1 panel cut out of the panel production proof to the
 * SAME deployed photographer the rest of the system uses, one call per shot.
 *
 * ⛔ IT CREATES NO EDGE FUNCTION AND BUILDS NO PROMPT. Owner ruling, RULE 0.29,
 * verbatim: "DO NOT CREATE ANOTHER 3D EDGE FUNCTION. Use
 * supabase/functions/persona-photographer-render/index.ts with
 * persona-photographer-prompt.ts, view-angles-os.ts, studio-os.ts ... ATLAS
 * panel = artwork authority. Photographer + angles + studio + lighting =
 * presentation authority only."
 *
 * That rule exists because a second implementation of a proven stage drifts,
 * and the A/B against the pin measured exactly that: a Driver continuity
 * photograph the proven stack never sent, a 3.5K prompt against the
 * photographer's 1.4K, its own retry ladder, its own aspect ratio. Every one of
 * the eight refusals on request f3eb40c1 was a JUDGE VERDICT, not a renderer
 * error. So this file is a CALLER. It assembles no words at all.
 *
 * WHAT IT DOES OWN — the two things a caller must get right:
 *
 *   1. WHICH PANEL GOES TO WHICH SHOT. `ATLAS_SHOT_SURFACES` is the edge's own
 *      mapping and the edge REFUSES a mismatch (atlas_proof_surface_mismatch)
 *      rather than rendering. Refusing loudly is right, but a caller that
 *      relies on the far side to catch its own mistake has no idea it made one,
 *      so the pairing is asserted here too, against the same table.
 *   2. THE PANEL TRAVELS AS AN IDENTITY. `wrap-files` is private, so a public
 *      URL 400s (RULE 0.29's fourth banned behaviour) — the panel goes as a
 *      storage path plus sha256 and the function re-downloads and re-hashes it.
 *      That is also RULE 0.39's no-blobs rule across a node boundary.
 *
 * FOUR BEHAVIOURS THAT MUST NEVER COME BACK, named by RULE 0.29 and asserted in
 * the lock beside this file: skipping the reference for passenger-side and
 * close-up; a text-only retry that drops the artwork; a Driver continuity
 * reference injected into the other views; a public URL for the panel.
 *
 * CLOSE-UP NAMES ITS OWN SURFACE. The edge maps it to `null` and refuses an
 * unnamed one rather than defaulting to Driver — an invisible default there is
 * a close-up of the wrong side of the vehicle, which looks entirely plausible.
 */

const PROOF_3D_CONTRACT = "designpro.atlas-proof-3d.v1";

/**
 * The edge's own shot→surface table, mirrored so a wrong pairing is caught
 * HERE as well as there. `hood_detail`, not `hood`: the staging allowlist
 * rejected `hood_detail` once already and the mapping is the edge's, not ours
 * to tidy.
 */
const SHOT_SURFACES = Object.freeze({
  "side": "driver",
  "passenger-side": "passenger",
  "hood_detail": "hood",
  "front": "front",
  "rear": "rear",
  "roof": "roof",
  "close-up": null,
});

/** Driver first — RULE 0.23: the customer sees one real view before the set. */
const SHOT_ORDER = Object.freeze([
  "side", "passenger-side", "hood_detail", "front", "rear", "roof", "close-up",
]);

/**
 * Pair every shot with the panel that is its artwork authority.
 *
 * @param panels the cut Zone-1 panels, each `{surfaceKey, storagePath, contentHash}`.
 * @param closeUpSurface which surface the close-up details. Named, never defaulted.
 */
function planProofShots(panels, { closeUpSurface = "driver" } = {}) {
  const bySurface = new Map();
  for (const panel of panels) {
    if (panel && panel.surfaceKey) bySurface.set(panel.surfaceKey, panel);
  }
  return SHOT_ORDER.map((shotKey) => {
    const surfaceKey = SHOT_SURFACES[shotKey] ?? closeUpSurface;
    const panel = bySurface.get(surfaceKey);
    return { shotKey, surfaceKey, panel: panel || null };
  });
}

/**
 * Render ONE proof through the deployed photographer.
 *
 * Every field here is one the function actually reads; nothing is invented and
 * no prompt is assembled. `heroRenderUrl` is deliberately absent — the edge
 * refuses it outright (atlas_proof_hero_forbidden) because the panel is the
 * artwork authority, and sending one would be the hero dependency RULE 0.29
 * removed by name.
 */
async function renderProofShot({
  shotKey, surfaceKey, panel, vehicle = {}, finish = "Gloss", isPickup = false,
  generationId = null, supabaseUrl, serviceKey, ownerId, fetchImpl = fetch,
} = {}) {
  if (!panel || !panel.storagePath || !panel.contentHash) {
    // AN INCOMPLETE DEPENDENCY, NEVER A SILENT SUBSTITUTION. Rendering this
    // shot from a neighbour's panel is what "do not use Driver as artwork
    // continuity authority" forbids, and it would look plausible.
    throw new Error(`atlas_proof_3d_panel_missing:${shotKey}/${surfaceKey}`);
  }
  const expected = SHOT_SURFACES[shotKey];
  if (expected !== undefined && expected !== null && surfaceKey !== expected) {
    throw new Error(`atlas_proof_3d_surface_mismatch:${shotKey} needs ${expected}, got ${surfaceKey}`);
  }
  if (expected === null && !surfaceKey) {
    throw new Error("atlas_proof_3d_detail_surface_unselected");
  }

  const response = await fetchImpl(`${supabaseUrl}/functions/v1/persona-photographer-render`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "content-type": "application/json",
      "x-designpro-owner-id": ownerId,
    },
    body: JSON.stringify({
      mode: "atlas-proof",
      shotKey,
      surfaceKey,
      // THE PANEL AS AN IDENTITY, NOT AS BYTES. wrap-files is private; the
      // function re-downloads and re-hashes and refuses on a mismatch.
      sourcePanelStoragePath: panel.storagePath,
      sourcePanelHash: panel.contentHash,
      sourcePanelContentType: panel.contentType || "image/png",
      sourceMasterHash: panel.sourceMasterHash || null,
      generationId,
      vehicleYear: vehicle.year || null,
      vehicleMake: vehicle.make || null,
      vehicleModel: vehicle.model || null,
      finish,
      isPickup,
    }),
  });

  const payload = await response.json().catch(() => ({ error: "unparseable response" }));
  if (!response.ok || payload?.success === false) {
    throw new Error(`atlas_proof_3d_failed:${shotKey}:${payload?.error || response.status}`);
  }
  return { shotKey, surfaceKey, ...payload };
}

/**
 * The seven shots: Driver alone first, then the remaining six CONCURRENTLY.
 *
 * RULE 0.23 is the reason for the shape and it is a product decision, not an
 * optimisation: "the customer must not wait for seven proofs to see whether the
 * design is right." Driver lands about a minute before the set, the product
 * asks there, and a revision supersedes the other six anyway — so rendering
 * them in front of that question spends six calls on a design already rejected.
 *
 * A failed shot does NOT take the others down. Six good proofs and one honest
 * gap is a better outcome than nothing, and it is the same blast-radius rule
 * the finishing path already follows.
 */
async function renderProofSet(opts = {}) {
  const { panels = [], closeUpSurface = "driver", render = renderProofShot } = opts;
  const plan = planProofShots(panels, { closeUpSurface });
  const results = [];

  const run = async (entry) => {
    try {
      return { ...(await render({ ...opts, ...entry })), ok: true };
    } catch (error) {
      return { shotKey: entry.shotKey, surfaceKey: entry.surfaceKey, ok: false,
        error: String(error?.message || error).slice(0, 200) };
    }
  };

  const [driver, ...rest] = plan;
  results.push(await run(driver));
  // The remaining six go together; only the driver gates the customer's view.
  results.push(...await Promise.all(rest.map(run)));

  return {
    contract: PROOF_3D_CONTRACT,
    proofs: results,
    accepted: results.filter((r) => r.ok).length,
    refused: results.filter((r) => !r.ok),
  };
}

module.exports = {
  PROOF_3D_CONTRACT, SHOT_SURFACES, SHOT_ORDER,
  planProofShots, renderProofShot, renderProofSet,
};
