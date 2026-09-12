/**
 * cut-contour-build — DETERMINISTIC (no AI) print-ready cut-contour file builder.
 *
 * FILE-PREP mode ({ file_url, options }) is the GraphicsPro product path: the
 * flat artwork in, the WePrintWraps cut-contour kit out (silhouette cut line
 * in a real CutContour spot, 1/4" colour bleed, three layers, nested sheet,
 * PDF + SVG + ZIP). ORDER mode ({ proof_id }) is the historical ApprovePro
 * layout and stays gated behind isApproveProLive().
 *
 * Historical header, kept: "Design Setup / File Output" (SKU DSFO / product 289) orders.
 *
 * WHY: these orders are NOT creative design jobs. The customer already supplied
 * finished artwork (a print preview + the vector source) and is paying only for
 * production-ready cut-contour file output. A.C.E must never invent a wrap here
 * (see approvepro-autogen-design's cut-contour gate). This function takes the
 * customer's PROVIDED art and lays it out at TRUE scale on the vehicle's panels
 * with a magenta CutContour keyline + 0.5" bleed + registration marks, then
 * exports a single print/plotter-ready PDF. No Gemini, no re-painting.
 *
 * Output: a multi-page PDF (cover/legend + one true-scale page per wrap panel),
 * uploaded to the graphicspro-files bucket; the public URL is stamped on the proof
 * (metadata.cut_contour_pdf_url) and returned.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, cmyk } from "https://esm.sh/pdf-lib@1.17.1";
// @ts-expect-error esm.sh serves jszip with a default export at runtime; its .d.ts declares only the namespace.
import JSZip from "https://esm.sh/jszip@3.10.1";
import { produceCutContour, DEFAULT_BLEED_IN } from "../_shared/cut-contour/produce.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PT_PER_IN = 72;
const BLEED_IN = 0.5;
const PDF_MAX_PT = 14400; // pdf-lib / PDF spec hard limit = 200 inches per side.

interface Panel {
  label: string;
  w: number; // inches
  h: number; // inches
}

// Build the panel list from the vehicle dimension cache. Each panel becomes one
// true-scale page. Driver + passenger sides are the same size (mirrored art).
function panelsFromDims(d: Record<string, number> | undefined): Panel[] {
  const panels: Panel[] = [];
  if (!d) return panels;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
  if (n(d.sideW) && n(d.sideH)) {
    panels.push({ label: "Driver Side", w: d.sideW, h: d.sideH });
    panels.push({ label: "Passenger Side", w: d.sideW, h: d.sideH });
  }
  if (n(d.hoodW) && n(d.hoodL)) panels.push({ label: "Hood", w: d.hoodW, h: d.hoodL });
  if (n(d.roofW) && n(d.roofL)) panels.push({ label: "Roof", w: d.roofW, h: d.roofL });
  if (n(d.backW) && n(d.backH)) panels.push({ label: "Rear", w: d.backW, h: d.backH });
  return panels;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; kind: "jpg" | "png" } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 4) return null;
    // PNG magic 89 50 4E 47, JPEG magic FF D8.
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { bytes: buf, kind: "png" };
    if (buf[0] === 0xff && buf[1] === 0xd8) return { bytes: buf, kind: "jpg" };
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Two input modes:
  //   ORDER mode    — { proof_id }              (ApprovePro: lay out per vehicle panel)
  //   FILE-PREP mode— { file_url, options? }     (ProductionFlow "File Output": a single
  //                                               CutContour print-ready sheet from an upload)
  let body: { proof_id?: string; file_url?: string; file_name?: string; options?: any };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.proof_id && !body.file_url) {
    return jsonResponse({ error: "proof_id or file_url required" }, 400);
  }
  if (body.proof_id && !isApproveProLive()) {
    return approveProDisabledResponse();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── FILE-PREP MODE — the customer's flat artwork in, a print-ready cut
  // contour kit out, built the way WePrintWraps' own guide ("How to output
  // cut contour graphics") does it by hand in Illustrator:
  //   cut line  = unified outer silhouette of every element, 0.25 pt stroke,
  //               no fill, in a real `CutContour` Separation (CMYK 0/100/0/0)
  //   bleed     = the artwork's edge colour offset 1/4" past the cut line
  //   layers    = CutContour / Artwork / Bleed (+ one per film for Film Cut)
  //   nesting   = every graphic on one sheet within the 51.5" cut-contour width
  // Deterministic — no model, no secret. See _shared/cut-contour/.
  if (!body.proof_id && body.file_url) {
    try {
      const img = await fetchImageBytes(body.file_url);
      if (!img) return jsonResponse({ success: false, error: "Could not fetch/parse the uploaded file (need PNG or JPG)", file_url: body.file_url }, 422);

      const opt = body.options || {};
      const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
      const label = String(opt.label || body.file_name || "Cut contour graphics").replace(/\.[a-z0-9]+$/i, "");
      const result = await produceCutContour(img.bytes, {
        widthIn: num(opt.width_in),
        heightIn: num(opt.height_in),
        bleedIn: num(opt.bleed_in) ?? DEFAULT_BLEED_IN,
        substrate: opt.substrate === "cut" ? "cut" : "printed",
        maxFilms: num(opt.max_films) ? Math.round(num(opt.max_films)!) : undefined,
        label,
        // Window graphics mounted on the inside of the glass are cut in reverse.
        mirror: opt.mirror === true || opt.mirror === "true",
      });

      const ts = Date.now();
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "cut-contour";
      const scaleTag = `${result.mirrored ? "-reverse" : ""}${result.scale < 1 ? `-${Math.round(result.scale * 100)}pct` : ""}`;
      const base = `cut-contour/file-output/${ts}_${slug}`;
      const upload = async (path: string, bytes: Uint8Array, contentType: string) => {
        const { error: upErr } = await db.storage.from("graphicspro-files").upload(path, bytes, { contentType, upsert: true });
        if (upErr) throw new Error("Storage upload failed: " + upErr.message);
        return db.storage.from("graphicspro-files").getPublicUrl(path).data.publicUrl;
      };
      const pdfUrl = await upload(`${base}-cut-contour${scaleTag}.pdf`, result.pdf, "application/pdf");
      const svgBytes = new TextEncoder().encode(result.svg);
      const svgUrl = await upload(`${base}-cut-contour${scaleTag}.svg`, svgBytes, "image/svg+xml");

      const manifest = {
        label,
        spot: result.spot,
        layers: result.layers,
        bleed_in: result.bleedIn,
        scale: result.scale,
        mirrored: result.mirrored,
        surface: opt.surface || null,
        sheet: result.sheet,
        elements: result.elements,
        review_flags: result.reviewFlags,
        files: { pdf: `${slug}-cut-contour${scaleTag}.pdf`, svg: `${slug}-cut-contour${scaleTag}.svg` },
        how_to_order: `Order under Avery or 3M Cut Contour at weprintwraps.com and enter ${result.sheet.widthIn} x ${result.sheet.heightIn} in as the file size.`,
      };
      const zip = new JSZip();
      zip.file(manifest.files.pdf, result.pdf);
      zip.file(manifest.files.svg, svgBytes);
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      const zipUrl = await upload(`${base}-cut-contour-kit.zip`, zipBytes, "application/zip");

      return jsonResponse({
        success: true,
        output_url: pdfUrl,
        svg_url: svgUrl,
        preview_url: svgUrl,
        zip_url: zipUrl,
        output_format: `PDF — ${result.spot.name} spot (CMYK 0/100/0/0) ${result.spot.strokeWeightPt} pt stroke · layers ${result.layers.join(" / ")} · ${result.bleedIn}" bleed${result.mirrored ? " · reverse cut (interior mount)" : ""}${result.scale < 1 ? ` · ${Math.round(result.scale * 100)}% scale` : ""}`,
        description: `Print-ready cut-contour kit: ${result.elements.length} graphic(s) nested on a ${result.sheet.widthIn} x ${result.sheet.heightIn} in sheet, cut line on the unified silhouette, artwork colour bled ${result.bleedIn}" past it.`,
        sheet: result.sheet,
        scale: result.scale,
        elements: result.elements,
        element_count: result.elements.length,
        cut_paths: result.elements.reduce((n, e) => n + e.cutPaths, 0),
        total_vertices: result.totalVertices,
        review_flags: result.reviewFlags,
        layers: result.layers,
        spot: result.spot,
        bleed_in: result.bleedIn,
        mirrored: result.mirrored,
        vector: result.vector,
      });
    } catch (err: any) {
      console.error("cut-contour file-output:", err?.message || err);
      return jsonResponse({ success: false, error: (err?.message || "error").toString().slice(0, 300) }, 500);
    }
  }

  const { data: proof, error: fetchErr } = await db
    .from("proof_approvals")
    .select("*")
    .eq("id", body.proof_id)
    .single();
  if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

  const meta = (proof.metadata as any) || {};
  const uploads: string[] = Array.isArray(meta.customer_uploads) ? meta.customer_uploads : [];
  const documents: string[] = Array.isArray(meta.customer_documents) ? meta.customer_documents : [];
  const artUrl = uploads.find((u) => /\.(jpe?g|png)(\?|$)/i.test(u)) || uploads[0];
  if (!artUrl) {
    return jsonResponse({ error: "No customer-provided artwork to lay out (customer_uploads empty)" }, 422);
  }

  try {
    // 1) TRUE-SCALE DIMENSIONS — vehicle DB cache → Google-grounding fallback.
    let dims: Record<string, number> | undefined;
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
          dims = {
            sideW: v.side_w ?? v.sideW, sideH: v.side_h ?? v.sideH,
            hoodW: v.hood_w ?? v.hoodW, hoodL: v.hood_l ?? v.hoodL,
            roofW: v.roof_w ?? v.roofW, roofL: v.roof_l ?? v.roofL,
            backW: v.back_w ?? v.backW, backH: v.back_h ?? v.backH,
          };
        }
      } catch (e) {
        console.warn("cut-contour: vehicle-lookup (non-fatal):", (e as any)?.message || e);
      }
    }

    let panels = panelsFromDims(dims);
    let dimsKnown = panels.length > 0;
    // Fallback: no cached dims → a single conservative full-side sheet so the
    // shop still gets a true-scale cut template they can adjust from the vector.
    if (panels.length === 0) panels = [{ label: "Full Side (assumed)", w: 96, h: 48 }];

    // 2) PROVIDED ARTWORK — embed once, reuse on every panel page.
    const img = await fetchImageBytes(artUrl);
    if (!img) return jsonResponse({ error: "Could not fetch/parse customer artwork", artUrl }, 422);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const embedded = img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);

    const MAGENTA = cmyk(0, 1, 0, 0); // CutContour keyline (RIP maps by 100M / name)
    const BLACK = cmyk(0, 0, 0, 1);
    const GREY = cmyk(0, 0, 0, 0.55);

    const vehicleName = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ") || "Vehicle";
    const orderNo = meta.wpw_order_number || meta.wpw_woo_order_id || proof.id;

    // ── COVER / LEGEND PAGE (US Letter) ──────────────────────────────────────
    {
      const W = 8.5 * PT_PER_IN, H = 11 * PT_PER_IN;
      const p = pdf.addPage([W, H]);
      let y = H - 64;
      p.drawText("CUT-CONTOUR PRINT FILE", { x: 48, y, size: 22, font: fontBold, color: BLACK });
      y -= 26;
      p.drawText("Production-ready output - deterministic layout, no AI re-painting.", { x: 48, y, size: 11, font, color: GREY });
      y -= 40;
      const line = (label: string, val: string) => {
        p.drawText(label, { x: 48, y, size: 11, font: fontBold, color: BLACK });
        p.drawText(val, { x: 190, y, size: 11, font, color: BLACK });
        y -= 20;
      };
      line("Order #", String(orderNo));
      line("Customer", String(proof.customer_name || meta.customer_name || "-"));
      line("Vehicle", vehicleName);
      line("Panels", panels.map((pl) => pl.label).join(", "));
      line("Dimensions", dimsKnown ? "From vehicle template (true scale)" : "Assumed - verify against vector");
      line("Bleed", `${BLEED_IN} in all sides`);
      y -= 14;
      p.drawText("LEGEND", { x: 48, y, size: 12, font: fontBold, color: BLACK });
      y -= 22;
      p.drawLine({ start: { x: 48, y: y + 4 }, end: { x: 96, y: y + 4 }, thickness: 1.5, color: MAGENTA });
      p.drawText('Magenta keyline = CutContour (100% Magenta spot - cut/trim path)', { x: 108, y, size: 10, font, color: BLACK });
      y -= 18;
      p.drawText("Crosshairs at corners = registration marks.", { x: 108, y, size: 10, font, color: BLACK });
      y -= 18;
      p.drawText("Each following page = one panel at 1:1 true scale (artwork fills to bleed).", { x: 108, y, size: 10, font, color: BLACK });
      if (documents.length) {
        y -= 26;
        p.drawText("Customer vector source (finalize cut path from this):", { x: 48, y, size: 10, font: fontBold, color: BLACK });
        for (const d of documents.slice(0, 4)) {
          y -= 16;
          p.drawText("- " + d.slice(0, 92), { x: 60, y, size: 8.5, font, color: GREY });
        }
      }
      p.drawText("DesignProAI - Cut-Contour File Output", { x: 48, y: 36, size: 9, font, color: GREY });
    }

    // ── ONE TRUE-SCALE PAGE PER PANEL ────────────────────────────────────────
    const reg = (p: any, cx: number, cy: number) => {
      const r = 9;
      p.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: 0.75, color: BLACK });
      p.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, thickness: 0.75, color: BLACK });
    };

    for (const panel of panels) {
      // True scale in points, clamped to the PDF page-size limit (rare on cars).
      let trimW = panel.w * PT_PER_IN;
      let trimH = panel.h * PT_PER_IN;
      let pageW = trimW + 2 * BLEED_IN * PT_PER_IN;
      let pageH = trimH + 2 * BLEED_IN * PT_PER_IN;
      let scaled = false;
      if (pageW > PDF_MAX_PT || pageH > PDF_MAX_PT) {
        const k = Math.min(PDF_MAX_PT / pageW, PDF_MAX_PT / pageH);
        pageW *= k; pageH *= k; trimW *= k; trimH *= k; scaled = true;
      }
      const p = pdf.addPage([pageW, pageH]);
      const offX = (pageW - trimW) / 2;
      const offY = (pageH - trimH) / 2;

      // Artwork placed to FILL the panel trim box (best-effort cover; the vector
      // source is the master for final per-panel separation).
      p.drawImage(embedded, { x: offX, y: offY, width: trimW, height: trimH });

      // CutContour keyline = the trim/cut path (magenta).
      p.drawRectangle({ x: offX, y: offY, width: trimW, height: trimH, borderColor: MAGENTA, borderWidth: 1 });

      // Registration crosshairs at the four trim corners.
      reg(p, offX, offY); reg(p, offX + trimW, offY);
      reg(p, offX, offY + trimH); reg(p, offX + trimW, offY + trimH);

      // Small label block in the bleed margin (bottom-left, outside the cut).
      const tag = `${panel.label}  -  ${panel.w} x ${panel.h} in  -  ${vehicleName}  -  Order #${orderNo}${scaled ? "  (SCALED to fit; verify)" : ""}`;
      p.drawText(tag, { x: offX, y: Math.max(6, offY - 14), size: 8, font, color: GREY });
    }

    // 3) SAVE TO STORAGE + STAMP THE PROOF
    const pdfBytes = await pdf.save();
    const ts = Date.now();
    const path = `cut-contour/${proof.id}/${ts}_cutcontour.pdf`;
    const { error: upErr } = await db.storage.from("graphicspro-files").upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return jsonResponse({ error: "Storage upload failed: " + upErr.message }, 500);
    const { data: pub } = db.storage.from("graphicspro-files").getPublicUrl(path);
    const pdfUrl = pub.publicUrl;

    const fresh = (await db.from("proof_approvals").select("metadata").eq("id", proof.id).maybeSingle()).data?.metadata as any || meta;
    await db.from("proof_approvals").update({
      metadata: { ...fresh, cut_contour_pdf_url: pdfUrl, cut_contour_built_at: new Date().toISOString() },
    }).eq("id", proof.id);

    await db.from("proof_events").insert({
      proof_id: proof.id, event_type: "version_saved", actor_role: "system",
      payload: { source: "cut_contour_build", pdf_url: pdfUrl, panels: panels.length, dims_known: dimsKnown },
    });

    return jsonResponse({ ok: true, pdfUrl, panels: panels.length, dimsKnown });
  } catch (err: any) {
    console.error("cut-contour: unexpected", err?.message || err);
    return jsonResponse({ error: (err?.message || "error").toString().slice(0, 300) }, 500);
  }
});
