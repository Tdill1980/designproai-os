/**
 * generate-artboard-from-proof
 *
 * ONE uploaded 2D production proof (the multi-view design-approval sheet
 * showing driver/passenger/front/rear/hood/roof of a wrapped vehicle) →
 * ONE dimensioned, multi-panel flat artboard sheet.
 *
 * This is an ORCHESTRATOR. It does NOT invent artwork — it wires together
 * three proven, fidelity-locked building blocks so the output faithfully
 * reproduces the customer's approved design instead of producing AI slop:
 *
 *   1. panelizer-step-validate
 *        make / model / year → real per-side dimensions from the
 *        1,600-row vehicle_dimensions table (227"×76.4" sides, roof, etc.).
 *
 *   2. cropPanelWithBleed   (deterministic ImageScript canvas crop — NO model)
 *        the detected view box is cut 1:1 straight out of the full-resolution
 *        2D proof, then scaled to print resolution (150 PPI, capped to 4K on
 *        the long edge) with a 2" exterior print bleed laid around it. The
 *        customer's approved pixels are copied verbatim — never reinterpreted,
 *        never regenerated. A side with no detected box hard-fails for that
 *        side; we do NOT invent artwork to cover a gap.
 *
 *   3. generate-artboard-flat
 *        deterministic ImageScript compositor — lays each faithful panel
 *        into a rectangle sized to its real inches, draws dimension labels,
 *        flattens to one PNG sheet. A synthetic job_id is used (the missing
 *        panelizer_jobs row is handled gracefully) so this runs standalone.
 *
 * Why text-to-image was wrong: the old single-file path described the proof
 * in prose then generated a brand-new image from text only — the customer's
 * pixels never reached the image model. This path keeps the pixels.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as b64encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Side mapping ──────────────────────────────────────────────────────
// A validate panelKey resolves to (a) which side we flatten off the proof
// and (b) which view key generate-artboard-flat's pickViewUrl expects.
type FlattenSide = "driver" | "passenger" | "hood" | "roof" | "front" | "rear";

function panelToFlattenSide(panelKey: string, label: string): FlattenSide | null {
  const s = `${panelKey} ${label}`.toLowerCase();
  if (s.includes("driver")) return "driver";
  if (s.includes("passenger")) return "passenger";
  if (s.includes("hood")) return "hood";
  if (s.includes("roof") || s.includes("top")) return "roof";
  if (s.includes("front")) return "front";   // front / front-bumper
  if (s.includes("rear") || s.includes("trunk") || s.includes("tailgate")) return "rear"; // rear / rear-bumper
  return null;
}

// Which allRenderUrls key generate-artboard-flat's pickViewUrl looks for.
const VIEW_KEY_FOR_SIDE: Record<FlattenSide, string> = {
  driver: "driver-side",
  passenger: "passenger-side",
  hood: "hood_detail",
  roof: "roof",
  front: "front",
  rear: "rear",
};

const SIDE_LABEL: Record<FlattenSide, string> = {
  driver: "Driver Side",
  passenger: "Passenger Side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
};

// ── Gemini key pool (coordinate detection only) ──
const _gkeys: string[] = [];
let _gkeysLoaded = false, _gkeyIdx = 0;
function geminiKey(): string {
  if (!_gkeysLoaded) {
    const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) _gkeys.push(p);
    for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _gkeys.push(k); }
    _gkeysLoaded = true;
  }
  if (!_gkeys.length) throw new Error("No GOOGLE_AI_API_KEY");
  return _gkeys[_gkeyIdx++ % _gkeys.length];
}

// Which detected proof-view label maps to each flatten side.
const VIEW_MATCH: Record<FlattenSide, (l: string) => boolean> = {
  driver: (l) => l.includes("driver") || l.includes("left") || (l.includes("side") && !l.includes("passenger")),
  passenger: (l) => l.includes("passenger") || l.includes("right"),
  hood: (l) => l.includes("hood"),
  roof: (l) => l.includes("roof") || l.includes("top"),
  front: (l) => l.includes("front"),
  rear: (l) => l.includes("rear") || l.includes("back"),
};

// Detect each vehicle view's bounding box on the 2D proof sheet so each side can
// be flattened from ITS OWN cropped artwork (no duplicating the dominant side,
// no reproducing the proof's header/footer chrome). Gemini coordinate engine,
// temp 0, JSON, 0-1000 normalized [ymin,xmin,ymax,xmax]. Best-effort → [] on error.
async function detectProofViewBoxes(b64: string, mime: string): Promise<Array<{ label: string; box: number[] }>> {
  const prompt = `This image is a multi-view VEHICLE WRAP APPROVAL PROOF showing the SAME wrapped vehicle from several labeled angles. There are TWO full side-profile views — the DRIVER side and the PASSENGER side — that look nearly identical (mirror images); you MUST return BOTH as separate boxes, do NOT merge them or skip one. Also return any Top/Roof, Front, and Rear views that are present. Return the tight bounding box of EACH view's wrapped-vehicle artwork ONLY — exclude the title bar, dimension lines/labels, the signature row, and white margins. Use these exact labels: "Driver Side", "Passenger Side", "Top/Roof", "Front", "Rear". Respond with ONLY valid JSON: {"views":[{"label":"Driver Side","box_2d":[ymin,xmin,ymax,xmax]}]} normalized 0-1000.`;
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiKey()}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) return [];
    const r = await resp.json();
    const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
    const parsed = JSON.parse(txt);
    const list = Array.isArray(parsed) ? parsed : (parsed?.views || parsed?.panels);
    if (!Array.isArray(list)) return [];
    return list.map((b: any) => ({ label: String(b.label || "").toLowerCase(), box: b.box_2d || b.box || [] }))
      .filter((b: any) => Array.isArray(b.box) && b.box.length === 4);
  } catch { return []; }
}

// Targeted single-view detection — multi-view detection is stochastic and drops
// a different view each run; asking for ONE specific view is far more reliable.
// Returns:
//   number[]  → the normalized [ymin,xmin,ymax,xmax] box for the view
//   "absent"  → the model explicitly confirmed this view is NOT on the sheet
//               (e.g. a design with no hood) — caller should OMIT it, not fail
//   null      → detection errored/exhausted retries (unknown — treat as failed)
async function detectOneViewBox(b64: string, mime: string, label: string): Promise<number[] | "absent" | null> {
  const prompt = `This image is a multi-view vehicle wrap APPROVAL PROOF. Each view is captioned with printed text such as "Driver Side", "Passenger Side", "Top/Roof", "Front" and "Rear". Find the vehicle image for the "${label}" view (it sits directly next to / above its "${label}" caption) and return ONLY its tight bounding box — exclude the title bar, the caption text, dimension lines/labels, the signature row and white margins. Look carefully: the Front and Rear views are small end-on views and easy to confuse — the Rear shows the tailgate/bed end, the Front shows the grille/headlights. ONLY return {"box_2d":null} if the "${label}" view truly does not appear anywhere on the sheet. Respond with ONLY valid JSON: {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000.`;
  // A single targeted pass is stochastic — it can wrongly return null or hit a
  // transient 429 even when the view IS present (we saw Rear, which is on the
  // proof, come back null). So: try up to 3 times; return the FIRST real box we
  // get, and only declare a view "absent" if EVERY attempt explicitly says null.
  // A present-but-hard view that returns a box on attempt 2/3 is then kept, and
  // a truly-missing view (consistently null) is the only thing we omit.
  let everSawExplicitNull = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
          generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (resp.status === 429 || resp.status === 503) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (resp.ok) {
        const r = await resp.json();
        const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
        const parsed = JSON.parse(txt);
        const box = parsed?.box_2d || parsed?.box || null;
        if (Array.isArray(box) && box.length === 4) return box; // present — done
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, "box_2d") && parsed.box_2d === null) {
          everSawExplicitNull = true; // note it, but keep trying before trusting it
        }
      }
    } catch { /* transient — retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  // Only omit a side if the model NEVER found it AND at least once said it's not
  // there. If every attempt just errored (no explicit null), it's unknown → fail.
  return everSawExplicitNull ? "absent" : null;
}

// Front + Rear are TWO small end-on truck views that sit side by side at the
// bottom of the proof and look similar — the single-view detector reliably finds
// one (Front) and returns null for the other (Rear), exactly like it used to
// merge Driver/Passenger. Asking for the PAIR in one call, and disambiguating by
// content (grille vs tailgate), recovers the Rear box. Returns {front?, rear?}.
async function detectFrontRearPair(b64: string, mime: string): Promise<{ front?: number[]; rear?: number[] }> {
  const prompt = `This image is a multi-view vehicle wrap APPROVAL PROOF. Near the bottom there are usually TWO small end-on views of the SAME vehicle that look similar: the FRONT (grille, headlights, bumper) and the REAR (tailgate / bed end, taillights). They are often captioned "Front" and "Rear". Return the tight bounding box of EACH — exclude captions, dimension lines/labels and white margins. You MUST return BOTH if both are present; do NOT merge them or skip the Rear. Respond with ONLY valid JSON: {"front":[ymin,xmin,ymax,xmax],"rear":[ymin,xmin,ymax,xmax]} normalized 0-1000. Use null for either that is genuinely not on the sheet.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
          generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (resp.status === 429 || resp.status === 503) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (resp.ok) {
        const r = await resp.json();
        const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
        const parsed = JSON.parse(txt);
        const out: { front?: number[]; rear?: number[] } = {};
        if (Array.isArray(parsed?.front) && parsed.front.length === 4) out.front = parsed.front;
        if (Array.isArray(parsed?.rear) && parsed.rear.length === 4) out.rear = parsed.rear;
        if (out.front || out.rear) return out;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return {};
}

// ── Deterministic 1:1 panel slice — print-bound output spec ──────────
// The 2D proof is already built to the vehicle's true geometry (GENIE dims),
// so each panel is a pure canvas crop — no generative model. We scale the
// crop to 150 PPI and cap the long edge at 4K so the encode stays well under
// the 256MB worker; the full-inch upscale happens later in panelizer-step-
// upscale. A mandatory 2" exterior print bleed is laid around every panel.
const PRINT_PPI = 150;
const BLEED_INCHES = 2;
// Per-panel size caps. The binding constraint inside the per-side crop worker is
// the canvas AREA, not the long edge: content + canvas (2 buffers) must coexist
// during the composite, and the worker's usable working memory is only ~65-90MB
// (measured: a 5120×1737 ≈ 8.9MP canvas crops fine, a 5120×3000 ≈ 15.4MP one OOMs).
// So we cap by MEGAPIXELS (keeps near-square panels like the roof safe) and let
// the long edge run up to MAX_EDGE_PX — which means the WIDE side panels (the
// important 184" driver/passenger) get the most resolution the budget allows.
// True full-size panels are produced downstream in panelizer-step-upscale.
const MAX_EDGE_PX = 6144;        // 6K long-edge ceiling (only binds on very wide panels)
const MAX_CANVAS_PX = 8_500_000; // ~8.5MP canvas cap — at/under the measured-safe point
// Hard pixel budget for the DECODED proof. We keep the proof at FULL resolution
// (no quality compromise) — the storage transform caps at 2500px so it can't
// deliver hi-res anyway, and these panels feed the print pack. The 546 OOM came
// from cloning the whole decoded buffer once PER SIDE (cropPanelWithBleed); that
// is fixed by extractRegion() below, which copies only the sub-region. This cap
// only kicks in for pathologically huge uploads where a single full decode alone
// would exceed the 256MB worker — 30MP ≈ 120MB decode leaves headroom for the
// region + canvas. Realistic proofs (≤ ~6700×4500) pass through untouched.
const MAX_SRC_MP = 30;

// Copy a sub-region OUT of the proof into a new, region-sized Image WITHOUT
// cloning the whole buffer. ImageScript's crop() mutates in place, so the old
// code did proof.clone().crop(...) — duplicating the entire full-res proof on
// every side (up to 6×) and blowing the worker. Row-wise bitmap copy allocates
// only width×height×4 for the region, so peak memory is one full decode + one
// small region instead of two full buffers.
function extractRegion(src: Image, x: number, y: number, w: number, h: number): Image {
  const out = new Image(w, h);
  const sb = src.bitmap, ob = out.bitmap, sw = src.width;
  for (let row = 0; row < h; row++) {
    const sStart = ((y + row) * sw + x) * 4;
    ob.set(sb.subarray(sStart, sStart + w * 4), row * w * 4);
  }
  return out;
}

// Fill the 2" bleed margin by REPLICATING the artwork's edge pixels outward (the
// content stays an exact 1:1 crop — the bleed is extended edge, never a stretch
// or a redraw). Cheap in-place row/column copies on the canvas bitmap, so it adds
// no extra full-canvas buffer.
function bleedExtendEdges(canvas: Image, bleedPx: number, contentW: number, contentH: number): void {
  const W = canvas.width, H = canvas.height;
  const bmp = canvas.bitmap as Uint8Array;
  const rowBytes = W * 4;
  const top = bleedPx, bottom = bleedPx + contentH - 1;
  const left = bleedPx, right = bleedPx + contentW - 1;
  // Left + right columns across the content's vertical band.
  for (let y = top; y <= bottom; y++) {
    const rs = y * rowBytes;
    const lpx = bmp.subarray(rs + left * 4, rs + left * 4 + 4);
    for (let x = 0; x < left; x++) bmp.set(lpx, rs + x * 4);
    const rpx = bmp.subarray(rs + right * 4, rs + right * 4 + 4);
    for (let x = right + 1; x < W; x++) bmp.set(rpx, rs + x * 4);
  }
  // Top + bottom margins: copy the (now edge-extended) first/last content rows.
  const firstRow = bmp.subarray(top * rowBytes, top * rowBytes + rowBytes);
  for (let y = 0; y < top; y++) bmp.set(firstRow, y * rowBytes);
  const lastRow = bmp.subarray(bottom * rowBytes, bottom * rowBytes + rowBytes);
  for (let y = bottom + 1; y < H; y++) bmp.set(lastRow, y * rowBytes);
}

// Deterministic EXACT 1:1 crop of one side off the proof + a 2" edge-extended
// bleed. Designed to run in its OWN worker (one side per invocation) so peak
// memory is bounded regardless of how many sides the vehicle has — sequential
// in-process crops accumulated faster than GC could reclaim and tripped the
// 256MB worker (the 546 "Memory limit exceeded"). The proof is freed right after
// the region copy so only the content + canvas (2 buffers) are live at the peak.
async function cropPanelWithBleed(
  proof: Image,
  box: { x: number; y: number; w: number; h: number },
  wIn: number,
  hIn: number,
): Promise<{ bytes: Uint8Array; width: number; height: number; ppi: number; bleedPx: number }> {
  const PW = proof.width, PH = proof.height;
  // Normalized box → integer pixel rect, clamped to the proof bounds.
  const cx = Math.max(0, Math.min(PW - 1, Math.round(box.x * PW)));
  const cy = Math.max(0, Math.min(PH - 1, Math.round(box.y * PH)));
  const cw = Math.max(1, Math.min(PW - cx, Math.round(box.w * PW)));
  const ch = Math.max(1, Math.min(PH - cy, Math.round(box.h * PH)));
  // Region-only copy of the exact crop, then free the full proof immediately.
  const region = extractRegion(proof, cx, cy, cw, ch);
  (proof as any).bitmap = null;

  // Print size at 150 PPI, including a 2" bleed on every edge, scaled down so the
  // long edge never exceeds the cap.
  const inW = Number(wIn) > 0 ? Number(wIn) : cw / PRINT_PPI;
  const inH = Number(hIn) > 0 ? Number(hIn) : ch / PRINT_PPI;
  const fullW = (inW + BLEED_INCHES * 2) * PRINT_PPI;
  const fullH = (inH + BLEED_INCHES * 2) * PRINT_PPI;
  // Bound by BOTH the long edge and the canvas area (the area cap is what keeps
  // near-square panels under the worker memory ceiling — see MAX_CANVAS_PX).
  const scale = Math.min(
    1,
    MAX_EDGE_PX / Math.max(fullW, fullH),
    Math.sqrt(MAX_CANVAS_PX / (fullW * fullH)),
  );
  const canvasW = Math.max(2, Math.round(fullW * scale));
  const canvasH = Math.max(2, Math.round(fullH * scale));
  const bleedPx = Math.max(1, Math.round(BLEED_INCHES * PRINT_PPI * scale));
  const contentW = Math.max(1, canvasW - bleedPx * 2);
  const contentH = Math.max(1, canvasH - bleedPx * 2);

  // Exact 1:1 artwork at true print size (the crop, scaled — never distorted),
  // composited dead-center; the surrounding 2" is edge-extended bleed.
  const content = region.resize(contentW, contentH); // region === content after this
  const canvas = new Image(canvasW, canvasH);
  canvas.composite(content, bleedPx, bleedPx);
  (content as any).bitmap = null;
  bleedExtendEdges(canvas, bleedPx, contentW, contentH);

  // JPEG, not PNG: opaque artwork, and PNG/zlib encode of a multi-megapixel
  // canvas spikes memory hard. JPEG q92 keeps the encode bounded + the file small.
  const bytes = new Uint8Array(await canvas.encodeJPEG(92));
  (canvas as any).bitmap = null;

  const effPpi = Math.round(contentW / (inW || 1));
  return { bytes, width: canvasW, height: canvasH, ppi: effPpi, bleedPx };
}

// Decode the proof at full resolution with the 30MP safety valve. Shared by the
// orchestrator (view validation) and the per-side crop worker.
async function decodeProofBounded(proofUrl: string): Promise<Image> {
  const pr = await fetch(proofUrl, { signal: AbortSignal.timeout(30_000) });
  if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
  const buf = new Uint8Array(await pr.arrayBuffer());
  if (buf.byteLength < 1024) throw new Error(`asset too small (${buf.byteLength} bytes)`);
  let img = await Image.decode(buf);
  const mp = (img.width * img.height) / 1_000_000;
  if (mp > MAX_SRC_MP) {
    const s = Math.sqrt(MAX_SRC_MP / mp);
    img = img.resize(Math.max(2, Math.round(img.width * s)), Math.max(2, Math.round(img.height * s)));
  }
  return img;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Per-side crop worker ────────────────────────────────────────────────
  // The orchestrator self-invokes this branch once per side (in parallel) so each
  // exact-1:1 crop + bleed runs in its OWN fresh 256MB worker. This is what makes
  // the slice memory-safe at high resolution regardless of how many sides the
  // vehicle has — the previous single-worker sequential loop accumulated buffers
  // and tripped the 546 "Memory limit exceeded". Service-role only.
  if (req.method === "POST") {
    let peek: any = null;
    try { peek = await req.clone().json(); } catch { /* ignore */ }
    if (peek?.step === "cropside") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      let ok = bearer === serviceKey;
      if (!ok && bearer && bearer.split(".").length === 3) {
        try { ok = JSON.parse(atob(bearer.split(".")[1])).role === "service_role"; } catch { /* not a jwt */ }
      }
      if (!ok) {
        return new Response(JSON.stringify({ error: "service-role only" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const { proofUrl, box, side, wIn, hIn } = peek;
        const proof = await decodeProofBounded(proofUrl);
        const panel = await cropPanelWithBleed(proof, box, wIn, hIn);
        const sdb = createClient(supabaseUrl, serviceKey);
        const path = `panels/from-proof/${Date.now()}_${side}.jpg`;
        const up = await sdb.storage.from("wrap-files").upload(path, panel.bytes, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw new Error(up.error.message);
        const url = sdb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
        return new Response(JSON.stringify({ success: true, side, url, width: panel.width, height: panel.height, ppi: panel.ppi, bleedPx: panel.bleedPx }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, side: peek?.side, error: e?.message || "crop failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
  }

  try {
    const body = await req.json();
    const {
      proofUrl,
      userId: bodyUserId = null,
      vehicleMake = "",
      vehicleModel = "",
      vehicleYear = null,
      vehicleName,
      finish = "Gloss",
      category = "restyle",
      sideSize = "medium",
    } = body;

    if (!proofUrl) {
      return new Response(
        JSON.stringify({ error: "Missing proofUrl" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Auth — require a signed-in user; forward their JWT to the flatten fn
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let userId: string | null = null;
    const bearer = authHeader?.replace(/^Bearer\s+/i, "").trim();
    let isServiceRole = bearer === serviceKey;
    if (!isServiceRole && bearer && bearer.split(".").length === 3) {
      try { isServiceRole = JSON.parse(atob(bearer.split(".")[1])).role === "service_role"; } catch { /* not a jwt */ }
    }
    if (isServiceRole) {
      // Trusted server-to-server call — use the explicit body userId for paths.
      userId = bodyUserId || "service";
    } else if (authHeader) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
    }
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required (no user JWT and no service-role userId)" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resolvedName = vehicleName ||
      [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ").trim() ||
      "Vehicle Wrap";

    console.log(`[ProofArtboard] Start — ${resolvedName} (proof=${String(proofUrl).slice(0, 80)})`);

    // ── Step 1: resolve real per-side dimensions ───────────────────────
    let panels: any[] = [];
    let totalSqFt = 0;
    let dimsVerified = false;
    try {
      const valResp = await fetch(`${supabaseUrl}/functions/v1/panelizer-step-validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          vehicleMake,
          vehicleModel,
          vehicleYear,
          sideSize,
          addHood: true,
          addRear: true,
          addFrontBumper: true,
          addRearBumper: true,
          addRoof: true,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (valResp.ok) {
        const valData = await valResp.json();
        panels = Array.isArray(valData.panels) ? valData.panels : [];
        totalSqFt = valData.totalSqFt || 0;
        dimsVerified = !!valData.dims_verified;
      } else {
        console.warn(`[ProofArtboard] validate HTTP ${valResp.status}`);
      }
    } catch (e: any) {
      console.warn(`[ProofArtboard] validate failed: ${e?.message}`);
    }

    if (!panels.length) {
      return new Response(
        JSON.stringify({ error: "Could not resolve vehicle dimensions. Check make / model / year." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log(`[ProofArtboard] ${panels.length} panels, verified=${dimsVerified}, ${totalSqFt} sqft`);

    // ── Step 1.5: load + VALIDATE the 2D proof — the absolute source of truth ──
    // The slicer crops straight out of this asset at full resolution. If it can't
    // be fetched or decoded, HARD-EXIT (422) right here. We never fall back to
    // inventing artwork from a text prompt — a missing/invalid proof is a hard
    // error, not a creative redraw.
    // Validate decodability up front (fail fast with 422 on a bad/missing proof),
    // then FREE it — the orchestrator no longer crops in-process. Each side is
    // cropped in its own worker via the cropside self-invocation below, so this
    // worker never holds the proof + canvases at once.
    try {
      const probe = await decodeProofBounded(proofUrl);
      console.log(`[ProofArtboard] proof validated — ${probe.width}×${probe.height}px source of truth`);
      (probe as any).bitmap = null;
    } catch (e: any) {
      console.error(`[ProofArtboard] proof asset failed to validate: ${e?.message}`);
      return new Response(
        JSON.stringify({ error: `2D proof asset failed to validate (${e?.message}) — refusing to fall back to a generative design`, proofUrl }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Step 2: slice each UNIQUE side 1:1 off the proof (deterministic) ────
    const sidesNeeded = new Set<FlattenSide>();
    for (const p of panels) {
      const side = panelToFlattenSide(p.panelKey || "", p.label || "");
      if (side) sidesNeeded.add(side);
    }

    const sideUrl: Partial<Record<FlattenSide, string>> = {};
    const failedSides: FlattenSide[] = [];
    const absentSides = new Set<FlattenSide>(); // confirmed not on the proof (omit, don't fail)
    const publishedPatternIds: string[] = [];

    // ── Pre-crop each view off the proof so every side flattens from ITS OWN
    // artwork. Feeding the WHOLE proof made the model (a) reproduce the proof's
    // header/footer chrome onto the panel and (b) return the entire sheet for
    // sides it couldn't isolate (e.g. hood). Cropping to each detected view box
    // fixes both. Best-effort: any failure for a side falls back to the
    // whole-proof flatten below, so it's never worse than before.
    // Detect each side's exact bounding box in the proof (vision only — returns
    // coordinates, generates NO pixels). The deterministic slicer then crops the
    // full-resolution proof at these boxes — a true 1:1 replica, no AI redraw.
    const sideBox: Partial<Record<FlattenSide, { x: number; y: number; w: number; h: number }>> = {};
    try {
      const detSrc = proofUrl.includes("/storage/v1/object/")
        ? proofUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (proofUrl.includes("?") ? "&" : "?") + "width=1600&quality=90"
        : proofUrl;
      const pr = await fetch(detSrc, { signal: AbortSignal.timeout(30_000) });
      if (pr.ok) {
        const bytes = new Uint8Array(await pr.arrayBuffer());
        const mime = pr.headers.get("content-type") || "image/jpeg";
        const b64 = b64encode(bytes);
        const SIDE_DET_LABEL: Record<string, string> = {
          driver: "Driver Side", passenger: "Passenger Side", front: "Front",
          rear: "Rear", roof: "Top/Roof", hood: "Hood",
        };
        const setBox = (side: FlattenSide, b: number[]) => {
          const [ymin, xmin, ymax, xmax] = b;
          const x = Math.min(xmin, xmax) / 1000, y = Math.min(ymin, ymax) / 1000;
          const w = Math.abs(xmax - xmin) / 1000, h = Math.abs(ymax - ymin) / 1000;
          if (w > 0.02 && h > 0.02) sideBox[side] = { x, y, w, h };
        };
        // 1) One general multi-view pass.
        const boxes = await detectProofViewBoxes(b64, mime);
        for (const side of sidesNeeded) {
          const hit = boxes.find((b) => VIEW_MATCH[side](b.label));
          if (hit) setBox(side, hit.box);
        }
        // 2) Targeted single-view detection for any side STILL missing (the
        //    multi-view pass reliably drops one). Runs in parallel. A view the
        //    model CONFIRMS is absent (e.g. no hood in this design) is dropped
        //    from sidesNeeded so it neither flattens nor reports as a failure —
        //    only genuine detection errors stay missing (passenger has a mirror
        //    fallback below).
        const missing = [...sidesNeeded].filter((s) => !sideBox[s] && SIDE_DET_LABEL[s]);
        const sawAbsent = new Set<FlattenSide>();
        await Promise.all(missing.map(async (side) => {
          const b = await detectOneViewBox(b64, mime, SIDE_DET_LABEL[side]);
          if (b === "absent") {
            sawAbsent.add(side);
          } else if (b) {
            setBox(side, b);
          }
        }));
        // Front + Rear are easily confused — if either is still missing, ask for
        // the PAIR (disambiguated by grille vs tailgate) before trusting any
        // "absent" verdict. This recovers the Rear box on a structured proof
        // where the single-view detector kept returning null for it.
        if ((sidesNeeded.has("rear") && !sideBox.rear) || (sidesNeeded.has("front") && !sideBox.front)) {
          const pair = await detectFrontRearPair(b64, mime);
          if (sidesNeeded.has("front") && !sideBox.front && pair.front) { setBox("front", pair.front); sawAbsent.delete("front"); }
          if (sidesNeeded.has("rear") && !sideBox.rear && pair.rear) { setBox("rear", pair.rear); sawAbsent.delete("rear"); }
        }
        // A side that's STILL missing and was explicitly reported absent is
        // genuinely not on this proof (e.g. no separate hood view) — omit it.
        for (const side of sawAbsent) if (!sideBox[side]) absentSides.add(side);
        // A confirmed-absent view (e.g. the design has no hood) is not a panel
        // the customer wants — remove it entirely so the UI doesn't surface a
        // "Proof Flatten Failed" card for artwork that legitimately doesn't exist.
        for (const side of absentSides) sidesNeeded.delete(side);
        console.log(`[ProofArtboard] detected view boxes: ${Object.keys(sideBox).join(", ") || "none"}${absentSides.size ? `; absent: ${[...absentSides].join(", ")}` : ""}`);
      }
    } catch (e: any) {
      console.warn(`[ProofArtboard] view-box detection failed: ${e?.message}`);
    }

    // Deterministic EXACT 1:1 crop per side — NO generative model. Each side is cut
    // straight out of the proof at its detected box and given a 2" edge-extended
    // bleed. The crop runs in a SEPARATE worker per side (cropside self-invocation)
    // and all sides run IN PARALLEL, so peak memory is one side's canvases — never
    // the whole vehicle's — which is what keeps it under the 256MB worker. A side
    // with no detected box is a hard failure for that side; we never invent artwork.
    const selfUrl = `${supabaseUrl}/functions/v1/generate-artboard-from-proof`;
    const cropTargets = [...sidesNeeded].filter((side) => {
      if (sideBox[side]) return true;
      failedSides.push(side);
      console.warn(`[ProofArtboard] ✗ ${side}: no view box detected in the proof`);
      return false;
    });
    await Promise.all(cropTargets.map(async (side) => {
      const pForSide = (panels as any[]).find((p) => panelToFlattenSide(p.panelKey || "", p.label || "") === side);
      try {
        const resp = await fetch(selfUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            step: "cropside",
            proofUrl,
            side,
            box: sideBox[side],
            wIn: pForSide?.widthInches,
            hIn: pForSide?.heightInches,
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.success && data?.url) {
          sideUrl[side] = data.url;
          console.log(`[ProofArtboard] ✓ ${side}: 1:1 crop ${data.width}×${data.height}px @ ${data.ppi} PPI, ${BLEED_INCHES}" bleed (${data.bleedPx}px)`);
        } else {
          failedSides.push(side);
          console.warn(`[ProofArtboard] ✗ ${side}: crop ${data?.error || resp.status}`);
        }
      } catch (e: any) {
        failedSides.push(side);
        console.warn(`[ProofArtboard] ✗ ${side}: ${e?.message}`);
      }
    }));

    if (Object.keys(sideUrl).length === 0) {
      return new Response(
        JSON.stringify({ error: "Failed to flatten any panel from the proof", failedSides }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Passenger fallback ── A vehicle's passenger side is the mirror of the
    // driver side, so if the proof's passenger view wasn't detected/flattened
    // we never ship a MISSING side — we horizontally flip the driver panel.
    if (!sideUrl.passenger && sideUrl.driver) {
      try {
        const r = await fetch(sideUrl.driver, { signal: AbortSignal.timeout(30_000) });
        const src = await Image.decode(new Uint8Array(await r.arrayBuffer()));
        const w = src.width, h = src.height;
        const flipped = new Image(w, h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            flipped.setPixelAt(w - x, y + 1, src.getPixelAt(x + 1, y + 1));
          }
        }
        const bytes = new Uint8Array(await flipped.encodeJPEG(90));
        const sdb = createClient(supabaseUrl, serviceKey);
        const path = `panels/from-file/${Date.now()}_passenger_mirror.jpg`;
        await sdb.storage.from("wrap-files").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        sideUrl.passenger = sdb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
        const idx = failedSides.indexOf("passenger");
        if (idx >= 0) failedSides.splice(idx, 1);
        console.log("[ProofArtboard] passenger mirrored from driver (proof view not detected)");
      } catch (e: any) {
        console.warn(`[ProofArtboard] passenger mirror failed: ${e?.message}`);
      }
    }

    // Drop any view the model confirmed is genuinely absent (e.g. this design
    // has no hood) from every downstream surface — the artboard sheet, the
    // production-files list and the response — so we never show or register an
    // empty panel for artwork that legitimately doesn't exist.
    const activePanels = panels.filter((p) => {
      const side = panelToFlattenSide(p.panelKey || "", p.label || "");
      return !(side && absentSides.has(side));
    });

    // ── Step 3: compose the dimensioned artboard ───────────────────────
    // Map each side's faithful panel onto the view key the compositor wants.
    // Strip `mirrored` — we provide a real per-side view, so it must not be
    // flipped (passenger artwork is genuine, not a mirrored driver).
    const allRenderUrls: Record<string, string> = {};
    for (const p of activePanels) {
      const side = panelToFlattenSide(p.panelKey || "", p.label || "");
      if (side && sideUrl[side]) {
        allRenderUrls[VIEW_KEY_FOR_SIDE[side]] = sideUrl[side]!;
      }
    }
    const compositorPanels = activePanels.map((p) => ({
      label: p.label,
      panelKey: p.panelKey,
      widthInches: p.widthInches,
      heightInches: p.heightInches,
      mirrored: false,
    }));

    const jobId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let artboardUrl = "";
    let artboardPath = "";
    try {
      const artResp = await fetch(`${supabaseUrl}/functions/v1/generate-artboard-flat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          job_id: jobId,
          vehicle_name: resolvedName,
          approved_render_url: proofUrl,
          panels: compositorPanels,
          allRenderUrls,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const artData = await artResp.json().catch(() => ({}));
      if (artResp.ok && artData?.success && artData?.artboard_url) {
        artboardUrl = artData.artboard_url;
        artboardPath = artData.storage_path || "";
      } else {
        console.error(`[ProofArtboard] compose failed: ${artData?.error || artResp.status}`);
      }
    } catch (e: any) {
      console.error(`[ProofArtboard] compose error: ${e?.message}`);
    }

    if (!artboardUrl) {
      return new Response(
        JSON.stringify({
          error: "Panels flattened but artboard composition failed",
          panels: panels.map((p) => ({
            side: panelToFlattenSide(p.panelKey || "", p.label || ""),
            label: p.label,
            widthInches: p.widthInches,
            heightInches: p.heightInches,
            panelUrl: sideUrl[panelToFlattenSide(p.panelKey || "", p.label || "") as FlattenSide] || null,
          })),
          failedSides,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Keep the gallery clean — drop any per-side rows the flatten fn published.
    if (publishedPatternIds.length > 0) {
      try {
        const sb = createClient(supabaseUrl, serviceKey);
        await sb.from("designpanelpro_patterns").delete().in("id", publishedPatternIds);
        console.log(`[ProofArtboard] Cleaned ${publishedPatternIds.length} auto-published rows`);
      } catch (e: any) {
        console.warn(`[ProofArtboard] Gallery cleanup failed (non-fatal): ${e?.message}`);
      }
    }

    // Register a production set so /admin/production-files surfaces these
    // proof-derived per-side panels (it reads panel_artboard_jobs +
    // panel_artboard_assets). These panels are flattened OFF THE 2D PROOF (the
    // approved source with per-side dimensions), so they're full-bleed and not
    // cut off like the 3D-render flatten. Additive + non-fatal.
    let productionJobId: string | null = null;
    try {
      const db = createClient(supabaseUrl, serviceKey);
      productionJobId = crypto.randomUUID();
      await db.from("panel_artboard_jobs").insert({
        id: productionJobId,
        user_id: userId,
        status: "complete",
        mode: "production",
        prompt: `${resolvedName} — 2D-proof artboard (per-side flatten off the approved 2D proof)`,
        reference_image_url: proofUrl,
        vehicle_year: String(vehicleYear || ""),
        vehicle_make: vehicleMake || "",
        vehicle_model: vehicleModel || "",
        finish,
        bleed_inches: 2,
        dims_source: dimsVerified ? "vehicle_dimensions" : "estimated",
        panels: activePanels.map((p: any) => ({ label: p.label, panelKey: p.panelKey, widthInches: p.widthInches, heightInches: p.heightInches })),
        completed_at: new Date().toISOString(),
      });
      const assetRows: any[] = [];
      let sort = 0;
      assetRows.push({ job_id: productionJobId, kind: "artboard", label: `${resolvedName} — flat panel artboard`, url: artboardUrl, storage_path: artboardPath || null, sort_order: sort++ });
      for (const p of activePanels) {
        const side = panelToFlattenSide(p.panelKey || "", p.label || "");
        const u = side ? sideUrl[side] : null;
        if (!u) continue;
        assetRows.push({
          job_id: productionJobId, kind: "panel",
          label: `${p.label} — ${p.widthInches}×${p.heightInches} (from 2D proof)`,
          panel_label: p.label, width_inches: p.widthInches, height_inches: p.heightInches,
          url: u, sort_order: sort++,
        });
      }
      if (assetRows.length) await db.from("panel_artboard_assets").insert(assetRows);
      console.log(`[ProofArtboard] Registered production job ${productionJobId} with ${assetRows.length} assets`);
    } catch (e: any) {
      console.warn(`[ProofArtboard] production-files register failed (non-fatal): ${e?.message}`);
    }

    // Per-side download list (de-duped to the unique faithful panels)
    const sidePanels = [...sidesNeeded].map((side) => ({
      side,
      label: SIDE_LABEL[side],
      panelUrl: sideUrl[side] || null,
    }));

    console.log(`[ProofArtboard] Done — artboard ${artboardPath}, ${sidePanels.length} sides, failed=${failedSides.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        artboardUrl,
        artboardPath,
        productionJobId,
        vehicleName: resolvedName,
        totalSqFt,
        dimsVerified,
        panels: activePanels.map((p) => ({
          label: p.label,
          panelKey: p.panelKey,
          widthInches: p.widthInches,
          heightInches: p.heightInches,
        })),
        sidePanels,
        failedSides,
        absentSides: [...absentSides],
        detectedSides: Object.keys(sideBox),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[ProofArtboard] Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
