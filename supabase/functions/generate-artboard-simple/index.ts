/**
 * generate-artboard-simple — Single-call flat artboard generator
 *
 * Takes a 3D proof render → produces ONE artboard PNG with each panel
 * as a flat orthographic rectangle (Representative Paneling layout).
 *
 * Always validates dimensions against vehicle database.
 * Auto-splits panels taller than 59" into Side 1 + Side 2 (60" roll - 1" trim).
 * Incorporates edited panels from concept_json.edited_panels on Accept.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOTE: resolveVehicleSpecs used to live in ../_shared/vehicle-specs-lookup.ts
// but the Supabase MCP deploy pipeline can't resolve _shared imports, and the
// panelizer-step-validate fetch above already handles DB-driven roof dims for
// known vehicles. If the roof is still missing after that, we fall back to a
// side-panel-derived estimate (see the roof-guarantee block below), which is
// robust enough for unknown vehicles (boats, trailers, customs).

// Inlined gemini-key-pool for MCP deploy compatibility
const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _loadKeys(): void {
  if (_loaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _pool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _pool.push(k);
  }
  _loaded = true;
}
function getGeminiKey(): string {
  _loadKeys();
  if (_pool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const key = _pool[_idx % _pool.length];
  _idx++;
  return key;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "wrap-files";
const GEMINI_MODEL = "gemini-3-pro-image-preview";
const BLEED = 0.5; // 0.5" each side = 1" total added per dimension
const MAX_TILE_INCHES = 59; // Max vinyl roll height (60" roll - 1" trim) — panels taller than this get split
const OVERLAP_INCHES = 1.0; // Overlap between upper and lower split panels

interface PanelDim {
  label: string;
  panelKey: string;
  widthInches: number;
  heightInches: number;
  widthWithBleed?: number;
  heightWithBleed?: number;
  mirrored?: boolean;
}

/** Base64-encode a Uint8Array without spread operator */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Rewrite a Supabase public object URL to a render-transform URL capped at
 * maxDim (contain). Reference views don't need 4K — fetching full-size 4K
 * renders and base64-encoding them in worker memory is what tripped
 * WORKER_RESOURCE_LIMIT (546) on multi-view jobs.
 */
function shrinkUrl(url: string, maxDim = 1600): string {
  const m = url.match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/(public|sign)\/([^?]+)(\?.*)?$/);
  if (!m) return url;
  const [, host, vis, path, qs] = m;
  if (vis !== "public") return url; // signed URLs can't be rewritten safely
  return `${host}/storage/v1/render/image/public/${path}?width=${maxDim}&height=${maxDim}&resize=contain`;
}

/** Fetch a single image URL → { base64, mime } or null */
async function fetchImage(url: string, maxBytes = 4_194_304): Promise<{ base64: string; mime: string } | null> {
  try {
    // Try the shrunk transform first; fall back to the original URL
    // (transforms 400 on >25MB sources and non-image objects).
    let resp = await fetch(shrinkUrl(url));
    if (!resp.ok && shrinkUrl(url) !== url) resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.log(`[ARTBOARD] Skipping image >${maxBytes} bytes: ${buf.byteLength} bytes`);
      return null;
    }
    const bytes = new Uint8Array(buf);
    return {
      base64: uint8ToBase64(bytes),
      mime: resp.headers.get("content-type") || "image/jpeg",
    };
  } catch (e) {
    console.log(`[ARTBOARD] Failed to fetch image: ${e.message}`);
    return null;
  }
}

/** Auto-split panels taller than MAX_TILE_INCHES into upper + lower */
function autoSplitPanels(panels: PanelDim[]): PanelDim[] {
  const result: PanelDim[] = [];
  for (const p of panels) {
    const isSide = /side|driver|passenger/i.test(p.label) || /side|driver|passenger/i.test(p.panelKey);
    if (isSide && p.heightInches > MAX_TILE_INCHES) {
      const upperH = MAX_TILE_INCHES;
      const lowerH = Math.round((p.heightInches - MAX_TILE_INCHES + OVERLAP_INCHES) * 10) / 10;
      console.log(`[ARTBOARD] Splitting "${p.label}" (${p.heightInches}") → upper ${upperH}" + lower ${lowerH}"`);
      result.push({
        ...p,
        label: `${p.label} - Panel 1 (Upper)`,
        panelKey: `${p.panelKey}-panel1`,
        heightInches: upperH,
      });
      result.push({
        ...p,
        label: `${p.label} - Panel 2 (Lower)`,
        panelKey: `${p.panelKey}-panel2`,
        heightInches: lowerH,
      });
    } else {
      // Clamp non-side panels to max 59.5" height too
      const clampedH = Math.min(p.heightInches, 59.5);
      result.push({ ...p, heightInches: clampedH });
    }
  }
  return result;
}

/** Build numbered panel list for prompt — each panel uses its own dimensions + bleed */
function buildPanelList(panels: PanelDim[]): string {
  return panels.map((p, i) => {
    const w = p.widthWithBleed ?? +(p.widthInches + BLEED * 2).toFixed(1);
    const h = p.heightWithBleed ?? +(p.heightInches + BLEED * 2).toFixed(1);
    const mirror = p.mirrored ? " (MIRRORED)" : "";
    return `${i + 1}. ${p.label.toUpperCase()}: ${w}" x ${h}"${mirror}`;
  }).join("\n");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { job_id, vehicle_name, design_prompt, approved_render_url } = body;
    const allRenderUrls: Record<string, string> | undefined = body.allRenderUrls;
    const panels: PanelDim[] | undefined = body.panels;
    const existingArtboardUrl: string | undefined = body.existing_artboard_url;

    if (!job_id || !vehicle_name || !design_prompt || !approved_render_url) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: job_id, vehicle_name, design_prompt, approved_render_url" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[ARTBOARD] Starting: ${job_id} - ${vehicle_name}`);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 0. Load job record (need concept_json for edited panels + vehicle info) ──
    const { data: jobRow } = await sb
      .from("panelizer_jobs")
      .select("panels, vehicle_make, vehicle_model, vehicle_year, concept_json")
      .eq("id", job_id)
      .single();

    // ── 1. Resolve panel dimensions — ALWAYS prefer real vehicle DB dims ──
    let resolvedPanels: PanelDim[] | undefined = undefined;

    // First try: panels from request body (frontend may have correct dims)
    if (panels && panels.length > 0) {
      // Check if these look like real dims (not generic 172x59.5 defaults)
      const hasRealDims = panels.some(p => p.widthInches !== 172 && p.widthInches !== 173);
      if (hasRealDims) {
        resolvedPanels = panels.map((p: any) => ({
          label: p.label || p.panelKey || "Panel",
          panelKey: p.panelKey || p.id || p.label || "panel",
          widthInches: p.widthInches,
          heightInches: p.heightInches,
          mirrored: p.mirrored || false,
        }));
        console.log(`[ARTBOARD] Using ${resolvedPanels.length} panels from request (real dims)`);
      } else {
        console.log(`[ARTBOARD] Request panels look like generic defaults — will try vehicle DB`);
      }
    }

    // Second try: panels from job record
    if (!resolvedPanels && jobRow?.panels && Array.isArray(jobRow.panels) && jobRow.panels.length > 0) {
      const dbPanels = jobRow.panels as any[];
      const hasRealDims = dbPanels.some((p: any) => p.widthInches && p.widthInches !== 172 && p.widthInches !== 173);
      if (hasRealDims) {
        resolvedPanels = dbPanels.map((p: any) => ({
          label: p.label || p.panelKey || "Panel",
          panelKey: p.panelKey || p.id || p.label || "panel",
          widthInches: p.widthInches || 172,
          heightInches: p.heightInches || 59.5,
          mirrored: p.mirrored || false,
        }));
        console.log(`[ARTBOARD] Using ${resolvedPanels.length} panels from job record (real dims)`);
      } else {
        console.log(`[ARTBOARD] Job record panels look like generic defaults — will try vehicle DB`);
      }
    }

    // Third try: call panelizer-step-validate for real vehicle DB dimensions
    if (!resolvedPanels) {
      console.log(`[ARTBOARD] Looking up real dimensions from vehicle database`);
      const validateUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/panelizer-step-validate`;
      const vMake = jobRow?.vehicle_make || vehicle_name.split(" ").slice(1, -1).join(" ") || "";
      const vModel = jobRow?.vehicle_model || vehicle_name.split(" ").pop() || "";
      try {
        const valResp = await fetch(validateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            vehicleMake: vMake,
            vehicleModel: vModel,
            vehicleYear: jobRow?.vehicle_year || null,
            sideSize: "medium",
            addHood: true,
            addRear: true,
            addFrontBumper: true,
            addRearBumper: true,
            addRoof: true,
          }),
        });
        if (valResp.ok) {
          const valData = await valResp.json();
          if (valData.panels && valData.panels.length > 0) {
            resolvedPanels = valData.panels;
            console.log(`[ARTBOARD] Got ${resolvedPanels!.length} panels from vehicle DB (${vMake} ${vModel})`);
          }
        }
      } catch (valErr) {
        console.warn(`[ARTBOARD] Vehicle DB lookup failed: ${valErr.message}`);
      }
    }

    // Last resort: use request panels even if generic
    if (!resolvedPanels && panels && panels.length > 0) {
      resolvedPanels = panels.map((p: any) => ({
        label: p.label || p.panelKey || "Panel",
        panelKey: p.panelKey || p.id || p.label || "panel",
        widthInches: p.widthInches || 172,
        heightInches: p.heightInches || 59.5,
        mirrored: p.mirrored || false,
      }));
      console.warn(`[ARTBOARD] Using generic panel dims as last resort`);
    }

    if (!resolvedPanels || resolvedPanels.length === 0) {
      throw new Error("No panel dimensions available — cannot generate artboard");
    }

    // Guarantee roof panel exists — if missing, derive roof dims from the
    // largest side panel so the artboard ALWAYS ships with a roof. Silently
    // skipping the roof (the previous behavior) caused roofless artboards to
    // reach QC. Typical roofs are ~62% of side length × ~90% of side height,
    // which is accurate enough for unknown vehicles (boats, trailers, customs)
    // and good enough for known vehicles whose panel list upstream happened to
    // omit the roof.
    const hasRoof = resolvedPanels.some((p: any) => /roof/i.test(p.label || p.panelKey || ""));
    if (!hasRoof) {
      const sidePanel = resolvedPanels.find((p: any) =>
        /side|driver|passenger/i.test(p.label || p.panelKey || "")
      );
      if (sidePanel) {
        const roofL = Math.round(sidePanel.widthInches * 0.62);
        const roofW = Math.round(sidePanel.heightInches * 0.90);
        // Roof is mounted length-along-vehicle, so panel width = roof length (long axis)
        resolvedPanels.push({ label: "Roof", panelKey: "roof", widthInches: roofL, heightInches: roofW, mirrored: false });
        console.log(`[ARTBOARD] Added missing roof panel (derived from side): ${roofL}" x ${roofW}"`);
      } else {
        console.warn(`[ARTBOARD] Roof panel could not be derived — no side panel to scale from`);
      }
    }

    // Auto-split tall panels (height > 59") into Side 1 + Side 2
    resolvedPanels = autoSplitPanels(resolvedPanels);

    // ── 2. Fetch reference images ──
    // BUG FIX: Previously only ONE view was fetched (prioritizing "side"), which caused
    // Gemini to fabricate front/rear bumper artwork from the side-panel design. Now we
    // attach EVERY available render view with explicit per-view labels so Gemini can
    // pull the right source artwork for each panel type (front view → front bumper/hood,
    // rear view → rear/rear bumper, side view → side panels, roof view → roof).
    const VIEW_PRIORITY = ["side", "driver-side", "passenger-side", "front", "rear", "hood_detail", "roof", "top", "close-up"];

    // Human-readable description of which panels each view should source.
    const VIEW_PANEL_HINTS: Record<string, string> = {
      "side":            "use this for Driver Side and Passenger Side panels",
      "driver-side":     "use this for the Driver Side panel",
      "passenger-side":  "use this for the Passenger Side panel (mirrored)",
      "front":           "use this for the Hood and Front Bumper panels",
      "hood_detail":     "use this for the Hood panel",
      "rear":            "use this for the Rear (trunk/tailgate) and Rear Bumper panels",
      "roof":            "use this for the Roof panel",
      "top":             "use this for the Roof panel",
      "close-up":        "use this as a detail reference only",
    };

    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    const attachedViewKeys: string[] = [];

    // EDIT-IN-PLACE: If existing artboard URL is provided, use it as PRIMARY reference.
    // This is used by Fix Rectangles / Fix Mirroring to preserve the design.
    // In edit mode we SKIP attaching render views so Gemini preserves the existing
    // artboard artwork rather than re-sourcing from the 3D renders.
    const editMode = !!existingArtboardUrl;
    if (editMode) {
      console.log(`[ARTBOARD] EDIT MODE: Using existing artboard as primary reference`);
      const existingImg = await fetchImage(existingArtboardUrl, 10_485_760);
      if (existingImg) {
        imageParts.push({ text: `EXISTING ARTBOARD — THIS IS THE CURRENT DESIGN. Keep all artwork exactly as shown. Only apply the requested fix:` });
        imageParts.push({ inlineData: { mimeType: existingImg.mime, data: existingImg.base64 } });
        console.log(`[ARTBOARD] Existing artboard attached as primary reference`);
      }
    }

    let hasRoofRender = false;
    if (!editMode && allRenderUrls && Object.keys(allRenderUrls).length > 0) {
      // Attach ALL available render views so Gemini can pick the right source per panel.
      // Cap total attached image bytes so we don't blow past Gemini's request size limit.
      const TOTAL_IMAGE_BUDGET = 12_000_000; // ~12 MB total across all views (shrunk transforms keep each view small)
      let bytesUsed = 0;
      const sorted = Object.entries(allRenderUrls).sort(([a], [b]) => {
        const ai = VIEW_PRIORITY.indexOf(a);
        const bi = VIEW_PRIORITY.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      for (const [viewKey, url] of sorted) {
        if (!url) continue;
        if (bytesUsed >= TOTAL_IMAGE_BUDGET) {
          console.log(`[ARTBOARD] Skipping ${viewKey} — total image budget reached (${bytesUsed} bytes)`);
          continue;
        }
        console.log(`[ARTBOARD] Fetching ${viewKey}...`);
        const img = await fetchImage(url);
        if (!img) continue;
        const approxBytes = Math.floor(img.base64.length * 0.75); // base64 is ~4/3 of raw
        bytesUsed += approxBytes;
        const hint = VIEW_PANEL_HINTS[viewKey] || "reference view";
        imageParts.push({ text: `3D RENDER — ${viewKey.toUpperCase()} VIEW of ${vehicle_name} (${hint}):` });
        imageParts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
        attachedViewKeys.push(viewKey);
        if (viewKey === "roof" || viewKey === "top") hasRoofRender = true;
      }
      console.log(`[ARTBOARD] Attached ${attachedViewKeys.length} views: ${attachedViewKeys.join(", ")} (~${Math.round(bytesUsed / 1024)} KB)`);
    }

    if (!editMode && attachedViewKeys.length === 0) {
      console.log(`[ARTBOARD] No view URLs worked — falling back to approved_render_url`);
      const img = await fetchImage(approved_render_url);
      if (!img) throw new Error("Failed to fetch render image");
      imageParts.push({ text: `3D RENDER of ${vehicle_name}:` });
      imageParts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
    }

    if (!editMode && !hasRoofRender) {
      console.log(`[ARTBOARD] No roof render available — roof will use plain base color`);
    }

    // ── 3. Check for edited panels in concept_json and include as reference ──
    const conceptJson = (jobRow?.concept_json || {}) as Record<string, any>;
    const editedPanels = conceptJson.edited_panels as Record<string, { storage_path?: string; instruction?: string }> | undefined;

    if (editedPanels && Object.keys(editedPanels).length > 0) {
      console.log(`[ARTBOARD] Found ${Object.keys(editedPanels).length} edited panels — fetching as reference`);
      for (const [panelKey, editInfo] of Object.entries(editedPanels)) {
        if (!editInfo?.storage_path) continue;
        try {
          const { data: signedData } = await sb.storage.from(BUCKET).createSignedUrl(editInfo.storage_path, 300);
          if (signedData?.signedUrl) {
            const editImg = await fetchImage(signedData.signedUrl, 10_485_760);
            if (editImg) {
              imageParts.push({ text: `APPROVED EDITED PANEL — ${panelKey.toUpperCase()} — USE THIS EXACT DESIGN for this panel:` });
              imageParts.push({ inlineData: { mimeType: editImg.mime, data: editImg.base64 } });
              console.log(`[ARTBOARD] Included edited panel: ${panelKey}`);
            }
          }
        } catch (e) {
          console.warn(`[ARTBOARD] Failed to fetch edited panel ${panelKey}: ${e.message}`);
        }
      }
    }

    // ── 4. Build prompt ──
    const panelListText = buildPanelList(resolvedPanels);
    console.log(`[ARTBOARD] Panel list:\n${panelListText}`);

    const hasEdits = editedPanels && Object.keys(editedPanels).length > 0;
    const editInstruction = hasEdits
      ? "\n\nIMPORTANT: I have included approved edited panel images above. For each edited panel, reproduce that EXACT design in the artboard — do not regenerate it from scratch."
      : "";

    const roofInstruction = !hasRoofRender
      ? "\n\nROOF PANEL: No roof render is available. For the roof panel, use ONLY the base color or background pattern from the side panels — strip all graphics, logos, text, and complex design elements. The roof should be a clean, solid rectangle of the dominant background color or gradient visible in the side panel artwork."
      : "";

    // Build an explicit per-panel source-view mapping so Gemini pulls each panel's
    // artwork from the correct 3D render view (not from whatever image came first).
    // This is THE fix for the "front bumper shows side-panel DNA art" bug.
    const viewsAttached = attachedViewKeys.length > 0
      ? `\n\nAttached 3D render views (in order): ${attachedViewKeys.map(v => v.toUpperCase()).join(", ")}.`
      : "";

    const sourceViewInstruction = attachedViewKeys.length > 0 ? `
Source-View Mapping — CRITICAL. Each flat panel MUST reproduce the artwork visible on that exact body region in the matching 3D view. Do not carry side-panel artwork over to bumpers or vice versa:
- Driver Side / Passenger Side panels → source from the SIDE / DRIVER-SIDE / PASSENGER-SIDE view
- Hood panel → source from the FRONT or HOOD_DETAIL view (the artwork visible on the hood in those views)
- Front Bumper panel → source from the FRONT view (the artwork visible on the bumper ONLY — not the hood, not the side panel)
- Rear (trunk/tailgate) panel → source from the REAR view (the artwork on the tailgate/trunk area)
- Rear Bumper panel → source from the REAR view (the artwork on the bumper ONLY — not the tailgate)
- Roof panel → source from the ROOF / TOP view if provided; otherwise use the background/base design only
If a view is not attached, fall back to the closest available view, but NEVER fabricate bumper artwork from a side-panel view.

Fidelity Rules — APPLY TO EVERY PANEL:
1. Reproduce the artwork EXACTLY as it appears on that body region in the 3D render. Do not invent, restyle, simplify, or add elements that aren't in the render.
2. Preserve the full color/gradient transition across the panel — if the side shows white on the front, design in the middle, white on the rear (or any other gradient/fade), the flat panel must show the SAME left-to-right (or front-to-rear) transition end-to-end. Do NOT collapse a multi-stage gradient into a single fade on one side.
3. Preserve every logo, text element, photo, and graphic with the same placement and proportions as the render. Do not move, replace, or omit them. If the rear panel has a logo above the wheel arch in the render, the flat rear panel must show that logo in the equivalent position.
4. Bumper panels: show ONLY what the bumper area shows in the FRONT/REAR render — typically a solid base color with a single logo or text element. Never recycle side-panel artwork into a bumper. If the front bumper in the render is "white with OPTIMIZE HUMANS text," the flat front-bumper panel is exactly that — white base with that text — nothing else.
5. Passenger Side MUST be a perfect horizontal mirror (canvas flip) of the Driver Side panel. Do not generate the passenger side independently. Every gradient, photo, logo, and text element must mirror across the vertical axis, and any text on the passenger side must read as flipped text (mirrored), not regenerated.` : "";

    const systemInstruction = "You are a production file output specialist at WePrintWraps.com. Your job is to TRANSCRIBE the wrap artwork shown on each body region in the supplied 3D render(s) into flat 2D rectangular panels — like peeling each panel off the vehicle and laying it flat. You are NOT a designer; you do not invent, restyle, recompose, or add elements. Every panel is a perfect flat rectangle (no vehicle shapes, no 3D perspective, no cutouts), filled edge-to-edge with the EXACT artwork from the matching view. Side-panel artwork stays on side panels. Bumper artwork stays on bumpers. Passenger side is always a horizontal mirror of driver side. Panels are proportional to each other (side panels are largest).";

    // ── 4b. Paginate panels ──
    // One 21:9 canvas can't fit >5 reasonably-sized flat panels without Gemini
    // dropping or scrunching one (which was why the roof was disappearing on
    // multi-panel jobs). Split into page 1 = primary wrap panels (sides, hood,
    // bumpers), page 2 = remainder (roof, rear, split overflow). Each page gets
    // its own Gemini call and its own stored PNG.
    const MAX_PANELS_PER_PAGE = 5;
    const PRIMARY_REGEX = /(driver.?side|passenger.?side|^hood|hood(?![\w])|front.?bumper|rear.?bumper)/i;
    const primaryPanels: PanelDim[] = [];
    const overflowPanels: PanelDim[] = [];
    for (const p of resolvedPanels) {
      const name = `${p.label || ""} ${p.panelKey || ""}`;
      if (PRIMARY_REGEX.test(name) && primaryPanels.length < MAX_PANELS_PER_PAGE) {
        primaryPanels.push(p);
      } else {
        overflowPanels.push(p);
      }
    }
    const pages: PanelDim[][] = overflowPanels.length > 0
      ? [primaryPanels, overflowPanels]
      : [primaryPanels];
    console.log(`[ARTBOARD] Paginated into ${pages.length} page(s): [${pages.map(p => p.length).join(", ")}] panels`);

    // ── 5. Generate each page via Gemini ──
    async function generatePage(pagePanels: PanelDim[], pageIdx: number): Promise<string> {
      const isOverflow = pageIdx > 0;
      const pageLabel = pages.length > 1 ? ` — Page ${pageIdx + 1} of ${pages.length}` : "";
      const pagePanelListText = buildPanelList(pagePanels);
      console.log(`[ARTBOARD] Page ${pageIdx + 1} panel list:\n${pagePanelListText}`);

      const pagePrompt = `Role: You are a Print Production Artist at WePrintWraps.com.

Task: Create a single ultra-wide white artboard${pageLabel} in the Representative Paneling layout for a ${vehicle_name}. ${design_prompt}.${viewsAttached}
${isOverflow ? `\nThis is PAGE ${pageIdx + 1} of ${pages.length}. Include ONLY the panels listed below. Do not draw the side panels, hood, or bumpers on this page — those are on page 1.\n` : ""}
Layout — Representative Paneling:
- Side panels (largest) go in the center, stacked if split into Panel 1 (upper) + Panel 2 (lower)
- Hood and Roof panels go on the left side
- Front Bumper, Rear, and Rear Bumper go on the right side
- Each panel is labeled with its name and exact dimensions in inches
${sourceViewInstruction}

Constraints:
- Every panel MUST be a perfect rectangle with four 90-degree corners
- No vehicle curves, no body outlines, no shaped cutouts
- Design must fill each rectangle edge-to-edge with bleed extending past the body coverage area
- Panels must be proportionally sized relative to each other (side panels are the biggest)
- Each panel label must show the exact dimensions in inches below it
- Reproduce, do not reimagine: this is a transcription job, not a design job. The artboard must look like the wrap was peeled off the vehicle and laid flat — same colors, same gradients, same logos, same text, same placement.${editInstruction}${roofInstruction}

Panels & Dimensions:
${pagePanelListText}

Output: One high-resolution PNG. White background. Labels with dimensions below each panel. Use the full canvas width.`;

      let pageImageBase64: string | null = null;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const currentKey = getGeminiKey();
        console.log(`[ARTBOARD] Page ${pageIdx + 1} Gemini attempt ${attempt}, key ${currentKey.slice(0, 8)}...`);

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{
                role: "user",
                parts: [...imageParts, { text: pagePrompt }],
              }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
              },
            }),
            signal: AbortSignal.timeout(120_000),
          },
        );

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`[ARTBOARD] Page ${pageIdx + 1} Gemini ${resp.status}:`, errText.slice(0, 500));
          if (attempt === MAX_ATTEMPTS) throw new Error(`Gemini API error: ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        for (const candidate of data.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            if (part.inlineData?.data) {
              pageImageBase64 = part.inlineData.data;
              break;
            }
          }
          if (pageImageBase64) break;
        }

        if (pageImageBase64) break;
        console.log(`[ARTBOARD] Page ${pageIdx + 1} no image on attempt ${attempt}, retrying...`);
      }

      if (!pageImageBase64) {
        throw new Error(`Gemini returned no image for page ${pageIdx + 1} after retries`);
      }

      return pageImageBase64;
    }

    // ── 6. Run page generation + upload for each page ──
    const pageResults: Array<{ storagePath: string; signedUrl: string }> = [];
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const pageB64 = await generatePage(pages[pageIdx], pageIdx);
      const pageBytes = Uint8Array.from(atob(pageB64), (c) => c.charCodeAt(0));
      const pagePath = pageIdx === 0
        ? `artboards/${job_id}/artboard.png`
        : `artboards/${job_id}/artboard-page-${pageIdx + 1}.png`;

      const { error: uploadError } = await sb.storage
        .from(BUCKET)
        .upload(pagePath, pageBytes, {
          contentType: "image/png",
          cacheControl: "3600",
          upsert: true,
        });
      if (uploadError) throw new Error(`Upload failed for page ${pageIdx + 1}: ${uploadError.message}`);

      const { data: signedData } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(pagePath, 3600);

      pageResults.push({
        storagePath: pagePath,
        signedUrl: signedData?.signedUrl || "",
      });
      console.log(`[ARTBOARD] Uploaded page ${pageIdx + 1}: ${pagePath}`);
    }

    const primaryStoragePath = pageResults[0].storagePath;
    const primarySignedUrl = pageResults[0].signedUrl;

    // ── 7. Update job — save resolved panels, mark pending_qc, save all page URLs ──
    const updatedCj = {
      ...(jobRow?.concept_json || {}),
      artboard_pages: pages.length,
      artboard_page_paths: pageResults.map(r => r.storagePath),
      artboard_page_urls: pageResults.map(r => r.signedUrl),
      artboard_stale: false,
    };
    // NOTE: panelizer_jobs has NO artboard_storage_path/artboard_url columns —
    // writing them made this whole update fail silently for every job, which is
    // why concept_json never carried artboard paths. They live in concept_json.
    const { error: statusErr } = await sb.from("panelizer_jobs").update({
      status: "pending_qc",
      panels: resolvedPanels,
      concept_json: {
        ...updatedCj,
        artboard_storage_path: primaryStoragePath,
        artboard_url: primarySignedUrl || null,
      },
    }).eq("id", job_id);
    if (statusErr) console.error(`[ARTBOARD] Failed to update status:`, statusErr.message);

    // ── 8. Fire-and-forget QC validation on the new artboard ──
    const qcUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/panelizer-qc-artboard`;
    fetch(qcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ job_id }),
    }).then(r => console.log(`[ARTBOARD] QC triggered: ${r.status}`))
      .catch(e => console.error(`[ARTBOARD] QC trigger failed (non-blocking):`, e.message));

    console.log(`[ARTBOARD] Done! ${pages.length} page(s), ${resolvedPanels.length} panels`);

    return new Response(
      JSON.stringify({
        success: true,
        artboard_url: primarySignedUrl,
        storage_path: primaryStoragePath,
        artboard_urls: pageResults.map(r => r.signedUrl),
        artboard_pages: pages.length,
        vehicle_name,
        panels_count: resolvedPanels.length,
        panels: resolvedPanels,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[ARTBOARD] Error:`, err);

    // Mark job as failed so it doesn't get stuck at "queued" forever
    try {
      const sbErr = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const body = await req.clone().json().catch(() => ({}));
      if (body.job_id) {
        await sbErr.from("panelizer_jobs").update({
          status: "failed",
          error_message: err.message || "Artboard generation failed",
        }).eq("id", body.job_id);
        console.log(`[ARTBOARD] Marked job ${body.job_id} as failed`);
      }
    } catch (updateErr) {
      console.error(`[ARTBOARD] Failed to mark job as failed:`, updateErr);
    }

    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
