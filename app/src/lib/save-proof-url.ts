/**
 * LOCKED — DO NOT CHANGE WITHOUT TRISH APPROVAL.
 *
 * Saves the 2D proof URL so RevisionStudio, QC Artboard, the panel slicer, and
 * every tool can find it back. It MUST persist to BOTH places, because a design
 * may live in either table and the panel pipeline reads designiq_generations:
 *
 *   1. color_visualizations.admin_notes.flat_proof_url  (universal client cache)
 *   2. designiq_generations.flat_proof_url              (production / panel slicer)
 *
 * The `flat_proof_url` COLUMN does NOT exist on color_visualizations — there it
 * lives inside the admin_notes JSON. On designiq_generations it IS a real column.
 *
 * Returns the result of each write so callers can surface a real error to the
 * user instead of silently losing a freshly generated proof. NEVER swallow the
 * failure with a bare console.warn — a failed write is why proofs "disappear".
 */
import { supabase } from "@/integrations/supabase/client";

export interface SaveProofResult {
  /** True only if at least the visualization admin_notes write succeeded. */
  ok: boolean;
  /** Set when the admin_notes write failed (the client-visible cache). */
  vizError?: string;
  /** Set when the designiq_generations mirror failed (production field). */
  genError?: string;
  /** The designiq_generations id we mirrored to, if one was resolved. */
  designiqGenerationId?: string | null;
}

/**
 * Persist `proofUrl` for `visualizationId`.
 *
 * @param visualizationId   color_visualizations.id (the row the UI is showing).
 * @param proofUrl          the generated 2D-proof public URL.
 * @param designiqGenId     optional designiq_generations.id to mirror to. When
 *                          omitted we resolve it from admin_notes.designiq_generation_id.
 */
export async function saveProofUrlToViz(
  visualizationId: string,
  proofUrl: string,
  designiqGenId?: string | null,
): Promise<SaveProofResult> {
  const result: SaveProofResult = { ok: false, designiqGenerationId: designiqGenId ?? null };

  if (!visualizationId || !proofUrl) {
    result.vizError = "Missing visualization id or proof URL";
    return result;
  }

  // ── PLACE 1 — color_visualizations.admin_notes.flat_proof_url (client cache) ──
  let notes: Record<string, any> = {};
  try {
    const { data: row, error: readErr } = await supabase
      .from("color_visualizations")
      .select("admin_notes")
      .eq("id", visualizationId)
      .maybeSingle();
    if (readErr) {
      // A read failure is non-fatal — start from empty notes and still attempt
      // the write so we don't lose the proof over a transient read error.
      console.warn("[saveProofUrl] admin_notes read warning:", readErr.message);
    }
    if (row?.admin_notes) {
      try { notes = JSON.parse(row.admin_notes); } catch { notes = {}; }
    }
  } catch (e: any) {
    console.warn("[saveProofUrl] admin_notes read threw:", e?.message || e);
  }

  notes.flat_proof_url = proofUrl;

  try {
    const { error: updErr } = await supabase
      .from("color_visualizations")
      .update({
        admin_notes: JSON.stringify(notes),
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

  // ── PLACE 2 — designiq_generations.flat_proof_url (production / panel slicer) ──
  // Resolve the gen id from the explicit arg first, then admin_notes. Without
  // this mirror the panel pipeline reads NULL and re-prompts a regenerate.
  const genId =
    designiqGenId ||
    (typeof notes.designiq_generation_id === "string" ? notes.designiq_generation_id : null);
  result.designiqGenerationId = genId;

  if (genId) {
    try {
      const { error: genErr } = await supabase
        .from("designiq_generations" as any)
        .update({ flat_proof_url: proofUrl } as any)
        .eq("id", genId);
      if (genErr) result.genError = genErr.message;
    } catch (e: any) {
      result.genError = e?.message || String(e);
    }
  }

  return result;
}
