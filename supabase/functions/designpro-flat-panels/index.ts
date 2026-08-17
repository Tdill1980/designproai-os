// deploy: designpro-flat-panels — FLAT-FIRST panel authoring (standalone, testable)
/**
 * designpro-flat-panels — author the wrap as FLAT print panels FIRST.
 *
 * This is the flat-first generator. It creates each panel as flat, full-bleed
 * print artwork — exactly as it would look printed on vinyl before it touches a
 * vehicle. There is NO un-warp / flatten of a 3D render, so there are no
 * vehicle-shaped holes, no wheel-arch cutouts, and no studio background to strip.
 * The flat panels ARE the source of truth; the customer's 3D proof is rendered
 * FROM these downstream (separate step), and print files are deterministic
 * bleed + upscale of these (no AI).
 *
 * Determinism split (important): AI is used ONLY to AUTHOR the design flat
 * (legitimate creative generation). Everything after — passenger = driver
 * mirrored, bleed, slicing, upscale — is deterministic. We never AI-flatten an
 * already-wrapped render (the lossy step that caused holes/distortion).
 *
 * Driver is generated first as the hero/anchor; hood/roof/rear are generated to
 * MATCH the driver (driver passed as a style reference) so the wrap is cohesive.
 * Passenger is NEVER generated — it is the driver panel mirrored.
 *
 * POST /designpro-flat-panels
 * {
 *   prompt: string,                 // the design brief                  [required]
 *   vehicleMake?, vehicleModel?, vehicleYear?,
 *   sides?: string[],               // default ["driver_side","hood","roof","rear"]
 *   sideSize?: "small|medium|large|xl", roofSize?: "small|medium|large",
 *   finish?: string,                // Gloss | Matte | Satin | ...
 *   referenceImageUrl?: string,     // optional style reference (VisionBoard)
 *   logoUrl?: string,               // optional logo to integrate
 *   userId?, jobId?,
 *   persist?: boolean,              // if true + jobId: write into concept_json.qc_side_panels
 * }
 * → { success, panels:[{side,label,url,widthInches,heightInches,source,derivedFrom?}], sizeSource }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage, getPublicUrl, uint8ArrayToBase64, base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import {
  GEMINI_IMAGE_MODEL, toSupportedRatio, tempPath,
  SIDE_PANELS, ADDON_PANELS, ROOF_PANELS,
} from "../_shared/panelizer-os/constants.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Canonical side → role for dim lookup + prompt wording.
function sideMeta(side: string): { key: string; label: string; role: "side" | "hood" | "roof" | "rear" | "front" } {
  const s = side.toLowerCase();
  if (s.includes("passenger")) return { key: "passenger_side", label: "Passenger Side", role: "side" };
  if (s.includes("driver") || s === "side" || s.includes("left")) return { key: "driver_side", label: "Driver Side", role: "side" };
  if (s.includes("hood")) return { key: "hood", label: "Hood", role: "hood" };
  if (s.includes("roof") || s.includes("top")) return { key: "roof", label: "Roof", role: "roof" };
  if (s.includes("rear") || s.includes("back") || s.includes("tailgate")) return { key: "rear", label: "Rear", role: "rear" };
  if (s.includes("front")) return { key: "front", label: "Front", role: "front" };
  return { key: "driver_side", label: "Driver Side", role: "side" };
}

// Resolve per-side print dims. Canonical source is panelizer-step-validate (the
// SAME source the 2D proof stamps), with a constants fallback so the function
// still works standalone if validate is unavailable.
async function resolveDims(opts: {
  supaUrl: string; serviceKey: string;
  vehicleMake?: string; vehicleModel?: string; vehicleYear?: number;
  sideSize: string; roofSize: string; roles: Set<string>;
}): Promise<{ byRole: Record<string, { w: number; h: number }>; source: string }> {
  const fallback: Record<string, { w: number; h: number }> = {
    side: { w: SIDE_PANELS[opts.sideSize]?.widthInches || SIDE_PANELS.medium.widthInches, h: SIDE_PANELS[opts.sideSize]?.heightInches || SIDE_PANELS.medium.heightInches },
    hood: { w: ADDON_PANELS.hood.widthInches, h: ADDON_PANELS.hood.heightInches },
    roof: { w: (ROOF_PANELS[opts.roofSize] || ROOF_PANELS.medium).widthInches, h: (ROOF_PANELS[opts.roofSize] || ROOF_PANELS.medium).heightInches },
    rear: { w: ADDON_PANELS.rear.widthInches, h: ADDON_PANELS.rear.heightInches },
    front: { w: ADDON_PANELS.frontBumper.widthInches, h: ADDON_PANELS.frontBumper.heightInches },
  };
  if (!opts.vehicleMake || !opts.vehicleModel) return { byRole: fallback, source: "genie-standard" };
  try {
    const r = await fetch(`${opts.supaUrl}/functions/v1/panelizer-step-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.serviceKey}` },
      body: JSON.stringify({
        vehicleMake: opts.vehicleMake, vehicleModel: opts.vehicleModel, vehicleYear: opts.vehicleYear,
        sideSize: opts.sideSize,
        addHood: opts.roles.has("hood"), addRoof: opts.roles.has("roof"),
        roofSize: opts.roles.has("roof") ? opts.roofSize : "none",
        addRear: opts.roles.has("rear"), addFrontBumper: opts.roles.has("front"),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.panels) && j.panels.length) {
      const roleOf = (s: string) => {
        const t = (s || "").toLowerCase();
        if (/driver|passenger|side/.test(t)) return "side";
        if (/roof|top/.test(t)) return "roof";
        if (/hood/.test(t)) return "hood";
        if (/rear|tailgate|back/.test(t)) return "rear";
        if (/front/.test(t)) return "front";
        return "side";
      };
      const byRole = { ...fallback };
      for (const p of j.panels) {
        const role = roleOf(p.panelKey || p.label || "");
        const w = Number(p.widthInches), h = Number(p.heightInches);
        if (w > 0 && h > 0) byRole[role] = { w, h };
      }
      return { byRole, source: "panelizer-step-validate" };
    }
  } catch (_e) { /* fall through to constants */ }
  return { byRole: fallback, source: "genie-standard" };
}

// FULL-BLEED, no-surface, no-baked-gloss rules shared by both prompts. The art
// must extend past every edge so there is NEVER a border/table/background gap
// (those gaps were the "holes"). This is the printed FILE, not a mockup, so no
// vehicle, no 3D object, no baked highlights/reflections.
const FILL_RULES =
  "The artwork MUST completely fill the entire image and extend past all four edges (full bleed) — " +
  "absolutely NO border, NO margin, NO frame, NO surface, NO table, NO floor, NO desk, NO background of any kind is visible anywhere. " +
  "This is a flat, front-on printed design FILE, not a mockup or product photo: no vehicle, no wheels, no windows, no 3D object, " +
  "no drop shadows, no glossy highlights, no specular reflections, no labels, no dimension lines, no watermarks.";

function flatPrompt(_label: string, brief: string, _finish: string, hasLogo: boolean): string {
  const logo = hasLogo ? " Integrate the provided logo cleanly into the layout. " : " ";
  return `A seamless, full-bleed vehicle wrap print design: ${brief}.${logo}${FILL_RULES}`;
}

function matchPrompt(_label: string, brief: string): string {
  return `The first image is the approved flat wrap design (reference). Create a flat print design in the SAME style, colors and design language — continue the same design adapted to this panel's proportions. Consistent with: ${brief}. ${FILL_RULES}`;
}

// Horizontal mirror (passenger = driver flipped) — manual left↔right swap.
async function flipHorizontalBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const w = img.width, h = img.height;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= Math.floor(w / 2); x++) {
      const l = img.getPixelAt(x, y), r = img.getPixelAt(w - x + 1, y);
      img.setPixelAt(x, y, r); img.setPixelAt(w - x + 1, y, l);
    }
  }
  return new Uint8Array(await img.encode());
}

async function fetchB64(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/png";
    return { mime, data: uint8ArrayToBase64(new Uint8Array(await r.arrayBuffer())) };
  } catch { return null; }
}

// ONE Gemini image generation. Model + key pool are LOCKED (gemini-3-pro-image-preview).
async function genImage(parts: any[], aspectRatio: string, temperature: number): Promise<Uint8Array | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const key = getGeminiKey();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            // 2K (not 4K): decoding a 4K PNG + the in-worker mirror/compose blows
            // the 256MB limit (status 546). 2K is memory-safe; the deterministic
            // upscale chain takes the flat panel to true print resolution downstream.
            generationConfig: { temperature, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, imageSize: "2K" } },
          }),
          signal: ctrl.signal,
        },
      );
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`[FLAT-PANELS] ${resp.status} (attempt ${attempt}): ${(await resp.text().catch(() => "")).slice(0, 160)}`);
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        return null;
      }
      const result = await resp.json();
      for (const p of (result?.candidates?.[0]?.content?.parts || [])) {
        if (p?.inlineData?.data) return base64ToUint8Array(p.inlineData.data);
      }
      console.warn(`[FLAT-PANELS] no image (attempt ${attempt}, finish=${result?.candidates?.[0]?.finishReason})`);
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    } catch (e: any) {
      clearTimeout(timer);
      console.warn(`[FLAT-PANELS] ${e?.name === "AbortError" ? "timeout" : e} (attempt ${attempt})`);
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!hasGeminiKey()) return json({ error: "No GOOGLE_AI_API_KEY configured" }, 500);
    const body = await req.json();
    const prompt: string = (body.prompt || "").trim();
    if (!prompt) return json({ error: "prompt (design brief) is required" }, 400);

    const userId: string = body.userId || "designpro";
    const jobId: string = body.jobId || `flat-${Date.now()}`;
    const finish: string = body.finish || "Gloss";
    const sideSize: string = body.sideSize || "medium";
    const roofSize: string = body.roofSize || "medium";
    const requested: string[] = Array.isArray(body.sides) && body.sides.length
      ? body.sides : ["driver_side", "hood", "roof", "rear"];

    // Normalize → unique metas; passenger is derived from driver, never generated.
    const metas = requested.map(sideMeta);
    const wantPassenger = metas.some((m) => m.key === "passenger_side") || requested.some((s) => /passenger/i.test(s));
    const genMetas = metas.filter((m) => m.key !== "passenger_side");
    if (!genMetas.some((m) => m.key === "driver_side")) genMetas.unshift(sideMeta("driver_side"));
    // Driver first (anchor), then the rest.
    genMetas.sort((a, b) => (a.key === "driver_side" ? -1 : b.key === "driver_side" ? 1 : 0));

    const SUPA = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const roles = new Set(genMetas.map((m) => m.role));
    const { byRole, source } = await resolveDims({
      supaUrl: SUPA, serviceKey, vehicleMake: body.vehicleMake, vehicleModel: body.vehicleModel,
      vehicleYear: body.vehicleYear, sideSize, roofSize, roles,
    });

    const styleRef = body.referenceImageUrl ? await fetchB64(body.referenceImageUrl) : null;
    const logo = body.logoUrl ? await fetchB64(body.logoUrl) : null;

    const out: Array<{ side: string; label: string; url: string; widthInches: number; heightInches: number; source: string; derivedFrom?: string }> = [];
    let driverBytes: Uint8Array | null = null;

    // 1) Generate driver (hero/anchor), then the other unique sides matched to it.
    for (const m of genMetas) {
      const dims = byRole[m.role] || byRole.side;
      const ratio = toSupportedRatio(dims.w, dims.h);
      let bytes: Uint8Array | null = null;

      if (m.key === "driver_side" || !driverBytes) {
        const parts: any[] = [];
        if (styleRef) parts.push({ inlineData: { mimeType: styleRef.mime, data: styleRef.data } });
        if (logo) parts.push({ inlineData: { mimeType: logo.mime, data: logo.data } });
        parts.push({ text: flatPrompt(m.label, prompt, finish, !!logo) });
        bytes = await genImage(parts, ratio, 0.6); // creative anchor
        if (bytes && m.key === "driver_side") driverBytes = bytes;
      } else {
        // Match to the driver for a cohesive wrap.
        const parts: any[] = [{ inlineData: { mimeType: "image/png", data: uint8ArrayToBase64(driverBytes) } }];
        parts.push({ text: matchPrompt(m.label, prompt) });
        bytes = await genImage(parts, ratio, 0.35); // constrained → consistency
      }
      if (!bytes) { console.warn(`[FLAT-PANELS] ${m.label} generation failed`); continue; }
      const path = tempPath(userId, jobId, `flat-${m.key}-${Date.now()}`);
      await uploadToStorage(path, bytes, "image/png");
      out.push({ side: m.key, label: m.label, url: getPublicUrl(path), widthInches: dims.w, heightInches: dims.h, source });
    }

    // 2) Passenger = driver mirrored (deterministic, no AI).
    if (wantPassenger && driverBytes) {
      try {
        const flipped = await flipHorizontalBytes(driverBytes);
        const dims = byRole.side;
        const path = tempPath(userId, jobId, `flat-passenger_side-${Date.now()}`);
        await uploadToStorage(path, flipped, "image/png");
        out.push({ side: "passenger_side", label: "Passenger Side", url: getPublicUrl(path), widthInches: dims.w, heightInches: dims.h, source, derivedFrom: "driver_side" });
      } catch (e: any) {
        console.warn(`[FLAT-PANELS] passenger mirror failed: ${e?.message || e}`);
      }
    }

    if (!out.length) return json({ success: false, error: "no flat panels generated" }, 502);

    // 3) Optional: write the flat panels into the job so the UI (qc_side_panels) shows them.
    if (body.persist === true && body.jobId) {
      try {
        const sb = createClient(SUPA, serviceKey);
        const { data: job } = await sb.from("panelizer_jobs").select("concept_json").eq("id", body.jobId).maybeSingle();
        const cj = (job as any)?.concept_json || {};
        const qc = { ...(cj.qc_side_panels || {}) };
        const now = new Date().toISOString();
        for (const p of out) {
          const prev = qc[p.side] || {};
          const versions = Array.isArray(prev.versions) ? [...prev.versions] : [];
          versions.push({ id: `flat-${Date.now()}-${p.side}`, url: p.url, source: "flat-first", createdAt: now });
          qc[p.side] = {
            ...prev, label: p.label, gemini_url: p.url, gemini_source: "flat-first", gemini_uploaded_at: now,
            versions, print_width_in: p.widthInches, print_height_in: p.heightInches, print_size_source: p.source,
          };
        }
        await sb.from("panelizer_jobs").update({ concept_json: { ...cj, qc_side_panels: qc } }).eq("id", body.jobId);
      } catch (e: any) {
        console.warn(`[FLAT-PANELS] persist skipped: ${e?.message || e}`);
      }
    }

    return json({ success: true, panels: out, sizeSource: source });
  } catch (e: any) {
    console.error("[FLAT-PANELS] error:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
