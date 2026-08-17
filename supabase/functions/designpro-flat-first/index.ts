/**
 * designpro-flat-first — flat-first generation + Human Validation Gate orchestrator.
 *
 * actions:
 *   "generate" (default): emit the PRISTINE FLAT CANVAS, then AUTO-CHAIN up to the
 *       gate — Stage 2 deterministic 1:1 map (generate-clean-artboard) + Stage 3
 *       QC proof (panel-artboard-generator qcproof) — and land a print_qc_jobs row
 *       at qc_status='awaiting_qc'. NO Topaz upscale here (saves credits).
 *   "approve": fire Stage 4 Topaz upscale (High Fidelity V2) on the approved file,
 *       set qc_status='approved' + production_url.
 *   "reject": set qc_status='rejected' (+ notes).
 *
 * Does NOT touch the locked golden render pipeline.
 *
 * Body (generate): { prompt, vehicleYear?, vehicleMake?, vehicleModel?, finish?,
 *   visionBoardImages?, jobId?, generationId?, side?, widthInches?, heightInches?, targetDpi? }
 * Body (approve):  { action:"approve", qcJobId, model?, targetDpi? }
 * Body (reject):   { action:"reject", qcJobId, notes? }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "gemini-3-pro-image-preview";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const pool: string[] = [];
let loaded = false, idx = 0;
function apiKey(): string {
  if (!loaded) {
    const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) pool.push(p);
    for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) pool.push(k); }
    loaded = true;
  }
  if (!pool.length) throw new Error("No GOOGLE_AI_API_KEY");
  return pool[idx++ % pool.length];
}
function toB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(i + 8192, b.length))));
  return btoa(s);
}
function db() { return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); }
// Internal edge→edge call (functions are verify_jwt=false; service role bearer keeps the gateway happy).
async function callFn(name: string, payload: unknown, timeoutMs = 150_000): Promise<any> {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return await r.json().catch(() => ({}));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const action = String(body.action || "generate");

    // ── APPROVE: fire Stage 4 Topaz upscale, mark approved ───────────────────
    if (action === "approve") {
      const qcJobId = String(body.qcJobId || "").trim();
      if (!qcJobId) return json({ success: false, error: "qcJobId required" }, 400);
      const sb = db();
      const { data: row } = await sb.from("print_qc_jobs").select("*").eq("id", qcJobId).maybeSingle();
      if (!row) return json({ success: false, error: "QC job not found" }, 404);
      const src = row.print_url || row.flat_url;
      if (!src) return json({ success: false, error: "QC job has no print file to upscale" }, 400);
      const model = String(body.model || "High Fidelity V2");
      const dpi = Number(body.targetDpi) > 0 ? Number(body.targetDpi) : (row.target_dpi || 150);
      const up = await callFn("panel-artboard-generator", {
        step: "upscale", sourceUrl: src, widthInches: row.width_inches, heightInches: row.height_inches,
        targetDpi: dpi, model, side: row.side, jobId: row.generation_id,
      });
      if (!up?.success || !up?.url) {
        await sb.from("print_qc_jobs").update({ updated_at: new Date().toISOString() }).eq("id", qcJobId);
        return json({ success: false, error: up?.error || "upscale failed" }, 502);
      }
      await sb.from("print_qc_jobs").update({
        qc_status: "approved", production_url: up.url, model, target_dpi: dpi,
        reviewer: body.reviewer || null, updated_at: new Date().toISOString(),
      }).eq("id", qcJobId);
      return json({ success: true, qcJobId, qc_status: "approved", productionUrl: up.url, model, method: up.method });
    }

    // ── REJECT ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      const qcJobId = String(body.qcJobId || "").trim();
      if (!qcJobId) return json({ success: false, error: "qcJobId required" }, 400);
      await db().from("print_qc_jobs").update({ qc_status: "rejected", notes: body.notes || null, updated_at: new Date().toISOString() }).eq("id", qcJobId);
      return json({ success: true, qcJobId, qc_status: "rejected" });
    }

    // ── GENERATE: flat-first + auto pre-QC chain ─────────────────────────────
    const { prompt, vehicleYear, vehicleMake, vehicleModel, finish, visionBoardImages, jobId, generationId, side } = body;
    if (!prompt || !String(prompt).trim()) return json({ success: false, error: "Missing prompt" }, 400);
    const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || "vehicle";

    const designPrompt = `Design a FLAT 2D vehicle-wrap artwork SHEET for a ${vehicle}: "${String(prompt).trim()}".
This is the PRISTINE FLAT SOURCE artwork — a single continuous rectangle of design that fills the ENTIRE canvas edge-to-edge, every element terminating sharply at the four borders, with NO white margins or panel boxes.
Parallel (orthographic) projection only — perfectly flat and uniformly lit, as if printed on flat vinyl.${finish ? ` Finish: ${finish}.` : ""}
DO NOT render any vehicle, car/truck body, wheels, windows, doors, mirrors, bumpers, perspective, 3D angle, body curvature, shading, gloss, reflections, drop shadows, environment, or background — ONLY the flat wrap artwork itself.`;

    const parts: any[] = [{ text: designPrompt }];
    const refs = Array.isArray(visionBoardImages) ? visionBoardImages.filter((u) => typeof u === "string" && u).slice(0, 3) : [];
    if (refs.length) {
      parts.push({ text: "STYLE REFERENCE — follow this design's look, colors and composition:" });
      for (const u of refs) {
        try {
          const r = await fetch(u, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(20000) });
          if (r.ok) parts.push({ inlineData: { mimeType: r.headers.get("content-type") || "image/png", data: toB64(await r.arrayBuffer()) } });
        } catch { /* optional */ }
      }
    }

    let imageB64 = "", imageMime = "image/png", lastErr = "";
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey()}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } } }), signal: AbortSignal.timeout(120000) },
        );
        if (!resp.ok) { lastErr = `Gemini ${resp.status}`; if (attempt < 4) await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
        const result = await resp.json();
        const rParts = result.candidates?.[0]?.content?.parts;
        const reason = result.candidates?.[0]?.finishReason;
        if (rParts) for (const p of rParts) { if (p.inlineData) { imageB64 = p.inlineData.data; imageMime = p.inlineData.mimeType || "image/png"; break; } }
        if (imageB64) break;
        lastErr = reason === "NO_IMAGE" ? "NO_IMAGE" : `No image (${reason})`;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * attempt));
      } catch (e) { lastErr = String(e); if (attempt < 4) await new Promise((r) => setTimeout(r, 2000 * attempt)); }
    }
    if (!imageB64) return json({ success: false, error: lastErr || "Failed" }, 200);

    const bin = atob(imageB64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const ext = imageMime.includes("jpeg") ? "jpg" : imageMime.includes("webp") ? "webp" : "png";

    const sb = db();
    const id = jobId || generationId || crypto.randomUUID();
    const path = `flat-first/${id}/flat_artboard_${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("wrap-files").upload(path, data, { contentType: imageMime, upsert: true });
    if (upErr) return json({ success: false, error: `Upload failed: ${upErr.message}` }, 200);
    const flatArtboardUrl = sb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
    if (generationId || jobId) { try { await sb.from("designiq_generations").update({ master_artboard_url: flatArtboardUrl }).eq("id", generationId || jobId); } catch { /* may be cv id */ } }

    // ── AUTO PRE-QC CHAIN (no Topaz): map → trace → qcproof → awaiting_qc ─────
    const wIn = Number(body.widthInches) > 0 ? Number(body.widthInches) : undefined;
    const hIn = Number(body.heightInches) > 0 ? Number(body.heightInches) : undefined;
    const dpi = Number(body.targetDpi) > 0 ? Number(body.targetDpi) : 150;
    let printUrl: string | null = null, traceUrl: string | null = null, qcproofUrl: string | null = null, chainErr: string | null = null;
    try {
      // Stage 2 — deterministic 1:1 map (no AI).
      const mapped = await callFn("generate-clean-artboard", { sourceUrl: flatArtboardUrl, widthInches: wIn, heightInches: hIn, dpi, jobID: id });
      printUrl = mapped?.url || null;
      // Stage 3 — alignment trace of the flat sheet, then ghost it over the print file.
      const tr = await callFn("panel-artboard-generator", { step: "linetrace", sourceUrl: flatArtboardUrl, side: side || "PANEL", jobId: id, color: "black" });
      traceUrl = tr?.url || null;
      if (printUrl && traceUrl) {
        const qc = await callFn("panel-artboard-generator", { step: "qcproof", flatUrl: printUrl, traceUrl, side: side || "PANEL", jobId: id });
        qcproofUrl = qc?.url || null;
      }
    } catch (e: any) { chainErr = e?.message || "pre-QC chain error"; }

    const { data: qcRow } = await sb.from("print_qc_jobs").insert({
      generation_id: String(id), side: side || null, qc_status: "awaiting_qc",
      flat_url: flatArtboardUrl, print_url: printUrl, trace_url: traceUrl, qcproof_url: qcproofUrl,
      width_inches: wIn ?? null, height_inches: hIn ?? null, target_dpi: dpi,
    }).select("id").maybeSingle();

    return json({
      success: true, flatArtboardUrl, printUrl, traceUrl, qcproofUrl,
      qcJobId: qcRow?.id || null, qc_status: "awaiting_qc", chainError: chainErr,
    });
  } catch (err) {
    console.error("[designpro-flat-first] Error:", err);
    return json({ success: false, error: String(err) }, 200);
  }
});
