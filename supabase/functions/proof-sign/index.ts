/**
 * proof-sign — Phase 2 of the Proof Approval System.
 *
 * Customer action. Accepts:
 *   - token        (HMAC view token)
 *   - typed_name   (required)
 *   - signature_png_base64  (required, data URL or bare base64)
 *   - esign_consent (must be true)
 *   - idempotency_key (required — prevents double-signing on flaky networks)
 *
 * Flow:
 *   1. Verify HMAC on the token. Fetch proof (verify not terminal).
 *   2. Check idempotency_key — if already processed, return cached result.
 *   3. Upload signature PNG to `proof-signatures` bucket.
 *   4. Render the signed-proof HTML and hand off to DocRaptor for PDF.
 *   5. SHA-256 the PDF bytes, store in `proof-audit/<proof_id>/<sha>.pdf`.
 *   6. Flip status → approved (state machine trigger validates).
 *   7. Log 'signed' event with IP + UA + hash.
 *   8. Notify shop owner via Resend (non-blocking — logs warning on failure).
 *   9. Return signed PDF URL (or null if DocRaptor skipped).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { generatePdfFromHtml, sha256Hex } from "../_shared/docraptor.ts";
import { renderProofPdfHtml } from "../_shared/proof-pdf-template.ts";
import { notifyShopOfOutcome, notifyCustomerReadyToOrder, recordProofEmail } from "../_shared/proof-email.ts";

// ── Cart-on-approve helpers ──────────────────────────────────────────────────
// WePrintWraps printed-wrap pricing (matches the public ApprovePro Print
// Service page). The WPW cart confirms final pricing at checkout; this is the
// instant ballpark so the customer can buy the moment they approve.
const PRINT_PRICE_PER_SQFT = 12;
const VEHICLE_SQFT: Record<string, number> = {
  compact: 250, coupe: 280, car: 300, sedan: 300, hatch: 280,
  crossover: 380, suv: 400, jeep: 380, wagon: 340,
  truck: 450, pickup: 450, "f-150": 450, silverado: 450,
  van: 500, minivan: 420, commercial: 500, transit: 520,
  sprinter: 560, promaster: 560, box: 650, bus: 800, trailer: 700,
};
function estimateVehicleSqft(...parts: (string | null | undefined)[]): number {
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  for (const key of Object.keys(VEHICLE_SQFT)) {
    if (hay.includes(key)) return VEHICLE_SQFT[key];
  }
  return 350; // sensible mid default when type is unknown
}
function buildPrintCartUrl(sqft: number, price: number): string {
  return `https://weprintwraps.com/cart/?add-to-cart=APPROVEPRO_PRINT&sqft=${Math.max(1, Math.round(sqft))}&price=${Math.max(1, Math.round(price))}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface SignRequest {
  token: string;
  typed_name: string;
  signature_png_base64: string;
  esign_consent: boolean;
  // Customer's post-approval intent from the 3-choice approve UI:
  //   "ready" — approved AND ready to order now (→ checkout)
  //   "later" — approved but ordering later (we email the cart link)
  order_intent?: "ready" | "later";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPublicProofBaseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

function stripDataUrl(b64: string): string {
  const m = b64.match(/^data:image\/[a-z]+;base64,(.+)$/);
  return m ? m[1] : b64;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // ── Parse + validate body ──
    let body: SignRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.typed_name || body.typed_name.trim().length < 2) {
      return jsonResponse({ error: "typed_name required (min 2 chars)" }, 400);
    }
    if (!body.signature_png_base64 || body.signature_png_base64.length < 200) {
      return jsonResponse(
        { error: "signature_png_base64 required (must contain drawn signature)" },
        400,
      );
    }
    if (body.esign_consent !== true) {
      return jsonResponse(
        { error: "esign_consent must be true — signer must acknowledge ESIGN disclosure" },
        400,
      );
    }

    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      req.headers.get("Idempotency-Key") ||
      "";
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return jsonResponse(
        { error: "Idempotency-Key header required (min 8 chars)" },
        400,
      );
    }

    // ── Verify token ──
    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-sign: token verify threw:", err);
      return jsonResponse(
        { error: "Server misconfiguration: PROOF_TOKEN_SECRET" },
        500,
      );
    }
    if (!verifiedUuid) {
      return jsonResponse({ error: "Invalid token" }, 404);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Load proof by view_token (service role, includes all fields) ──
    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("view_token", body.token)
      .single();

    if (fetchErr || !proof) {
      return jsonResponse({ error: "Proof not found" }, 404);
    }
    if (proof.status === "revoked" || proof.status === "expired") {
      return jsonResponse(
        { error: `Proof is ${proof.status}` },
        410,
      );
    }
    if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
      return jsonResponse({ error: "Proof has expired" }, 410);
    }

    // ── Idempotency check: was this exact key already processed? ──
    const { data: priorEvent } = await db
      .from("proof_events")
      .select("payload, created_at")
      .eq("proof_id", proof.id)
      .eq("event_type", "signed")
      .contains("payload", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle();

    if (priorEvent) {
      return jsonResponse({
        success: true,
        already_signed: true,
        signed_at: priorEvent.created_at,
        signed_pdf_sha256: (priorEvent.payload as any)?.signed_pdf_sha256 || null,
      });
    }

    // If proof is already in a terminal state (someone else signed, or declined),
    // refuse to overwrite.
    if (["approved", "declined"].includes(proof.status)) {
      return jsonResponse(
        { error: `Proof already ${proof.status}` },
        409,
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    // ── 1. Upload signature PNG ──
    const signatureBytes = base64ToBytes(stripDataUrl(body.signature_png_base64));
    const signatureSha = await sha256Hex(signatureBytes);
    const signaturePath = `${proof.id}/signature-${signatureSha}.png`;

    const { error: sigUploadErr } = await db.storage
      .from("proof-signatures")
      .upload(signaturePath, signatureBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (sigUploadErr) {
      console.error("proof-sign: signature upload failed:", sigUploadErr);
      return jsonResponse(
        { error: "Failed to store signature", detail: sigUploadErr.message },
        500,
      );
    }

    // ── Phase 8C: if this proof has line items, every line must be resolved
    //    before the customer can sign. This is what binds per-line outcomes
    //    into the final signed PDF.
    let pdfLineItems: Array<{
      line_number: number;
      title: string;
      description: string | null;
      render_url: string | null;
      status: "pending" | "approved" | "declined" | "revising";
      decline_reason: string | null;
      change_request: string | null;
      approved_at: string | null;
      declined_at: string | null;
      revision_requested_at: string | null;
    }> = [];

    if (proof.has_line_items) {
      const { data: lineRows, error: lineErr } = await db
        .from("proof_line_items")
        .select(
          "line_number, title, description, render_url, status, decline_reason, change_request, approved_at, declined_at, revision_requested_at",
        )
        .eq("proof_id", proof.id)
        .order("line_number", { ascending: true });
      if (lineErr) {
        console.error("proof-sign: line items fetch failed:", lineErr);
        return jsonResponse(
          { error: "Failed to load line items", detail: lineErr.message },
          500,
        );
      }
      const rows = lineRows || [];
      if (rows.length === 0) {
        return jsonResponse(
          { error: "This proof is flagged as multi-line but has no items" },
          500,
        );
      }
      const unresolved = rows.filter((r) =>
        r.status === "pending" || r.status === "revising"
      );
      if (unresolved.length > 0) {
        return jsonResponse(
          {
            error:
              `Resolve every line item before signing — ${unresolved.length} still open`,
            reason: "line_items_unresolved",
            unresolved: unresolved.map((r) => ({
              line_number: r.line_number,
              title: r.title,
              status: r.status,
            })),
          },
          409,
        );
      }
      pdfLineItems = rows as typeof pdfLineItems;
    }

    // ── 2. Load active version for the PDF ──
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("render_urls, uploaded_file_paths")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();

    const renderUrls: Record<string, string> = (activeVersion?.render_urls as any) || {};
    const uploadedPaths: string[] = (activeVersion?.uploaded_file_paths as any) || [];
    const heroImageUrl =
      renderUrls.side || renderUrls.hero || renderUrls.roof ||
      Object.values(renderUrls)[0] ||
      uploadedPaths[0] || null;
    const additionalViews = Object.entries(renderUrls)
      .filter(([k]) => !["side", "hero", "roof"].includes(k))
      .map(([, v]) => v as string)
      .slice(0, 4);

    // ── 3. Load shop info ──
    const { data: shopUser } = await db.auth.admin.getUserById(proof.shop_id);
    const shopEmail = shopUser?.user?.email || "";
    let shopName = shopUser?.user?.user_metadata?.shop_name || shopEmail.split("@")[0] || "Your Wrap Shop";
    let shopLogoUrl: string | null = null;
    let ccEmails: string[] = [];
    try {
      const { data: shopProfile } = await db
        .from("shop_profiles")
        .select("shop_name, logo_url, notification_emails")
        .eq("user_id", proof.shop_id)
        .maybeSingle();
      if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
      if (shopProfile?.logo_url) shopLogoUrl = shopProfile.logo_url;
      if (Array.isArray(shopProfile?.notification_emails)) {
        ccEmails = shopProfile!.notification_emails;
      }
    } catch {
      // non-fatal
    }

    // ── 4. Render HTML + generate PDF ──
    const signedAtIso = new Date().toISOString();
    const signatureDataUrl = `data:image/png;base64,${stripDataUrl(body.signature_png_base64)}`;

    const html = renderProofPdfHtml({
      proofId: proof.id,
      designName: proof.design_name || "Vehicle Wrap Design",
      vehicle: {
        year: proof.vehicle_year,
        make: proof.vehicle_make,
        model: proof.vehicle_model,
        type: proof.vehicle_type,
      },
      finishType: proof.finish_type,
      heroImageUrl,
      additionalViewUrls: additionalViews,
      lineItems: pdfLineItems,
      shop: {
        name: shopName,
        email: shopEmail,
        logoUrl: shopLogoUrl || proof.white_label_logo_url,
      },
      customer: {
        typedName: body.typed_name.trim(),
        email: proof.customer_email,
        name: proof.customer_name,
      },
      signatureDataUrl,
      signedAtIso,
      signerIp: ip,
      proofSha256Hint: signatureSha.slice(0, 16),
    });

    const pdfResult = await generatePdfFromHtml(html, {
      name: `proof-${proof.id}.pdf`,
      timeoutMs: 45_000,
    });

    let signedPdfPath: string | null = null;
    let signedPdfSha: string | null = null;

    if (pdfResult.ok && pdfResult.pdfBytes) {
      signedPdfSha = await sha256Hex(pdfResult.pdfBytes);
      signedPdfPath = `${proof.id}/${signedPdfSha}.pdf`;

      const { error: pdfUploadErr } = await db.storage
        .from("proof-audit")
        .upload(signedPdfPath, pdfResult.pdfBytes, {
          contentType: "application/pdf",
          upsert: false, // content-addressed — collision would mean identical PDF
        });

      // If content-addressed upload collides (duplicate replay), treat as success
      if (pdfUploadErr && !/duplicate|already exists/i.test(pdfUploadErr.message || "")) {
        console.error("proof-sign: PDF upload failed:", pdfUploadErr);
        return jsonResponse(
          { error: "Failed to store signed PDF", detail: pdfUploadErr.message },
          500,
        );
      }
    } else {
      console.warn(
        "proof-sign: PDF generation skipped —",
        pdfResult.reason,
        pdfResult.error,
      );
    }

    // Customer's order intent from the 3-choice approve UI (ready | later).
    const orderIntent: "ready" | "later" | null =
      body.order_intent === "ready" ? "ready" : body.order_intent === "later" ? "later" : null;

    // ── 5. Update proof: flip to approved, stamp audit fields ──
    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({
        status: "approved",
        signed_at: signedAtIso,
        signer_ip: ip,
        signer_user_agent: userAgent,
        signer_typed_name: body.typed_name.trim(),
        signature_storage_path: signaturePath,
        signed_pdf_storage_path: signedPdfPath,
        signed_pdf_sha256: signedPdfSha,
        metadata: orderIntent ? { ...((proof.metadata as any) || {}), order_intent: orderIntent } : (proof.metadata as any),
      })
      .eq("id", proof.id)
      .not("status", "in", "(approved,declined,revoked,expired)");

    if (updateErr) {
      console.error("proof-sign: status update failed:", updateErr);
      return jsonResponse(
        { error: "Failed to finalize approval", detail: updateErr.message },
        500,
      );
    }

    // ── 6. Audit log ──
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "signed",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        typed_name: body.typed_name.trim(),
        signature_sha256: signatureSha,
        signed_pdf_sha256: signedPdfSha,
        pdf_generated: pdfResult.ok,
        pdf_skip_reason: pdfResult.ok ? null : pdfResult.reason,
        order_intent: orderIntent,
      },
    });

    // ── 6b. Cancel any pending MightyMail ApprovePro chase emails. ──
    // The customer just approved — we don't need to keep nagging them.
    // Already-sent rows are untouched. Non-fatal on failure.
    try {
      await fetch(`${supabaseUrl}/functions/v1/mightymail-cancel-series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({
          sourceRef: `approvepro:${proof.id}`,
          reason: "proof approved",
        }),
      });
    } catch (e) {
      console.error("proof-sign: mightymail-cancel-series failed (non-fatal):", e);
    }

    // ── 6c. Auto-attach the approved render to WrapBox (non-fatal). ──
    // Resolves proof.metadata.{wpw,woo,}_order_number against panelizer_jobs /
    // design_pack_purchases / wpw_orders, copies the active version's render
    // into the pack, and appends an element with kind="design_panel". Skips
    // silently if the proof has no order linkage. Fires synchronously but
    // wrapped in try/catch so a failure NEVER blocks the customer's approval.
    try {
      await fetch(`${supabaseUrl}/functions/v1/proof-attach-to-wrapbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({ proof_id: proof.id }),
      });
    } catch (e) {
      console.error("proof-sign: wrapbox attach kickoff failed (non-fatal):", e);
    }

    // ── 6d. Auto-build print files — ONLY when the customer has PAID for the
    // production pack. The payment webhook (Woo/Stripe) must set
    // metadata.production_pack_paid = true on this proof; without it the
    // approval changes nothing and the design team builds via the dedicated
    // Build Print Files buttons (Production Files hub, ApprovePro manager,
    // Revision Studio). panel-artboard-generator step:"production" runs the
    // full doc chain server-side and replies 202 instantly; wrapped so a
    // failure NEVER blocks the customer's approval.
    try {
      const mdAuto = (proof.metadata as any) || {};
      const productionPackPaid = mdAuto.production_pack_paid === true || mdAuto.print_files_paid === true;
      if (productionPackPaid) {
        let prodViews: Record<string, string> = {};
        let prodFinish = proof.finish_type || "gloss";
        let prodDesign = "";
        if (proof.source_visualization_id) {
          const { data: viz } = await db
            .from("color_visualizations")
            .select("render_urls, finish_type, custom_design_url, admin_notes")
            .eq("id", proof.source_visualization_id)
            .maybeSingle();
          if (viz?.render_urls && typeof viz.render_urls === "object") prodViews = viz.render_urls as Record<string, string>;
          if (viz?.finish_type) prodFinish = viz.finish_type;
          try {
            const n = typeof viz?.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz?.admin_notes || {});
            prodDesign = n.layer_background_url || viz?.custom_design_url || "";
          } catch { prodDesign = viz?.custom_design_url || ""; }
        }
        if (Object.keys(prodViews).length || prodDesign) {
          await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
            },
            body: JSON.stringify({
              step: "production",
              proofId: proof.id,
              views: prodViews,
              designUrl: prodDesign,
              vehicleMake: proof.vehicle_make, vehicleModel: proof.vehicle_model,
              vehicleYear: String(proof.vehicle_year || ""),
              bodyType: proof.vehicle_type || "truck", finish: prodFinish,
              userId: proof.shop_id || null,
              orderLabel: `Order ${mdAuto.wpw_order_number || proof.design_name || proof.id.slice(0, 8)} — APPROVED (production pack paid)`,
            }),
          });
        }
      }
    } catch (e) {
      console.error("proof-sign: auto print-files kickoff failed (non-fatal):", e);
    }

    // ── 7. Signed URL for the PDF (valid 30 days for shop email link) ──
    let signedPdfUrl: string | null = null;
    if (signedPdfPath) {
      const { data: signed } = await db.storage
        .from("proof-audit")
        .createSignedUrl(signedPdfPath, 60 * 60 * 24 * 30);
      signedPdfUrl = signed?.signedUrl || null;
    }

    // ── 8. Look up panelizer_job for the approved-email production card.
    //    proof.metadata.wpw_order_number → panelizer_jobs.order_number.
    //    Sum w*h / 144 across `panels` jsonb for total sq ft. All non-fatal.
    let totalSqft: number | null = null;
    let panelCount: number | null = null;
    let orderNumber: string | null = null;
    try {
      const wpwOrderNumber = (proof.metadata as any)?.wpw_order_number || null;
      if (wpwOrderNumber) {
        const { data: job } = await db
          .from("panelizer_jobs")
          .select("order_number, panels")
          .eq("order_number", wpwOrderNumber)
          .maybeSingle();
        if (job) {
          orderNumber = job.order_number;
          const panels = Array.isArray(job.panels) ? job.panels : [];
          panelCount = panels.length;
          let sumIn2 = 0;
          for (const p of panels) {
            const w = Number((p as any)?.widthInches) || 0;
            const h = Number((p as any)?.heightInches) || 0;
            if (w > 0 && h > 0) sumIn2 += w * h;
          }
          if (sumIn2 > 0) totalSqft = sumIn2 / 144;
        }
      }
    } catch (lookupErr) {
      console.warn("proof-sign: panelizer_job lookup failed (non-fatal):", lookupErr);
    }

    // ── 8b. Cart-on-approve: build the WePrintWraps printed-wrap cart link and
    //    email it to the customer immediately, so they can buy the moment they
    //    approve instead of waiting on a hand-calculated quote. Only for WPW
    //    orders (the cart URL is WPW-specific). Real panelizer sq ft when we
    //    have it; otherwise a vehicle-based estimate. All non-fatal.
    const md = (proof.metadata as any) || {};
    const isWpwOrder = md.auto_ingested === "wpw" || md.wpw_woo_order_id != null || md.wpw_order_number != null;
    let cartUrl: string | null = null;
    let cartSqft: number | null = null;
    let cartPrice: number | null = null;
    let cartSqftIsEstimate = true;
    if (isWpwOrder) {
      if (totalSqft != null && totalSqft > 0) {
        cartSqft = Math.ceil(totalSqft);
        cartSqftIsEstimate = false;
      } else {
        cartSqft = estimateVehicleSqft(
          proof.vehicle_type, proof.vehicle_make, proof.vehicle_model,
        );
        cartSqftIsEstimate = true;
      }
      cartPrice = cartSqft * PRINT_PRICE_PER_SQFT;
      cartUrl = buildPrintCartUrl(cartSqft, cartPrice);

      if (proof.customer_email) {
        try {
          const orderEmail = await notifyCustomerReadyToOrder({
            customerEmail: proof.customer_email,
            customerName: proof.customer_name,
            shopName,
            designName: proof.design_name || "Vehicle Wrap Design",
            vehicleSummary: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" "),
            heroImageUrl,
            cartUrl,
            sqft: cartSqft,
            estimatedPrice: cartPrice,
            sqftIsEstimate: cartSqftIsEstimate,
            viewUrl: `${getPublicProofBaseUrl()}/approve/${proof.view_token}`,
          });
          await recordProofEmail(db, {
            proofId: proof.id,
            direction: "to_customer",
            kind: "ready_to_order",
            to: proof.customer_email,
            result: orderEmail,
            actorRole: "system",
            ip,
            userAgent,
          });
        } catch (e) {
          console.warn("proof-sign: ready-to-order email failed (non-fatal):", e);
        }
      }
    }

    // ── 9. Notify shop + record the email in ApprovePro's ledger ──
    if (shopEmail) {
      const baseUrl = getPublicProofBaseUrl();
      const emailResult = await notifyShopOfOutcome({
        shopEmail,
        shopName,
        customerName: proof.customer_name,
        customerEmail: proof.customer_email,
        designName: proof.design_name || "Vehicle Wrap Design",
        vehicleSummary:
          [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
            .filter(Boolean)
            .join(" "),
        outcome: "approved",
        signedPdfUrl,
        signedAtIso,
        proofId: proof.id,
        workbenchUrl: `${baseUrl}/approvepro?id=${proof.id}`,
        viewUrl: `${baseUrl}/approve/${proof.view_token}`,
        totalSqft,
        panelCount,
        orderNumber,
        ccEmails,
      });
      if (!emailResult.ok) {
        console.warn(
          "proof-sign: shop notification failed (non-fatal):",
          emailResult.reason,
          emailResult.error,
        );
      }
      await recordProofEmail(db, {
        proofId: proof.id,
        direction: "to_shop",
        kind: "outcome_approved",
        to: shopEmail,
        result: emailResult,
        actorRole: "system",
        ip,
        userAgent,
      });
    }

    return jsonResponse({
      success: true,
      status: "approved",
      signed_at: signedAtIso,
      signed_pdf_sha256: signedPdfSha,
      signed_pdf_url: signedPdfUrl,
      pdf_generated: pdfResult.ok,
      pdf_skip_reason: pdfResult.ok ? null : pdfResult.reason,
      cart_url: cartUrl,
      cart_sqft: cartSqft,
      cart_price: cartPrice,
      cart_sqft_is_estimate: cartSqftIsEstimate,
    });
  } catch (err: any) {
    console.error("proof-sign: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
