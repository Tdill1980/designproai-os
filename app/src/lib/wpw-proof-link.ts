/**
 * wpw-proof-link — keeps a WePrintWraps order's approval (proof_approvals)
 * pointed at the design that backs it.
 *
 * The gap this closes (the "order 34669 invisible" bug): a designer opens the
 * ApprovePro workbench's Design tab and designs the job in the embedded
 * DesignPro, or revises it in RevisionStudio — but nothing ever stamped
 * proof_approvals.source_visualization_id, so the order number never resolved
 * to the design. ApprovePro showed no design and RevisionStudio's order-number
 * search came up empty, even though the work was done.
 *
 * Two writes fix that, mirroring what AttachDesignDialog does manually:
 *   1. proof_approvals.source_visualization_id = the render id (order → design)
 *   2. the render's admin_notes gains wpw_proof_id + wpw_order_number
 *      (design → order, so plain-text search on the order # also hits)
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * The ApprovePro workbench passes the proof id to DesignPro via the URL
 * (?wpwProofId=…) — both in the embedded iframe and the full-screen link.
 * Read it at save time; no sessionStorage, so a later unrelated design in the
 * same tab can never mislink to a stale proof.
 */
export function getActiveWpwProofId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("wpwProofId");
  } catch {
    return null;
  }
}

/**
 * Link a just-saved design to the active WPW proof (no-op when DesignPro
 * wasn't opened from an ApprovePro order). Best-effort — never throws, never
 * blocks the save path.
 */
export async function linkDesignToWpwProof(vizId: string): Promise<void> {
  const proofId = getActiveWpwProofId();
  if (!proofId || !vizId) return;
  try {
    const { data: proof } = await (supabase as any)
      .from("proof_approvals")
      .select("id, metadata")
      .eq("id", proofId)
      .maybeSingle();
    if (!proof) return;

    // 1. Order → design (same write the manual Attach Design dialog does).
    await (supabase as any)
      .from("proof_approvals")
      .update({ source_visualization_id: vizId })
      .eq("id", proofId);

    // 2. Design → order: stamp the order number into admin_notes so the
    //    RevisionStudio search matches the design directly. admin_notes is
    //    rebuilt on every save, so re-merge rather than assume it's there.
    const md = (proof.metadata && typeof proof.metadata === "object") ? proof.metadata : {};
    const orderNo = md.wpw_order_number || md.woo_order_number || md.wpw_woo_order_id || null;
    const { data: viz } = await supabase
      .from("color_visualizations")
      .select("admin_notes")
      .eq("id", vizId)
      .maybeSingle();
    let notes: Record<string, unknown> = {};
    try { notes = JSON.parse((viz as any)?.admin_notes || "{}"); } catch { notes = {}; }
    notes.wpw_proof_id = proofId;
    if (orderNo) notes.wpw_order_number = String(orderNo);
    await supabase
      .from("color_visualizations")
      .update({ admin_notes: JSON.stringify(notes) })
      .eq("id", vizId);

    console.log(`[WPW-LINK] Design ${vizId} linked to proof ${proofId}${orderNo ? ` (order ${orderNo})` : ""}`);
  } catch (e) {
    console.warn("[WPW-LINK] link failed (non-fatal):", e);
  }
}

/**
 * A revision clones the design into a NEW color_visualizations row. Any
 * approval pointing at the old row must follow, or ApprovePro keeps showing
 * (and AI-revising) a stale version. Single conditional UPDATE — a no-op for
 * designs that never backed an order.
 */
export async function advanceWpwProofLink(oldVizId: string, newVizId: string): Promise<void> {
  if (!oldVizId || !newVizId || oldVizId === newVizId) return;
  try {
    await (supabase as any)
      .from("proof_approvals")
      .update({ source_visualization_id: newVizId })
      .eq("source_visualization_id", oldVizId);
  } catch (e) {
    console.warn("[WPW-LINK] advance failed (non-fatal):", e);
  }
}
