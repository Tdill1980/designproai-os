/**
 * approvepro-version-proof
 *
 * Step 2 of the clean-first/version pipeline: regenerate the 2D PRODUCTION PROOF
 * (the dimensioned multi-view source for print files) for a proof's version and
 * save it back onto that version's render_urls.production_proof.
 *
 * A.C.E (approvepro-autogen-design) already does this when it generates a design.
 * The OTHER ways a new proof_versions row is created — "Upload fresh files"
 * (ProofUploadVersion) and "Attach a design you made" — produced a version with
 * NO 2D source. This makes EVERY sequential change generate a new 2D source in
 * the SAME version history (proof_versions), so the version the customer/shop
 * sees always carries its dimensioned production proof (the print-file source).
 *
 * Mirrors autogen step 3: WPW template only for WPW orders; dimensions from the
 * vehicle DB cache → Google-grounding fallback (vehicle-lookup); a revision bases
 * the new proof on the prior version's proof (previousProofUrl) + the change note.
 *
 * Input:  { proof_id, version_id?, revisionNote? }  (version_id defaults to active)
 * Output: { success, proofUrl } | { success:false, error }
 *
 * verify_jwt = false (service-role internal orchestration).
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// View keys that are NOT per-view vehicle renders — never feed them to the 2D
// proof painter as a source view.
const NON_VIEW_KEYS = new Set(["production_proof", "proof_2d"]);

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { proof_id?: string; version_id?: string; revisionNote?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.proof_id) return json({ error: "proof_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: proof, error: pErr } = await db
    .from("proof_approvals")
    .select("*")
    .eq("id", body.proof_id)
    .single();
  if (pErr || !proof) return json({ success: false, error: "Proof not found" }, 404);

  // Resolve the target version (explicit id, else the active one).
  let versionQuery = db
    .from("proof_versions")
    .select("id, version_number, render_urls")
    .eq("proof_id", proof.id);
  versionQuery = body.version_id
    ? versionQuery.eq("id", body.version_id)
    : versionQuery.eq("is_active", true);
  const { data: version } = await versionQuery
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return json({ success: false, error: "No version found for proof" }, 404);

  const renderUrls: Record<string, string> = (version.render_urls as any) || {};
  const allViewUrls: Record<string, string> = {};
  for (const [k, u] of Object.entries(renderUrls)) {
    if (u && !NON_VIEW_KEYS.has(k)) allViewUrls[k] = u as string;
  }
  const sideUrl = allViewUrls.side || allViewUrls.hero || Object.values(allViewUrls)[0];
  if (!sideUrl) return json({ success: false, error: "Version has no render views to build a proof from" }, 400);

  const meta = (proof.metadata as any) || {};
  const isWpwOrder = meta.auto_ingested === "wpw" || !!(meta.wpw_order_number || meta.wpw_woo_order_id);
  const shopName = isWpwOrder ? "WePrintWraps" : (meta.shop_name || (proof as any).shop_name || "");

  // Dimensions: vehicle DB cache → Google-grounding fallback (vehicle-lookup).
  let dimensions: Record<string, number> | undefined;
  if (proof.vehicle_make && proof.vehicle_model) {
    try {
      const vr = await fetch(`${supabaseUrl}/functions/v1/vehicle-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: anonKey },
        body: JSON.stringify({ make: proof.vehicle_make, model: proof.vehicle_model, year: proof.vehicle_year || "" }),
      });
      const vj = await vr.json().catch(() => ({}));
      const v = vj?.vehicle;
      if (v && (v.side_w || v.sideW)) {
        dimensions = {
          sideW: v.side_w ?? v.sideW, sideH: v.side_h ?? v.sideH,
          hoodW: v.hood_w ?? v.hoodW, hoodL: v.hood_l ?? v.hoodL,
          roofW: v.roof_w ?? v.roofW, roofL: v.roof_l ?? v.roofL,
          backW: v.back_w ?? v.backW, backH: v.back_h ?? v.backH,
          totalSqFt: v.total_sq_ft ?? v.totalSqFt,
          corrSqFt: v.corr_sq_ft ?? v.corrSqFt,
        };
      }
    } catch (e) {
      console.warn("version-proof: vehicle-lookup dims (non-fatal):", (e as any)?.message || e);
    }
  }

  // Revision continuity: base the new proof on the PRIOR version's 2D proof.
  const revisionNote = (body.revisionNote && String(body.revisionNote).trim()) ||
    (proof.change_request && String(proof.change_request).trim()) || undefined;
  let previousProofUrl: string | undefined = renderUrls.production_proof || renderUrls.proof_2d || undefined;
  if (!previousProofUrl) {
    const { data: prevVer } = await db
      .from("proof_versions")
      .select("render_urls")
      .eq("proof_id", proof.id)
      .neq("id", version.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevUrls = (prevVer?.render_urls as any) || {};
    previousProofUrl = prevUrls.production_proof || prevUrls.proof_2d || undefined;
  }

  try {
    const p2 = await fetch(`${supabaseUrl}/functions/v1/generate-2d-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: anonKey },
      body: JSON.stringify({
        allViewUrls,
        sideUrl,
        vehicleYear: proof.vehicle_year || undefined,
        vehicleMake: proof.vehicle_make || undefined,
        vehicleModel: proof.vehicle_model || undefined,
        designName: proof.design_name || "Custom Design",
        finish: "Gloss",
        shopName,
        dimensions,
        revisionNote,
        previousProofUrl,
        // Self-persist flat_proof_url + artboard_clean_url on the design row so
        // every revision refreshes BOTH 8th-call assets (proof + clean artboard)
        // where /design-assets and the panel slicer read them.
        designiqGenerationId: (proof as any).source_visualization_id || undefined,
      }),
    });
    const pj = await p2.json().catch(() => ({}));
    if (!p2.ok || !pj?.proofUrl) {
      return json({ success: false, error: pj?.error || `generate-2d-proof ${p2.status}` }, 502);
    }

    const withProof = { ...renderUrls, production_proof: pj.proofUrl };
    await db.from("proof_versions").update({ render_urls: withProof }).eq("id", version.id);
    if ((proof as any).source_visualization_id) {
      await db.from("color_visualizations")
        .update({ render_urls: withProof })
        .eq("id", (proof as any).source_visualization_id);
    }
    await db.from("proof_events").insert({
      proof_id: proof.id, event_type: "version_saved", actor_role: "system",
      payload: {
        source: "version_proof_regen",
        version_number: version.version_number,
        proof_url: pj.proofUrl,
        wpw: isWpwOrder,
        revision: !!revisionNote,
      },
    });

    return json({ success: true, proofUrl: pj.proofUrl });
  } catch (e) {
    return json({ success: false, error: String((e as any)?.message || e) }, 500);
  }
});
