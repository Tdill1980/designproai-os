// qc-generate-flat-artboard
//
// THE MIDDLE LAYER: 2D proof → MASTER ARTBOARD → (sliceable) flat panels.
//
// REWRITTEN to the proven gold-standard pattern (the one that built the clean
// Summit / F150-flag / Forged Fitness / Practical Magic artboards):
//
//   1. PER-SIDE flatten — call panel-artboard-generator step:"proofpanel" (GEMINI,
//      gemini-3-pro-image-preview) ONCE per panel. Each call de-warps ONLY that
//      side's last-Gemini render off the curved body into a clean flat texture
//      (the prompt forbids baking labels/dimensions/barcodes/vehicle parts).
//   2. DETERMINISTIC compose — composite those clean textures onto the master
//      artboard with ImageScript at exact zone rectangles. NO generative AI in
//      the layout, so nothing warps and no template text is ever baked in.
//
// This replaces the old single-shot Gemini grid call that drifted, warped lines,
// and stamped "TOP PANEL x=0%" coordinate labels + barcodes onto the artwork.
//
// Output contract is UNCHANGED ({ success, url, path, width, height, panels })
// so every caller (Order Production Pack auto-flow + the manual QC "Build Panel
// Files" button) gets the clean path with zero caller changes. The returned
// `panels` are exact pixel rectangles for the deterministic slicer
// (api/process-production-pack.js → buildPanelPlan crops {left,top,width,height}).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ── GENIE grid: driver top, passenger mid, other panels bottom row ──
function buildZones(panels: any[]) {
  const sides = panels.filter((p) => /side|driver|passenger/i.test(p.id || p.label || ""));
  const bottom = panels.filter((p) => !sides.includes(p));
  const driver = sides.find((p) => /driver/i.test(p.id || p.label || "")) || sides[0];
  const passenger = sides.find((p) => /passenger/i.test(p.id || p.label || ""));
  const sideH = driver?.heightInches || 55;
  const maxBottomH = bottom.length ? Math.max(...bottom.map((p) => p.heightInches || 38)) : 0;
  const hasBottom = bottom.length > 0;
  const sideHPct = hasBottom ? 35 : 50;
  const bottomHPct = hasBottom ? 30 : 0;
  const zones: any[] = [];
  if (driver) zones.push({ key: driver.id || "driver-side", label: (driver.label || "Driver Side"), widthInches: driver.widthInches, heightInches: driver.heightInches, leftPct: 0, topPct: 0, widthPct: 100, heightPct: sideHPct, mirror: false });
  if (passenger) zones.push({ key: passenger.id || "passenger-side", label: (passenger.label || "Passenger Side"), widthInches: passenger.widthInches, heightInches: passenger.heightInches, leftPct: 0, topPct: sideHPct, widthPct: 100, heightPct: sideHPct, mirror: false });
  const totalBottom = bottom.reduce((s, p) => s + (p.widthInches || 1), 0) || 1;
  let x = 0;
  for (const b of bottom) {
    const wPct = Math.round(((b.widthInches || 1) / totalBottom) * 1000) / 10;
    zones.push({ key: b.id || b.label, label: (b.label || b.id), widthInches: b.widthInches, heightInches: b.heightInches, leftPct: Math.round(x * 10) / 10, topPct: sideHPct * 2, widthPct: wPct, heightPct: bottomHPct, mirror: false });
    x += wPct;
  }
  return { zones, totalWidthInches: driver?.widthInches || 200, totalHeightInches: sideH * 2 + maxBottomH };
}

// Horizontal mirror (passenger = driver flipped). Manual left↔right swap per row
// — the proven panelizer-step-fill technique (ImageScript 1.2.15 has no flip()).
async function flipHorizontalBytes(imageBytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(imageBytes);
  const w = img.width, h = img.height;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= Math.floor(w / 2); x++) {
      const left = img.getPixelAt(x, y);
      const right = img.getPixelAt(w - x + 1, y);
      img.setPixelAt(x, y, right);
      img.setPixelAt(w - x + 1, y, left);
    }
  }
  return new Uint8Array(await img.encode());
}

// Normalise a zone key/label → a flat-panel-openai side key.
function sideKeyForZone(z: any): string {
  const hay = `${z.key || ""} ${z.label || ""}`.toLowerCase();
  if (/front.?bumper/.test(hay)) return "front_bumper";
  if (/rear.?bumper/.test(hay)) return "rear_bumper";
  if (/driver/.test(hay)) return "driver_side";
  if (/passenger/.test(hay)) return "passenger_side";
  if (/hood/.test(hay)) return "hood";
  if (/roof|top/.test(hay)) return "roof";
  if (/rear|trunk|tailgate|back/.test(hay)) return "rear";
  if (/front/.test(hay)) return "front";
  return "driver_side";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const SUPA = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPA, serviceKey);

    const jobId = body.job_id || body.jobId;
    if (!jobId) return json({ error: "job_id required" }, 400);

    const { data: job } = await sb.from("panelizer_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "job not found" }, 404);

    const cj = (job as any).concept_json || {};
    // Explicit body.panels are AUTHORITATIVE (installer tape-measured dims).
    // The vehicle-DB re-validate below must never overwrite them — that clobber
    // replaced RJ's measured 190x51 sides with DB bucket guesses.
    const explicitPanels = Array.isArray(body.panels) && body.panels.length > 0;
    let panels = explicitPanels ? body.panels
      : (Array.isArray((job as any).panels) ? (job as any).panels : []);
    if (!panels.length) return json({ error: "no GENIE panels on job (sizes) — cannot lay out artboard" }, 400);

    const proofUrl = body.proofUrl || cj.flat_proof_url;
    if (!proofUrl) return json({ error: "no 2D proof on job (concept_json.flat_proof_url) — create the 2D proof first" }, 400);

    const finish = body.finish || cj.finish || "Gloss";

    // ── Correct stale/generic panel boxes to the REAL per-vehicle sizes ──────
    // The GENIE Universal Panelizer sizes boxes from the vehicle DB
    // (panelizer-step-validate). Job panels can carry generic/template dims
    // (e.g. Cadillac 227x76.4 leaking onto an F150 that is really 237.2x55.6),
    // which makes the side container too narrow/tall so the wide design gets
    // condensed. Re-validate against the SAME source GENIE uses and override
    // each panel's box by role, then persist so cards + slicer + artboard match.
    // SKIPPED for explicit body.panels — the caller's tape-measured dims win.
    try {
      if (explicitPanels) throw new Error("explicit panels supplied — skipping vehicle-DB dim override");
      const hay = (panels as any[]).map((p) => `${p.panelKey || p.id || ""} ${p.label || ""}`.toLowerCase()).join(" | ");
      const has = (re: RegExp) => re.test(hay);
      const roleOf = (s: string) => {
        const t = (s || "").toLowerCase();
        if (/driver|passenger|side/.test(t)) return "side";
        if (/roof|top/.test(t)) return "roof";
        if (/hood/.test(t)) return "hood";
        if (/front.?bumper/.test(t)) return "front-bumper";
        if (/rear.?bumper/.test(t)) return "rear-bumper";
        if (/rear|tailgate|trunk|back/.test(t)) return "rear";
        if (/front/.test(t)) return "front-bumper";
        return t;
      };
      const vr = await fetch(`${SUPA}/functions/v1/panelizer-step-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          vehicleMake: (job as any).vehicle_make,
          vehicleModel: (job as any).vehicle_model,
          vehicleYear: (job as any).vehicle_year,
          sideSize: cj.sideSize || "medium",
          addHood: has(/hood/),
          addRoof: has(/roof|top/),
          roofSize: (cj.roofSize && cj.roofSize !== "none") ? cj.roofSize : (has(/roof|top/) ? "medium" : "none"),
          addFrontBumper: has(/front/),
          addRearBumper: has(/rear.?bumper/),
          addRear: has(/rear|tailgate|trunk|back/) && !has(/rear.?bumper/),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const vj = await vr.json().catch(() => ({}));
      if (vr.ok && Array.isArray(vj.panels) && vj.panels.length) {
        const byRole: Record<string, { w: number; h: number }> = {};
        for (const vp of vj.panels) {
          const r = roleOf(vp.panelKey || vp.label || "");
          const w = Number(vp.widthInches), h = Number(vp.heightInches);
          if (!byRole[r] && w > 0 && h > 0) byRole[r] = { w, h };
        }
        let changed = false;
        panels = (panels as any[]).map((p) => {
          const d = byRole[roleOf(`${p.panelKey || p.id || ""} ${p.label || ""}`)];
          if (d && (Number(p.widthInches) !== d.w || Number(p.heightInches) !== d.h)) {
            changed = true;
            return { ...p, widthInches: d.w, heightInches: d.h };
          }
          return p;
        });
        if (changed) {
          console.log(`[qc-flat-artboard] corrected panel boxes to vehicle-DB sizes for ${jobId}`);
          try { await sb.from("panelizer_jobs").update({ panels }).eq("id", jobId); } catch (_e) { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.warn("[qc-flat-artboard] dim re-validate skipped:", String((e as Error)?.message || e));
    }

    const grid = buildZones(panels);

    // ── Master canvas resolution (deterministic, memory-safe ≤ ~16 MP) ──
    const totalWin = grid.totalWidthInches || 200;
    const totalHin = grid.totalHeightInches || 120;
    let ppi = Math.max(6, Math.min(20, Math.floor(4200 / Math.max(1, totalWin))));
    let masterW = Math.max(2, Math.round(totalWin * ppi));
    let masterH = Math.max(2, Math.round(totalHin * ppi));
    const mp = (masterW * masterH) / 1_000_000;
    if (mp > 16) { const s = Math.sqrt(16 / mp); masterW = Math.round(masterW * s); masterH = Math.round(masterH * s); }

    // Pixel rect for each zone in the master.
    const rects = grid.zones.map((z) => ({
      z,
      left: Math.round((z.leftPct / 100) * masterW),
      top: Math.round((z.topPct / 100) * masterH),
      width: Math.max(1, Math.round((z.widthPct / 100) * masterW)),
      height: Math.max(1, Math.round((z.heightPct / 100) * masterH)),
    }));

    // ── STEP 1: GEMINI flatten each side via panel-artboard-generator (proofpanel) ──
    // Per-zone SOURCE: that side's own last-Gemini render (all_view_urls) — NOT
    // the multi-view proof sheet. Each side is de-warped off the curved body into
    // a flat 1:1 texture by Gemini (gemini-3-pro-image-preview), so the paid print
    // pack is Gemini end to end. The single-view render is the clean source the
    // flattener wants; the 2D proof stays the per-side fallback when a view is
    // missing.
    const viewMap: Record<string, string> = (() => {
      const av = (job as any).all_view_urls;
      const out: Record<string, string> = {};
      if (av && typeof av === "object" && !Array.isArray(av)) {
        for (const [k, v] of Object.entries(av)) {
          const url = typeof v === "string" ? v : String((v as any)?.url || "");
          if (url) out[k.toLowerCase()] = url;
        }
      }
      return out;
    })();
    const srcForSide = (side: string): string => {
      const pick = (...keys: string[]) => keys.map((k) => viewMap[k]).find(Boolean);
      if (side === "passenger_side") return pick("passenger-side", "passenger") || pick("side", "driver-side") || proofUrl;
      if (side === "driver_side") return pick("side", "driver-side", "driver") || proofUrl;
      if (side === "hood") return pick("hood", "hood_detail") || proofUrl;
      if (side === "roof") return pick("roof", "top") || proofUrl;
      if (side === "front" || side === "front_bumper") return pick("front", "hero") || proofUrl;
      if (side === "rear" || side === "rear_bumper") return pick("rear", "back") || proofUrl;
      return proofUrl;
    };
    const flattened = await Promise.all(rects.map(async (r) => {
      const side = sideKeyForZone(r.z);
      // Passenger side is NEVER AI-generated — it is the driver panel mirrored.
      // Generating it independently is what produced the contaminated "blob".
      // Mark it here; we fill its bytes from the flipped driver after this pass.
      if (side === "passenger_side") return { r, bytes: null as Uint8Array | null, error: null, derive: "driver" as const };
      try {
        // GEMINI de-warp — panel-artboard-generator step:"proofpanel". Flattens
        // THIS side's own last-Gemini render off the curved body into a flat
        // texture, 1:1 with the approved design. Replaces the old
        // flat-panel-openai (OpenAI gpt-image-1) flatten so the paid print pack is
        // built by Gemini end to end (model-lock compliant: gemini-3-pro-image-preview).
        // bleedInches ~0 → the master stays native + edge-to-edge; the
        // deterministic slicer adds the real 2" print bleed downstream.
        const fr = await fetch(`${SUPA}/functions/v1/panel-artboard-generator`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            step: "proofpanel",
            jobId,
            proofUrl: srcForSide(side),       // that side's own last-Gemini render (the picked design)
            side: side.replace(/_/g, " "),    // human side word for the flatten prompt + save slug
            panelWidthIn: r.z.widthInches,
            panelHeightIn: r.z.heightInches,
            bleedInches: 0.01,                // ~0: master is edge-to-edge; slicer adds the 2" bleed
            finish,
            maxCanvas: 1600,                  // SMALL on purpose: STEP 2 resizes each side DOWN into
                                              // its zone and the slicer rescales to print res later.
                                              // Bigger here OOMs the 7-panel ImageScript compose (546).
          }),
          signal: AbortSignal.timeout(175_000),
        });
        const j = await fr.json().catch(() => ({}));
        const url = j?.url || j?.scaledUrl;
        if (!j?.success || !url) return { r, bytes: null as Uint8Array | null, error: j?.error || `proofpanel ${fr.status}` };
        const ir = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!ir.ok) return { r, bytes: null, error: `fetch panel ${ir.status}` };
        return { r, bytes: new Uint8Array(await ir.arrayBuffer()), error: null };
      } catch (e: any) {
        return { r, bytes: null, error: String(e?.message || e) };
      }
    }));

    // ── Passenger = driver, horizontally flipped (deterministic, no AI) ──
    // Driver/passenger zones are the same size, so the flipped driver texture
    // drops straight into the passenger zone — a guaranteed match, and it removes
    // the contaminated AI passenger output.
    const driverFlat = flattened.find((f) => sideKeyForZone(f.r.z) === "driver_side" && f.bytes);
    for (const f of flattened) {
      if ((f as any).derive === "driver") {
        if (driverFlat?.bytes) {
          try { f.bytes = await flipHorizontalBytes(driverFlat.bytes); f.error = null; }
          catch (e: any) { f.error = "passenger mirror failed: " + String(e?.message || e); }
        } else {
          f.error = "passenger needs driver, but driver flatten failed";
        }
      }
    }

    const okCount = flattened.filter((f) => f.bytes).length;
    if (okCount === 0) {
      return json({ error: `all per-side flattens failed: ${flattened.map((f) => f.error).filter(Boolean).join("; ").slice(0, 300)}` });
    }

    // ── STEP 2: deterministic compose onto a white master (ImageScript, no AI) ──
    const master = new Image(masterW, masterH);
    master.fill(Image.rgbaToColor(255, 255, 255, 255));
    const failedZones: string[] = [];
    for (const f of flattened) {
      if (!f.bytes) { failedZones.push(String(f.r.z.key)); continue; }
      try {
        const pim = await Image.decode(f.bytes);
        pim.resize(f.r.width, f.r.height); // fill the zone; slicer rescales to true inches
        master.composite(pim, f.r.left, f.r.top);
      } catch (e) {
        failedZones.push(String(f.r.z.key));
        console.error(`[qc-flat-artboard] compose failed for ${f.r.z.key}:`, String(e));
      }
    }

    const bytes = await master.encode();
    const path = `artboards/${jobId}/artboard.png`;
    const { error: upErr } = await sb.storage.from("wrap-files").upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) return json({ error: "upload: " + upErr.message });
    const { data: { publicUrl } } = sb.storage.from("wrap-files").getPublicUrl(path);

    // Slice rects = the zone pixel rects we just composited (true inches carried).
    // mirrored:false — each side was generated in its correct orientation, so the
    // slicer must NOT re-flip it.
    const slicePanels = rects.map((r) => ({
      id: r.z.key,
      label: r.z.label,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      widthInches: r.z.widthInches,
      heightInches: r.z.heightInches,
      mirrored: false,
    }));

    await sb.from("panelizer_jobs").update({
      concept_json: {
        ...cj,
        artboard_source: "r5_proofpanel_gemini",
        artboard_stale: false,
        artboard_regenerated_at: new Date().toISOString(),
        artboard_width_px: masterW,
        artboard_height_px: masterH,
        artboard_zones: grid.zones,
        artboard_slice_panels: slicePanels,
        // PERSIST the master artboard image URL so the deterministic slicer can
        // FIND the flat master. Without this the artboard was uploaded, returned
        // in the HTTP response, then dropped — leaving artboard_clean_url null and
        // forcing every downstream caller to fall back to AI per-side extraction.
        // The slice map above is meaningless unless the image it indexes is locatable.
        artboard_clean_url: publicUrl,
        artboard_url: publicUrl,
        artboard_path: path,
      },
    }).eq("id", jobId);

    return json({
      success: true,
      url: publicUrl,
      path,
      width: masterW,
      height: masterH,
      panels: slicePanels,
      panelsFlattened: okCount,
      panelsFailed: failedZones,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
