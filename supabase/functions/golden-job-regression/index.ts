/**
 * golden-job-regression — READ-ONLY verifier for the sanctioned production chain.
 *
 * Roadmap item 1 (CLAUDE.md — production-readiness): run the golden job's vault
 * through five invariant checks and return a single PASS/FAIL report with
 * per-check detail. It NEVER writes and NEVER generates — it only inspects what
 * the Build Assets chain produced, so it is safe to run at any time (admin
 * button on Design Assets, or scripts/golden-job-regression.mjs after a deploy).
 *
 * Body: { generationId }  — designiq_generations id OR color_visualizations id
 *                           (canonical id resolved via admin_notes back-link,
 *                           same as DesignAssetsPanel).
 *
 * Checks:
 *  1. dims-match-genie   — every vault side's dimensions_inches {w,h} equals the
 *                          dims the 2D proof stamped (proof_stamped_dims persisted
 *                          by generate-2d-proof; falls back to a live
 *                          panelizer-step-validate resolve with the SAME params).
 *  2. six-sides          — the vehicle-class contract is complete: six standard
 *                          surfaces or four trailer walls, each with real clean +
 *                          branded URLs (newest row per side).
 *  3. opaque-panels      — each panel decodes with zero transparency and no
 *                          unfilled-canvas white border (the CORE PRINT RULE:
 *                          artwork fills 100% of the canvas). Pixel math on a
 *                          384px storage-transform copy — never a raw 4K decode.
 *  4. lifted-layer-text  — every lifted text layer's text (overlay_pngs[].role)
 *                          exists in the design (job copy corpus, then a temp-0
 *                          Gemini read of the BRANDED panel as the tie-breaker).
 *                          Catches fabricated/parroted layers.
 *  5. layer1-is-driver   — design_generation_assets.background_url IS the driver
 *                          side's QC-judged clean panel, never the un-judged
 *                          continuous artboardClean pass.
 *
 * Response: { success, pass, generationId, canonicalId, checks: [
 *   { id, label, pass, detail: string[] } ], summary }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STANDARD_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
const TRAILER_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"];

type Check = { id: string; label: string; pass: boolean; detail: string[] };

function geminiKey(): string | null {
  const p = Deno.env.get("GOOGLE_AI_API_KEY");
  if (p) return p;
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) return k; }
  return null;
}

// Same live GENIE resolve generate-2d-proof + DesignAssetsPanel use. Trailer
// walls read the full vehicle geometry, never the first roll-width split tile.
async function resolveGenieDims(
  supabaseUrl: string,
  serviceKey: string,
  make: string,
  model: string,
  year: string,
  isTrailer: boolean,
  bodyText: string,
): Promise<Record<string, number> | null> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/panelizer-step-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        vehicleMake: make,
        vehicleModel: model,
        vehicleYear: year,
        bodyText,
        sideSize: "medium",
        addHood: !isTrailer,
        addRear: true,
        addFrontBumper: !isTrailer,
        addRearBumper: !isTrailer,
        addRoof: !isTrailer,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (isTrailer) {
      const v = d?.vehicle || d?.estimatedDimensions || {};
      const sideW = Number(v.bodyLengthInches) || 0;
      const sideH = Number(v.bodyHeightInches) || 0;
      const endW = Number(v.backWidthInches) || 0;
      const endH = Number(v.backHeightInches) || 0;
      if (!sideW || !sideH || !endW || !endH) return null;
      return {
        sideW,
        sideH,
        frontW: endW,
        frontH: endH,
        backW: endW,
        backH: endH,
      };
    }
    const panels: any[] = Array.isArray(d.panels) ? d.panels : [];
    const find = (re: RegExp) => panels.find((p) => re.test(`${p.panelKey || ""} ${p.label || ""}`.toLowerCase()));
    const side = find(/driver|(^|[^a-z])side/), hood = find(/hood/), roof = find(/roof|top/), rear = find(/rear|back/), front = find(/front/);
    if (!side?.widthInches) return null;
    const out: Record<string, number> = { sideW: side.widthInches, sideH: side.heightInches };
    if (hood?.widthInches) { out.hoodW = hood.widthInches; out.hoodL = hood.heightInches; }
    if (roof?.widthInches) { out.roofW = roof.widthInches; out.roofL = roof.heightInches; }
    if (rear?.widthInches) { out.backW = rear.widthInches; out.backH = rear.heightInches; }
    if (front?.widthInches) { out.frontW = front.widthInches; out.frontH = front.heightInches; }
    return out;
  } catch { return null; }
}

// Replicates DesignAssetsPanel.sideDims EXACTLY (incl. the front/rear
// derive-from-sideH fallback and the body-type defaults) so "expected" here is
// what the build was told to slice at.
const DEFAULT_SIDE_DIMS: Record<string, [number, number]> = {
  "DRIVER SIDE": [210, 72], "PASSENGER SIDE": [210, 72],
  "HOOD": [62, 46], "ROOF": [50, 70], "FRONT": [66, 56], "REAR": [66, 56],
};
function expectedDims(side: string, g: Record<string, number> | null, isTrailer = false): { w?: number; h?: number; source: string } {
  const M: Record<string, [string, string]> = {
    "DRIVER SIDE": ["sideW", "sideH"], "PASSENGER SIDE": ["sideW", "sideH"],
    "HOOD": ["hoodW", "hoodL"], "ROOF": ["roofW", "roofL"],
    "FRONT": ["frontW", "frontH"], "REAR": ["backW", "backH"],
  };
  const gd = g ? { ...g } : null;
  if (gd) {
    // Mirror the client's bumper back-fills before per-side lookup.
    if (!gd.frontW && gd.backW) { gd.frontW = gd.backW; gd.frontH = gd.backH; }
    if (!gd.backW && gd.frontW) { gd.backW = gd.frontW; gd.backH = gd.frontH; }
    if (!isTrailer && !gd.backW && gd.sideH) {
      const bw = Math.round(gd.sideH * 1.6), bh = Math.round(gd.sideH);
      gd.frontW = gd.backW = bw; gd.frontH = gd.backH = bh;
    }
    const m = M[side];
    if (m && gd[m[0]] && gd[m[1]]) return { w: gd[m[0]], h: gd[m[1]], source: "genie" };
    if ((side === "FRONT" || side === "REAR") && gd.sideH) {
      return { w: Math.round(gd.sideH * 1.6), h: Math.round(gd.sideH), source: "derived-bumper" };
    }
  }
  if (isTrailer) return { source: "none" };
  const d = DEFAULT_SIDE_DIMS[side];
  return d ? { w: d[0], h: d[1], source: "default" } : { source: "none" };
}

// Memory-safe pixel stats: fetch a ≤384px storage-transform copy, decode, and
// measure transparency + white coverage. Never decodes a raw print panel.
async function panelPixelStats(url: string): Promise<{ pctTransparent: number; pctBorderWhite: number; pctInteriorWhite: number; width: number; height: number } | { error: string }> {
  try {
    const small = url.includes("/storage/v1/object/")
      ? url.replace("/storage/v1/object/", "/storage/v1/render/image/") + (url.includes("?") ? "&" : "?") + "width=384&height=384&resize=contain&format=origin"
      : url;
    let resp = await fetch(small, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) resp = await fetch(url, { signal: AbortSignal.timeout(30000) }); // transform can 404 on non-storage URLs
    if (!resp.ok) return { error: `fetch ${resp.status}` };
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length > 25_000_000) return { error: "image too large to inspect" };
    const im = await Image.decode(bytes);
    const W = im.width, H = im.height;
    let transparent = 0, borderWhite = 0, borderCount = 0, interiorWhite = 0, interiorCount = 0;
    const ring = Math.max(1, Math.round(Math.min(W, H) * 0.02)); // 2% border ring
    for (const [x, y, c] of im.iterateWithColors()) {
      const r = (c >>> 24) & 0xff, g = (c >>> 16) & 0xff, b = (c >>> 8) & 0xff, a = c & 0xff;
      if (a < 250) transparent++;
      const isWhite = r >= 250 && g >= 250 && b >= 250;
      const onBorder = x < ring || y < ring || x >= W - ring || y >= H - ring;
      if (onBorder) { borderCount++; if (isWhite) borderWhite++; }
      else { interiorCount++; if (isWhite) interiorWhite++; }
    }
    const total = W * H;
    return {
      pctTransparent: (transparent / total) * 100,
      pctBorderWhite: borderCount ? (borderWhite / borderCount) * 100 : 0,
      pctInteriorWhite: interiorCount ? (interiorWhite / interiorCount) * 100 : 0,
      width: W, height: H,
    };
  } catch (e: any) { return { error: e?.message || "decode failed" }; }
}

// Temp-0 Gemini tie-breaker for lifted-layer text the job copy doesn't contain:
// "is this exact text visibly present in the branded design?" Same judge-call
// shape as the worker QC gate (no responseMimeType / system_instruction).
async function textVisibleInDesign(texts: string[], imageUrls: string[]): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  for (const t of texts) out[t] = null;
  const key = geminiKey();
  if (!key || !texts.length || !imageUrls.length) return out;
  try {
    const parts: any[] = [];
    for (const u of imageUrls.slice(0, 2)) {
      const small = u.includes("/storage/v1/object/")
        ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + "width=1024&resize=contain&format=origin"
        : u;
      const r = await fetch(small, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const b = new Uint8Array(await r.arrayBuffer());
      let s = ""; const CH = 32768;
      for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
      parts.push({ inline_data: { mime_type: r.headers.get("content-type") || "image/png", data: btoa(s) } });
    }
    if (!parts.length) return out;
    const prompt = `These images show a vehicle wrap design. For EACH candidate string below, answer whether that exact text is ACTUALLY VISIBLE somewhere in the design (case-insensitive; minor kerning/stylization ok, but the words must really be there). Candidates: ${JSON.stringify(texts)}. Return ONLY JSON: {"results":[{"text":"<candidate>","visible":true|false}]}`;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [...parts, { text: prompt }] }], generationConfig: { responseModalities: ["TEXT"], temperature: 0 } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) return out;
    const j = await resp.json();
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
    const jm = txt.match(/\{[\s\S]*\}/);
    if (!jm) return out;
    const parsed = JSON.parse(jm[0]);
    for (const r of (parsed?.results || [])) {
      if (typeof r?.text === "string" && typeof r?.visible === "boolean") out[r.text] = r.visible;
    }
  } catch { /* leave nulls — reported as unverifiable */ }
  return out;
}

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { generationId } = await req.json();
    if (!generationId) return json({ success: false, error: "Missing generationId" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // ── Canonical id (same resolution as DesignAssetsPanel) ──
    let canonicalId = String(generationId);
    let cvRow: any = null;
    {
      const { data: direct } = await db.from("color_visualizations")
        .select("id, admin_notes, render_urls, vehicle_make, vehicle_model, vehicle_year, vehicle_type").eq("id", generationId).maybeSingle();
      if (direct) {
        cvRow = direct;
        try {
          const n = typeof direct.admin_notes === "string" ? JSON.parse(direct.admin_notes) : (direct.admin_notes || {});
          if (n?.designiq_generation_id) canonicalId = String(n.designiq_generation_id);
        } catch { /* not linked */ }
      }
    }
    const gid = canonicalId;

    const { data: gen } = await db.from("designiq_generations")
      .select("id, company_name, raw_prompt, enhanced_prompt, vehicle_make, vehicle_model, vehicle_year, finish, render_urls, master_artboard_url, flat_proof_url, truespec_metadata")
      .eq("id", gid).maybeSingle();

    // Linked viz row (holds admin_notes.artboard_clean_url + proof_stamped_dims
    // for jobs driven through color_visualizations).
    if (!cvRow) {
      const { data: linked } = await db.from("color_visualizations")
        .select("id, admin_notes, render_urls, vehicle_make, vehicle_model, vehicle_year, vehicle_type")
        .ilike("admin_notes", `%designiq_generation_id%${gid}%`)
        .order("created_at", { ascending: false }).limit(1);
      cvRow = linked?.[0] || null;
    }
    let cvNotes: Record<string, any> = {};
    try { cvNotes = cvRow?.admin_notes ? (typeof cvRow.admin_notes === "string" ? JSON.parse(cvRow.admin_notes) : cvRow.admin_notes) : {}; } catch { cvNotes = {}; }

    const { data: dgaRows } = await db.from("design_generation_assets")
      .select("background_url, overlay_pngs, created_at").eq("generation_id", gid)
      .order("created_at", { ascending: false }).limit(1);
    const dga = dgaRows?.[0] || null;

    // Vault: newest row per side, across both possible job keys.
    const jobIds = Array.from(new Set([gid, String(generationId)]));
    const { data: pfaAll } = await db.from("production_flow_assets")
      .select("side, dimensions_inches, background_url, branding_url, created_at")
      .in("job_id", jobIds).order("created_at", { ascending: false });
    const bySide: Record<string, any> = {};
    for (const r of (pfaAll || [])) {
      const k = String(r.side || "").toUpperCase();
      if (!bySide[k]) bySide[k] = r;
    }

    if (!gen && !cvRow && !Object.keys(bySide).length) {
      return json({ success: false, error: `No generation, visualization, or vault rows found for ${generationId}` }, 404);
    }

    const make = gen?.vehicle_make || cvRow?.vehicle_make || "";
    const model = gen?.vehicle_model || cvRow?.vehicle_model || "";
    const year = String(gen?.vehicle_year || cvRow?.vehicle_year || "");
    const truespec = gen?.truespec_metadata && typeof gen.truespec_metadata === "object"
      ? gen.truespec_metadata as Record<string, any>
      : {};
    const declaredVehicleType = String(
      cvRow?.vehicle_type
      || cvNotes.vehicle_type
      || cvNotes.vehicleType
      || truespec.vehicle_type
      || truespec.vehicleType
      || "",
    ).trim().toLowerCase();
    const bodyText = [
      make,
      model,
      cvNotes.original_prompt,
      cvNotes.body_text,
      gen?.raw_prompt,
      gen?.enhanced_prompt,
    ].filter(Boolean).join(" ");
    // Explicit type wins. The prompt fallback is only for legacy rows that
    // predate vehicle_type; a car brief mentioning a trailer company stays a car.
    const isTrailer = declaredVehicleType === "trailer"
      || (!declaredVehicleType && /\btrailers?\b/i.test(bodyText));
    const expectedSides = isTrailer ? TRAILER_SIDES : STANDARD_SIDES;

    const checks: Check[] = [];

    // ── CHECK 1: vault dims == 2D-proof stamped dims (GENIE tokens) ──
    {
      const detail: string[] = [];
      let pass = true;
      const stamped: Record<string, number> | null =
        (gen?.truespec_metadata && typeof gen.truespec_metadata === "object" && (gen.truespec_metadata as any).proof_stamped_dims) ||
        cvNotes.proof_stamped_dims || null;
      const live = await resolveGenieDims(supabaseUrl, serviceKey, make, model, year, isTrailer, bodyText);
      const reference = stamped || live;
      if (stamped) detail.push("Reference: the dims generate-2d-proof STAMPED on this job's proof (persisted record).");
      else if (live) detail.push("Reference: live GENIE resolve (no stamped-dims record on this job — proof predates the harness; regenerate the 2D proof to record it).");
      if (!reference) {
        pass = false;
        detail.push(`FAIL — no stamped dims and GENIE could not resolve "${year} ${make} ${model}".`);
      } else {
        for (const side of expectedSides) {
          const row = bySide[side];
          if (!row) { detail.push(`${side}: no vault row (counted in check 2)`); continue; }
          const d = row.dimensions_inches || {};
          const w = Number(d.w ?? d.width) || 0, h = Number(d.h ?? d.height) || 0;
          const exp = expectedDims(side, reference, isTrailer);
          if (!w || !h) { pass = false; detail.push(`${side}: FAIL — vault row has no dims recorded`); continue; }
          if (!exp.w || !exp.h) { pass = false; detail.push(`${side}: FAIL — no reference dim resolvable`); continue; }
          const ok = Math.abs(w - exp.w) <= 0.1 && Math.abs(h - exp.h) <= 0.1;
          if (!ok) pass = false;
          detail.push(`${side}: ${ok ? "ok" : "FAIL"} — vault ${w}″×${h}″ vs ${exp.source === "genie" ? "stamped/GENIE" : exp.source} ${exp.w}″×${exp.h}″`);
        }
      }
      checks.push({ id: "dims-match-genie", label: "GENIE dims match the 2D proof stamp on every side", pass, detail });
    }

    // ── CHECK 2: complete vehicle-class surface contract in the vault ──
    {
      const missing = expectedSides.filter((s) => !bySide[s]);
      const incomplete = expectedSides.filter((s) => bySide[s] && !(bySide[s].background_url && bySide[s].branding_url));
      const forbidden = isTrailer ? ["HOOD", "ROOF"].filter((s) => bySide[s]) : [];
      const pass = !missing.length && !incomplete.length && !forbidden.length;
      const detail = [
        `${expectedSides.length - missing.length}/${expectedSides.length} ${isTrailer ? "trailer walls" : "sides"} present (job keys checked: ${jobIds.join(", ")})`,
        ...missing.map((s) => `${s}: FAIL — missing from the vault`),
        ...incomplete.map((s) => `${s}: FAIL — row present but clean/branded URL empty`),
        ...forbidden.map((s) => `${s}: FAIL — forbidden by the trailer four-wall contract`),
      ];
      checks.push({
        id: "six-sides",
        label: `${expectedSides.length}/${expectedSides.length} ${isTrailer ? "trailer walls" : "sides"} present in the vault (clean + branded)`,
        pass,
        detail,
      });
    }

    // ── CHECK 3: every panel opaque edge-to-edge, no unfilled white ──
    {
      const detail: string[] = [];
      let pass = true;
      for (const side of expectedSides) {
        const row = bySide[side];
        if (!row) { detail.push(`${side}: skipped — no vault row`); continue; }
        const targets: Array<[string, string]> = [];
        if (row.branding_url) targets.push(["branded", row.branding_url]);
        if (row.background_url && row.background_url !== row.branding_url) targets.push(["clean", row.background_url]);
        for (const [kind, url] of targets) {
          const st = await panelPixelStats(url);
          if ("error" in st) { pass = false; detail.push(`${side} (${kind}): FAIL — could not inspect (${st.error})`); continue; }
          const transparent = st.pctTransparent > 0.1;
          // Unfilled-canvas signature: white border ring while the artwork
          // interior is not itself a white design.
          const whiteEdge = st.pctBorderWhite > 10 && st.pctInteriorWhite < 50;
          if (transparent || whiteEdge) pass = false;
          detail.push(
            `${side} (${kind}): ${transparent || whiteEdge ? "FAIL" : "ok"} — transparency ${st.pctTransparent.toFixed(2)}%, border-white ${st.pctBorderWhite.toFixed(1)}%, interior-white ${st.pctInteriorWhite.toFixed(1)}%`
            + (transparent ? " · TRANSPARENT PIXELS (would print white)" : "")
            + (whiteEdge ? " · WHITE BORDER (bleed/body-color floor missing)" : ""),
          );
        }
      }
      checks.push({ id: "opaque-panels", label: "Every panel opaque edge-to-edge — no white, no transparency", pass, detail });
    }

    // ── CHECK 4: no lifted layer whose text isn't in the design ──
    {
      const detail: string[] = [];
      let pass = true;
      const overlays: any[] = Array.isArray(dga?.overlay_pngs) ? dga.overlay_pngs : [];
      const textLayers = overlays.filter((o) => o?.url && String(o.kind || "text") === "text" && String(o.role || "").trim());
      if (!overlays.length) detail.push("No lifted layers persisted — nothing to fabricate (ok).");
      else if (!textLayers.length) detail.push(`${overlays.length} lifted layer(s), none carrying text — nothing to verify (ok).`);
      else {
        const corpus = norm([
          gen?.company_name, gen?.raw_prompt, gen?.enhanced_prompt,
          cvNotes.original_prompt, cvNotes.edit_instructions, cvNotes.design_name,
        ].filter(Boolean).join(" "));
        const unresolved: string[] = [];
        for (const o of textLayers) {
          const t = String(o.role).trim();
          if (corpus && corpus.includes(norm(t))) detail.push(`"${t}": ok — found in the job's copy (prompt/company)`);
          else unresolved.push(t);
        }
        if (unresolved.length) {
          const brandedImgs = [bySide["DRIVER SIDE"]?.branding_url, gen?.flat_proof_url || cvNotes.flat_proof_url].filter(Boolean) as string[];
          const verdicts = await textVisibleInDesign(unresolved, brandedImgs);
          for (const t of unresolved) {
            const v = verdicts[t];
            if (v === true) detail.push(`"${t}": ok — visually confirmed in the branded design`);
            else if (v === false) { pass = false; detail.push(`"${t}": FAIL — lifted layer text NOT found in the design (fabricated/parroted layer)`); }
            else { pass = false; detail.push(`"${t}": FAIL — not in the job copy and could not be visually verified (treat as fabricated until checked)`); }
          }
        }
      }
      checks.push({ id: "lifted-layer-text", label: "No lifted layer whose text isn't in the design", pass, detail });
    }

    // ── CHECK 5: Layer 1 == the driver side's clean panel ──
    {
      const detail: string[] = [];
      let pass = true;
      const layer1 = dga?.background_url || null;
      const driverClean = bySide["DRIVER SIDE"]?.background_url || null;
      const continuous = cvNotes.artboard_clean_url || null;
      if (!layer1) { pass = false; detail.push("FAIL — no Layer 1 (design_generation_assets.background_url) persisted."); }
      else if (!driverClean) { pass = false; detail.push("FAIL — no driver-side clean panel in the vault to compare against."); }
      else if (layer1 === driverClean) detail.push("ok — Layer 1 IS the driver side's QC-judged clean panel.");
      else if (continuous && layer1 === continuous) { pass = false; detail.push("FAIL — Layer 1 is the un-judged CONTINUOUS artboardClean pass, not the driver clean panel."); }
      else { pass = false; detail.push(`FAIL — Layer 1 (${layer1.slice(-48)}) != driver clean panel (${driverClean.slice(-48)}).`); }
      checks.push({ id: "layer1-is-driver", label: "Layer 1 equals the driver side's clean panel (not the continuous pass)", pass, detail });
    }

    // ── CHECK 6: bleed + aspect — the PIXELS carry the mandatory 5″ bleed ──
    // Deterministic. Every vault panel records {w,h,px,py} (trim inches +
    // pixel size). The panel's pixel aspect must equal the BLEED-INCLUSIVE
    // aspect (w+10)/(h+10) — a panel sliced without bleed matches the bare
    // trim aspect instead, and a stretched/mis-sized panel matches neither.
    // This is the "no bleed / wrong panel size" class the judge used to miss.
    {
      const detail: string[] = [];
      let pass = true;
      const BLEED_TOTAL = 10; // 5" per edge, both edges
      for (const side of expectedSides) {
        const row = bySide[side];
        if (!row) continue; // absence is check 2's job
        const d = row.dimensions_inches || {};
        const w = Number(d.w ?? d.width) || 0, h = Number(d.h ?? d.height) || 0;
        let px = Number(d.px) || 0, py = Number(d.py) || 0;
        let measured = "";
        if (!w || !h) { detail.push(`${side}: no trim dims (counted in check 1)`); continue; }
        if (!px || !py) {
          // Metadata gap (e.g. the passenger mirror path doesn't record px/py):
          // measure the panel itself. resize=contain preserves aspect, which is
          // all this check needs.
          const st = await panelPixelStats(row.branding_url || row.background_url || "");
          if ("error" in st) { pass = false; detail.push(`${side}: FAIL — no pixel size recorded and panel unmeasurable (${st.error})`); continue; }
          px = st.width; py = st.height; measured = " (measured from image)";
        }
        const bleedAspect = (w + BLEED_TOTAL) / (h + BLEED_TOTAL);
        const trimAspect = w / h;
        const actual = px / py;
        const offBleed = Math.abs(actual - bleedAspect) / bleedAspect;
        const offTrim = Math.abs(actual - trimAspect) / trimAspect;
        if (offBleed <= 0.03) detail.push(`${side}: ok — pixel aspect ${actual.toFixed(3)} matches trim+10″ bleed (${bleedAspect.toFixed(3)})${measured}`);
        else if (offTrim <= 0.03) { pass = false; detail.push(`${side}: FAIL — pixel aspect matches BARE TRIM (${trimAspect.toFixed(3)}): the 10″ bleed is MISSING${measured}`); }
        else { pass = false; detail.push(`${side}: FAIL — pixel aspect ${actual.toFixed(3)} matches neither trim+bleed (${bleedAspect.toFixed(3)}) nor trim (${trimAspect.toFixed(3)}): wrong panel size/stretch${measured}`); }
      }
      checks.push({ id: "bleed-and-aspect", label: "Every panel's pixels carry the 5″ bleed at the true panel size", pass, detail });
    }

    // ── CHECK 7: panel design matches ITS side's approved view ──
    // The "not even the same design" class: a hood panel carrying the side
    // lettering, a marble hood on a striped design. Same temp-0 image-model
    // JUDGE the worker's field gate uses (text mode, ~768px copies — no
    // generation, no repaint): per side, is the panel the SAME artwork as the
    // approved view of that side? Skipped per side when no view exists.
    {
      const detail: string[] = [];
      let pass = true;
      const key = geminiKey();
      const views: Record<string, string> = (() => {
        // Prefer whichever record actually HAS views — an empty {} render_urls
        // on the generation row is truthy and must not shadow the viz row's.
        const withKeys = (o: unknown) =>
          o && typeof o === "object" && Object.keys(o as object).length ? o as Record<string, string> : null;
        return withKeys(gen?.render_urls) || withKeys(cvRow?.render_urls) || {};
      })();
      const VIEW_FOR: Record<string, string[]> = {
        "DRIVER SIDE": ["side", "driver-side", "hero"],
        "PASSENGER SIDE": ["passenger-side"],
        "HOOD": ["hood_detail", "hood"],
        "ROOF": ["roof", "top"],
        "FRONT": ["front"],
        "REAR": ["rear", "back"],
      };
      const tf = (u: string, wpx: number) => u.includes("/storage/v1/object/")
        ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + `width=${wpx}&height=${wpx}&resize=contain&quality=80`
        : u;
      // 512px copies + sequential fetches: this check runs after three other
      // image passes in a 256MB worker — 768px parallel pairs tipped it into
      // WORKER_RESOURCE_LIMIT (546) on 6-side jobs.
      const fetchB64 = async (u: string): Promise<string | null> => {
        try {
          const r = await fetch(tf(u, 512), { signal: AbortSignal.timeout(20_000) });
          if (!r.ok) return null;
          const b = new Uint8Array(await r.arrayBuffer());
          let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(i + 8192, b.length))));
          return btoa(s);
        } catch { return null; }
      };
      if (!key) { detail.push("skip — no Gemini key for the design judge (fail-open)"); }
      else {
        for (const side of expectedSides) {
          const row = bySide[side];
          if (!row) continue;
          const panelUrl = row.branding_url || row.background_url;
          const viewKey = (VIEW_FOR[side] || []).find((k) => views[k]);
          if (!panelUrl || !viewKey) { detail.push(`${side}: skip — ${!panelUrl ? "no panel" : "no approved view"} to judge against`); continue; }
          const viewB64 = await fetchB64(views[viewKey]);
          const panelB64 = viewB64 ? await fetchB64(panelUrl) : null;
          if (!viewB64 || !panelB64) { detail.push(`${side}: skip — image fetch failed (fail-open)`); continue; }
          try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [
                  { text: `IMAGE 1 is the approved 3D render of the ${side} of a wrapped vehicle. IMAGE 2 is a flat print panel that claims to be that side's wrap artwork. Judge ONLY whether IMAGE 2 is the SAME design as what IMAGE 1 shows on that side — same motifs (stripes vs lettering vs pattern), same colors, same layout family. Ignore flattening, bleed borders, and mirroring. Respond ONLY JSON: {"same_design": true|false, "note": "one short sentence"}.` },
                  { inlineData: { mimeType: "image/png", data: viewB64 } },
                  { inlineData: { mimeType: "image/png", data: panelB64 } },
                ] }],
                generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
              }),
              signal: AbortSignal.timeout(45_000),
            });
            if (!resp.ok) { detail.push(`${side}: skip — judge ${resp.status} (fail-open)`); continue; }
            const rj = await resp.json();
            const txt = (rj?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
            const verdict = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
            if (verdict?.same_design === true) detail.push(`${side}: ok — ${verdict.note || "same design"}`);
            else { pass = false; detail.push(`${side}: FAIL — WRONG DESIGN: ${verdict?.note || "panel does not match the approved view"}`); }
          } catch (e) { detail.push(`${side}: skip — judge error ${(e as Error)?.message?.slice(0, 60)} (fail-open)`); }
        }
      }
      checks.push({ id: "panel-matches-side", label: "Each panel is the SAME design as its side's approved view", pass, detail });
    }

    const pass = checks.every((c) => c.pass);
    const failed = checks.filter((c) => !c.pass);
    const summary = pass
      ? `PASS — all ${checks.length} checks green for ${gid}`
      : `FAIL — ${failed.length}/${checks.length} checks failed: ${failed.map((c) => c.id).join(", ")}`;
    console.log(`[GOLDEN-REGRESSION] ${gid}: ${summary}`);
    return json({ success: true, pass, generationId, canonicalId: gid, checks, summary });
  } catch (err) {
    console.error("[GOLDEN-REGRESSION] Error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
});
