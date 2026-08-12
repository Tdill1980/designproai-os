/**
 * Saves the master ARTBOARD url so DesignAssetsPanel, RevisionStudio, the panel
 * builder, and every tool can find it back — the artboard sibling of
 * `save-proof-url.ts`, and it exists for the same reason: the write used to go to
 * a column that does NOT exist.
 *
 * REGRESSION (found 2026-07-25): seven tool hooks (ColorPro, DesignPro,
 * DesignPanelPro, GraphicsPro, WBTY/PatternPro, FadeWraps, MyVehicle) each did
 *   `color_visualizations.update({ master_artboard_path: artUrl })`
 * after auto-generate-artboard returned. `master_artboard_path` exists ONLY on
 * `design_revisions`, never on `color_visualizations`, so every one of those
 * writes 42703'd and was swallowed by a "non-fatal" catch. Nothing ever read it
 * back either — the real readers use the two locations below. The client-side
 * artboard cache therefore never persisted for ANY tool.
 *
 * It MUST persist to the places the app actually reads:
 *   1. color_visualizations.render_urls.master_artboard  (viz fallback —
 *      DesignAssetsPanel reads `cv.render_urls.master_artboard`). render_urls is
 *      jsonb; we read-merge so existing view renders are preserved.
 *   2. designiq_generations.master_artboard_url          (canonical/primary —
 *      DesignAssetsPanel `gen?.master_artboard_url`, buildProductionPanels,
 *      enticePanelsFromProof). Mirrored only when a designiq gen id resolves.
 *
 * Returns the result of each write so callers can surface a real error instead
 * of silently losing a freshly built artboard. NEVER swallow with a bare warn.
 */
import { supabase } from "@/integrations/supabase/client";

export interface SaveArtboardResult {
  /** True once the viz render_urls cache write succeeds. */
  ok: boolean;
  /** Set when the color_visualizations render_urls write failed. */
  vizError?: string;
  /** Set when the designiq_generations mirror failed. */
  genError?: string;
  /** The designiq_generations id we mirrored to, if one was resolved. */
  designiqGenerationId?: string | null;
}

/**
 * Persist `artboardUrl` for `visualizationId`.
 *
 * @param visualizationId   color_visualizations.id (the row the UI is showing).
 * @param artboardUrl       the master artboard public URL from auto-generate-artboard.
 * @param designiqGenId     optional designiq_generations.id to mirror to. When
 *                          omitted we resolve it from admin_notes.designiq_generation_id.
 */
export async function saveArtboardUrlToViz(
  visualizationId: string,
  artboardUrl: string,
  designiqGenId?: string | null,
): Promise<SaveArtboardResult> {
  const result: SaveArtboardResult = { ok: false, designiqGenerationId: designiqGenId ?? null };

  if (!visualizationId || !artboardUrl) {
    result.vizError = "Missing visualization id or artboard URL";
    return result;
  }

  // ── PLACE 1 — color_visualizations.render_urls.master_artboard (viz cache) ──
  // render_urls is jsonb and holds the customer's view render URLs. Read-merge
  // so we ADD master_artboard without clobbering the existing views. We also
  // parse admin_notes here to resolve the designiq back-link for Place 2.
  let renderUrls: Record<string, any> = {};
  let notes: Record<string, any> = {};
  try {
    const { data: row, error: readErr } = await supabase
      .from("color_visualizations")
      .select("render_urls, admin_notes")
      .eq("id", visualizationId)
      .maybeSingle();
    if (readErr) {
      console.warn("[saveArtboardUrl] viz read warning:", readErr.message);
    }
    if (row?.render_urls && typeof row.render_urls === "object" && !Array.isArray(row.render_urls)) {
      renderUrls = { ...(row.render_urls as Record<string, any>) };
    }
    if (row?.admin_notes) {
      try { notes = JSON.parse(row.admin_notes); } catch { notes = {}; }
    }
  } catch (e: any) {
    console.warn("[saveArtboardUrl] viz read threw:", e?.message || e);
  }

  renderUrls.master_artboard = artboardUrl;

  try {
    const { error: updErr } = await supabase
      .from("color_visualizations")
      .update({
        render_urls: renderUrls,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visualizationId);
    if (updErr) {
      result.vizError = updErr.message;
    } else {
      result.ok = true;
    }
  } catch (e: any) {
    result.vizError = e?.message || String(e);
  }

  // ── PLACE 2 — designiq_generations.master_artboard_url (canonical) ──
  // Resolve the gen id from the explicit arg first, then admin_notes. Without
  // this mirror the panel pipeline reads NULL for designiq-keyed designs.
  const genId =
    designiqGenId ||
    (typeof notes.designiq_generation_id === "string" ? notes.designiq_generation_id : null);
  result.designiqGenerationId = genId;

  if (genId) {
    try {
      const { error: genErr } = await supabase
        .from("designiq_generations" as any)
        .update({ master_artboard_url: artboardUrl } as any)
        .eq("id", genId);
      if (genErr) result.genError = genErr.message;
    } catch (e: any) {
      result.genError = e?.message || String(e);
    }
  }

  return result;
}
