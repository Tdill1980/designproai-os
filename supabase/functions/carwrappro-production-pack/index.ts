/**
 * carwrappro-production-pack — CarWrapPro™ back half: flat design → PRINT PACK.
 *
 * Takes the flat-first outputs (designpro-flat-art layers + artboard) and the
 * 7-angle 3D view set (designpro-recreate-3d) and produces the deliverables:
 *
 *   1. PER-PANEL PRINT FILES — each panel sliced from the combined flat design
 *      at TRUE print size + 2" bleed all sides, 150 DPI geometry. Files are
 *      delivered at the largest edge-safe resolution and the exact scale vs
 *      full 150 DPI is recorded (standard large-format scale-file practice).
 *   2. 2D PRODUCTION PROOF — dimensioned multi-view sheet with the approval
 *      signature/date line (the "CarWrapPro™ — 2D Production Proof" sheet).
 *   3. ASSET REGISTRY — EVERY asset (layers, artboard, panels, 3D proofs,
 *      production proof) is recorded in carwrappro_runs / carwrappro_assets so
 *      the dedicated Design Assets admin production page shows the full pack.
 *
 * Self-contained (no _shared imports) — deploys standalone.
 * config.toml:  [functions.carwrappro-production-pack]  verify_jwt = false
 *
 * Request: {
 *   runId?, userId?, prompt?, mode?, vehicleYear, vehicleMake, vehicleModel,
 *   bodyType?, finish?, companyName?, phone?, website?, referenceImageUrl?,
 *   dimsSource?, combinedUrl (REQUIRED), backgroundUrl?, elementsUrl?,
 *   artboardUrl?, panels: [{label,widthInches,heightInches}] (REQUIRED),
 *   renderUrls?: { side, "passenger-side", hood_detail, front, rear, "close-up", roof }
 * }
 * Response: { success, runId, coverageSqFt, productionProofUrl, panelFiles, assets }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "wrap-files";
const PRINT_DPI = 150;       // full print resolution the panel geometry targets
const BLEED_IN = 2;          // 2" bleed all sides (WePrintWraps production spec)
const MAX_EDGE_PX = 2000;    // edge-worker-safe cap (legacy server path); scale_pct records the rest
const SIGNED_TTL = 60 * 60 * 24 * 365;
const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";

function sb() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

let _fontBytes: Uint8Array | null = null;
async function ensureFont(): Promise<Uint8Array> {
  if (!_fontBytes) { const r = await fetch(FONT_URL); _fontBytes = new Uint8Array(await r.arrayBuffer()); }
  return _fontBytes;
}

async function fetchImage(url: string): Promise<Image> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}: ${url.slice(0, 80)}`);
  return Image.decode(new Uint8Array(await res.arrayBuffer()));
}

function coverCrop(src: Image, tw: number, th: number): Image {
  const c = src.clone();
  const sr = c.width / c.height, tr = tw / th;
  let cw: number, ch: number, cx: number, cy: number;
  if (sr > tr) { ch = c.height; cw = Math.max(1, Math.round(ch * tr)); cx = Math.round((c.width - cw) / 2); cy = 0; }
  else { cw = c.width; ch = Math.max(1, Math.round(cw / tr)); cx = 0; cy = Math.round((c.height - ch) / 2); }
  c.crop(cx, cy, cw, ch);
  c.resize(tw, th);
  return c;
}

interface Panel { label: string; widthInches: number; heightInches: number; }
interface AssetRow {
  run_id: string; kind: string; label?: string; view_type?: string; panel_label?: string;
  width_inches?: number; height_inches?: number; bleed_inches?: number; dpi?: number;
  scale_pct?: number; storage_path?: string; url: string; sort_order?: number;
}

const VIEW_ORDER: { key: string; label: string; dimOf: string | null }[] = [
  { key: "side", label: "Driver Side", dimOf: "DRIVER SIDE" },
  { key: "passenger-side", label: "Passenger Side", dimOf: "PASSENGER SIDE" },
  { key: "front", label: "Front", dimOf: "FRONT" },
  { key: "rear", label: "Rear", dimOf: "REAR" },
  { key: "hood_detail", label: "Hood", dimOf: "HOOD" },
  { key: "roof", label: "Top/Roof", dimOf: "ROOF" },
  { key: "close-up", label: "Close-Up", dimOf: null },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const combinedUrl: string = (body.combinedUrl || "").trim();
    const panels: Panel[] = Array.isArray(body.panels) ? body.panels : [];
    const renderUrls: Record<string, string> = body.renderUrls || {};
    const vehicleYear = String(body.vehicleYear || "");
    const vehicleMake: string = (body.vehicleMake || "").trim();
    const vehicleModel: string = (body.vehicleModel || "").trim();
    const finish: string = body.finish || "Gloss";
    const mode: string = body.mode || "commercial";
    const prompt: string = body.prompt || "";
    const companyName: string = (body.companyName || "").trim();

    if (!combinedUrl) return json({ success: false, error: "combinedUrl is required" }, 400);
    if (!panels.length) return json({ success: false, error: "panels[] is required" }, 400);

    let userId: string = body.userId || "";
    if (!userId) {
      const ah = req.headers.get("Authorization");
      if (ah?.startsWith("Bearer ")) {
        try { const { data: { user } } = await sb().auth.getUser(ah.replace("Bearer ", "")); if (user) userId = user.id; } catch { /**/ }
      }
    }

    const vehicle = `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim();
    const coverageSqFt = Math.round(panels.reduce((s, p) => s + (p.widthInches * p.heightInches) / 144, 0));

    // ── REGISTER-ONLY: the browser already sliced the panels and composed the
    // 2D proof (edge workers 546 on heavy imagescript work — CPU/memory limit).
    // This branch does ZERO image processing: create the run, sign the client-
    // uploaded files, insert the asset registry rows, close the run. ──
    if (body.registerOnly) {
      const runId: string = body.runId || crypto.randomUUID();

      // Pay-to-play revision policy: 4 included revisions per design lineage,
      // a revision fee is due after that, and print files release on payment.
      const revisionOf: string = body.revisionOf || "";
      let revisionNumber = 0, includedRevisions = 4, paid = false;
      if (revisionOf) {
        const { data: parent } = await sb().from("carwrappro_runs")
          .select("revision_number, included_revisions, paid").eq("id", revisionOf).maybeSingle();
        if (parent) {
          revisionNumber = (parent.revision_number || 0) + 1;
          includedRevisions = parent.included_revisions ?? 4;
          paid = !!parent.paid;
        } else {
          revisionNumber = 1;
        }
      }
      const revisionFeeDue = revisionNumber > includedRevisions;

      const { error: runErr } = await sb().from("carwrappro_runs").upsert({
        id: runId, user_id: userId || null, status: "running", mode, prompt,
        reference_image_url: body.referenceImageUrl || null,
        vehicle_year: vehicleYear, vehicle_make: vehicleMake, vehicle_model: vehicleModel,
        body_type: body.bodyType || null, finish, company_name: companyName || null,
        phone: body.phone || null, website: body.website || null,
        dims_source: body.dimsSource || null, panels, coverage_sq_ft: coverageSqFt,
        revision_of: revisionOf || null, revision_number: revisionNumber,
        included_revisions: includedRevisions, paid,
      });
      if (runErr) return json({ success: false, error: `run upsert failed: ${runErr.message}` }, 500);

      const sign = async (path: string): Promise<string> => {
        const { data } = await sb().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
        if (!data?.signedUrl) throw new Error(`sign failed: ${path}`);
        return data.signedUrl;
      };

      const rows: AssetRow[] = [];
      let sort = 0;
      const rec = (a: Omit<AssetRow, "run_id">) => rows.push({ run_id: runId, sort_order: sort++, ...a });

      if (body.referenceImageUrl) rec({ kind: "reference", label: "Source reference image", url: body.referenceImageUrl });
      if (body.backgroundUrl) rec({ kind: "background", label: "Background layer", url: body.backgroundUrl });
      if (body.elementsUrl) rec({ kind: "elements", label: "Elements layer (transparent PNG)", url: body.elementsUrl });
      rec({ kind: "combined", label: "Combined flat design", url: combinedUrl });
      if (body.artboardUrl) rec({ kind: "artboard", label: "Flat-panel artboard (true dimensions)", url: body.artboardUrl });
      for (const v of VIEW_ORDER) {
        if (renderUrls[v.key]) rec({ kind: "proof_3d", label: `3D Proof — ${v.label}`, view_type: v.key, url: renderUrls[v.key] });
      }
      const clientPanels: any[] = Array.isArray(body.panelFiles) ? body.panelFiles : [];
      const outPanelFiles: any[] = [];
      for (const pf of clientPanels) {
        // AI-generated sides arrive as URLs; browser-sliced fallbacks as paths.
        const url = pf.path ? await sign(pf.path) : (pf.url || "");
        if (!url) continue;
        rec({
          kind: "panel_print",
          label: `${pf.panelLabel} — ${pf.widthInches}" × ${pf.heightInches}" (incl. ${pf.bleedInches}" bleed) @ ${pf.dpi} DPI`,
          panel_label: pf.panelLabel, width_inches: pf.widthInches, height_inches: pf.heightInches,
          bleed_inches: pf.bleedInches, dpi: pf.dpi, scale_pct: pf.scalePct, storage_path: pf.path || null, url,
        });
        outPanelFiles.push({ panel: pf.panelLabel, url, printWidthInches: pf.widthInches, printHeightInches: pf.heightInches, bleedInches: pf.bleedInches, dpi: pf.dpi, scalePct: pf.scalePct });
      }
      // Generic extra layer assets (structural layer, coordinate-locked
      // element crops, photo layers, ...) — recorded as-is.
      const extras: any[] = Array.isArray(body.extraAssets) ? body.extraAssets : [];
      for (const ex of extras) {
        if (ex?.url && ex?.kind) rec({ kind: String(ex.kind), label: ex.label || String(ex.kind), view_type: ex.viewType || undefined, url: ex.url });
      }

      let proofUrl = "";
      if (body.proofSheetPath) {
        proofUrl = await sign(body.proofSheetPath);
        rec({ kind: "production_proof_2d", label: "2D Production Proof (approval sheet)", storage_path: body.proofSheetPath, url: proofUrl });
      }

      const { error: insErr } = await sb().from("carwrappro_assets").insert(rows);
      if (insErr) return json({ success: false, error: `asset insert failed: ${insErr.message}` }, 500);
      await sb().from("carwrappro_runs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", runId);
      console.log(`[CARWRAPPRO] REGISTERED run ${runId} — ${rows.length} assets (${outPanelFiles.length} panels), rev ${revisionNumber}/${includedRevisions}${revisionFeeDue ? " FEE DUE" : ""}`);
      return json({
        success: true, runId, coverageSqFt, productionProofUrl: proofUrl, panelFiles: outPanelFiles,
        revisionNumber, includedRevisions, revisionFeeDue,
      });
    }

    // ── Run row (the grouping record the admin production page lists) ──
    let runId: string = body.runId || "";
    if (runId) {
      await sb().from("carwrappro_runs").update({ status: "running", coverage_sq_ft: coverageSqFt }).eq("id", runId);
    } else {
      const { data, error } = await sb().from("carwrappro_runs").insert({
        user_id: userId || null, status: "running", mode, prompt,
        reference_image_url: body.referenceImageUrl || null,
        vehicle_year: vehicleYear, vehicle_make: vehicleMake, vehicle_model: vehicleModel,
        body_type: body.bodyType || null, finish, company_name: companyName || null,
        phone: body.phone || null, website: body.website || null,
        dims_source: body.dimsSource || null, panels, coverage_sq_ft: coverageSqFt,
      }).select("id").single();
      if (error || !data) return json({ success: false, error: `run insert failed: ${error?.message}` }, 500);
      runId = data.id;
    }
    console.log(`[CARWRAPPRO] run ${runId} — ${vehicle}, ${panels.length} panels, ${coverageSqFt} sq ft`);

    const dir = `carwrappro/${runId}`;
    const up = async (name: string, bytes: Uint8Array): Promise<{ path: string; url: string }> => {
      const path = `${dir}/${name}`;
      const { error } = await sb().storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`upload ${name}: ${error.message}`);
      const { data } = await sb().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      return { path, url: data?.signedUrl || "" };
    };

    const assets: AssetRow[] = [];
    let sort = 0;
    const record = (a: Omit<AssetRow, "run_id">) => assets.push({ run_id: runId, sort_order: sort++, ...a });

    // ── Register the inputs (flat layers, artboard, reference, 3D views) ──
    if (body.referenceImageUrl) record({ kind: "reference", label: "Source reference image", url: body.referenceImageUrl });
    if (body.backgroundUrl) record({ kind: "background", label: "Background layer", url: body.backgroundUrl });
    if (body.elementsUrl) record({ kind: "elements", label: "Elements layer (transparent PNG)", url: body.elementsUrl });
    record({ kind: "combined", label: "Combined flat design", url: combinedUrl });
    if (body.artboardUrl) record({ kind: "artboard", label: "Flat-panel artboard (true dimensions)", url: body.artboardUrl });
    for (const v of VIEW_ORDER) {
      if (renderUrls[v.key]) record({ kind: "proof_3d", label: `3D Proof — ${v.label}`, view_type: v.key, url: renderUrls[v.key] });
    }

    // ── 1. PER-PANEL PRINT FILES @ true size + 2" bleed, 150 DPI geometry ──
    const combined = await fetchImage(combinedUrl);
    const panelFiles: { panel: string; url: string; printWidthInches: number; printHeightInches: number; bleedInches: number; dpi: number; scalePct: number }[] = [];
    for (const p of panels) {
      const inW = p.widthInches + BLEED_IN * 2;
      const inH = p.heightInches + BLEED_IN * 2;
      const fullW = inW * PRINT_DPI, fullH = inH * PRINT_DPI;
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(fullW, fullH));
      const pxW = Math.max(1, Math.round(fullW * scale));
      const pxH = Math.max(1, Math.round(fullH * scale));
      const slice = coverCrop(combined, pxW, pxH);
      const fname = `panels/${p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      const u = await up(fname, await slice.encode());
      const scalePct = Math.round(scale * 1000) / 10;
      record({
        kind: "panel_print", label: `${p.label} — ${inW}" × ${inH}" (incl. ${BLEED_IN}" bleed) @ ${PRINT_DPI} DPI`,
        panel_label: p.label, width_inches: inW, height_inches: inH, bleed_inches: BLEED_IN,
        dpi: PRINT_DPI, scale_pct: scalePct, storage_path: u.path, url: u.url,
      });
      panelFiles.push({ panel: p.label, url: u.url, printWidthInches: inW, printHeightInches: inH, bleedInches: BLEED_IN, dpi: PRINT_DPI, scalePct });
      console.log(`[CARWRAPPRO] panel ${p.label} ${pxW}x${pxH}px (${scalePct}% of full ${PRINT_DPI} DPI)`);
    }

    // ── 2. The 2D PRODUCTION PROOF sheet (dimensioned views + signature line) ──
    const font = await ensureFont();
    const W = 2400, H = 1700;
    const sheet = new Image(W, H);
    sheet.fill(0xffffffff);
    const text = async (t: string, size: number, color: number, x: number, y: number, center = false) => {
      try { const im = await Image.renderText(font, size, t, color); sheet.composite(im, center ? Math.round((W - im.width) / 2) : x, y); } catch { /* font miss */ }
    };

    const designName = companyName || (prompt ? `"${prompt.slice(0, 40)}${prompt.length > 40 ? "…" : ""}"` : "Custom Wrap");
    await text("CarWrapPro(TM) - 2D Production Proof", 44, 0x111111ff, 0, 28, true);
    await text(`VEHICLE: ${vehicle}  |  DESIGN: ${designName}  |  FINISH: ${finish}  |  COVERAGE: ${coverageSqFt} SQ FT`, 22, 0x555555ff, 0, 90, true);

    const dimOf = (label: string | null): string => {
      if (!label) return "";
      const p = panels.find((x) => x.label === label);
      return p ? `  -  ${p.widthInches}" W x ${p.heightInches}" H` : "";
    };
    const cols = [60, 840, 1620], tileW = 700, tileH = 394, rows = [170, 650, 1130];
    let tile = 0;
    for (const v of VIEW_ORDER) {
      const url = renderUrls[v.key];
      if (!url) continue;
      const x = cols[tile % 3], y = rows[Math.floor(tile / 3)];
      try {
        const img = await fetchImage(url);
        const border = new Image(tileW + 4, tileH + 4); border.fill(0xddddddff);
        sheet.composite(border, x - 2, y - 2);
        sheet.composite(coverCrop(img, tileW, tileH), x, y);
        await text(`${v.label.toUpperCase()}${dimOf(v.dimOf)}`, 22, 0x111111ff, x, y + tileH + 10);
        tile++;
      } catch (e: any) { console.warn(`[CARWRAPPRO] proof tile ${v.key} skipped: ${e?.message}`); }
    }
    // No 3D views yet? Fall back to the flat panels so the proof still ships.
    if (tile === 0) {
      for (const p of panels.slice(0, 6)) {
        const x = cols[tile % 3], y = rows[Math.floor(tile / 3)];
        sheet.composite(coverCrop(combined, tileW, tileH), x, y);
        await text(`${p.label}  -  ${p.widthInches}" W x ${p.heightInches}" H`, 22, 0x111111ff, x, y + tileH + 10);
        tile++;
      }
    }

    const lineY = 1640;
    const line = new Image(W - 120, 2); line.fill(0xccccccff);
    try { sheet.composite(line, 60, lineY - 16); } catch { /* cosmetic */ }
    await text("APPROVED BY: ____________________    SIGNATURE: ____________________    DATE: ______________    |    WePrintWraps.com", 24, 0x111111ff, 60, lineY);

    const proofUp = await up("2d-production-proof.png", await sheet.encode());
    record({ kind: "production_proof_2d", label: "2D Production Proof (approval sheet)", storage_path: proofUp.path, url: proofUp.url });

    // ── 3. Persist the asset registry + close the run ──
    const { error: insErr } = await sb().from("carwrappro_assets").insert(assets);
    if (insErr) console.error(`[CARWRAPPRO] asset insert failed: ${insErr.message}`);
    await sb().from("carwrappro_runs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", runId);

    console.log(`[CARWRAPPRO] DONE run ${runId} — ${assets.length} assets (${panelFiles.length} print panels, ${tile} proof tiles)`);
    return json({
      success: true, runId, coverageSqFt,
      productionProofUrl: proofUp.url,
      panelFiles,
      assets: assets.map((a) => ({ kind: a.kind, label: a.label, viewType: a.view_type, panel: a.panel_label, url: a.url })),
    });
  } catch (err: any) {
    console.error("[CARWRAPPRO] error:", err?.message || err);
    return json({ success: false, error: err?.message || "carwrappro-production-pack failed" }, 500);
  }
});
