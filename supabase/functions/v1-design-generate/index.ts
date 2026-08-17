/**
 * v1-design-generate — PUBLIC B2B API wrapper.
 * Chains the EXISTING in-platform pipeline (no rebuild, no new schema):
 *   design-panel-ai-generate → designpro-parse-brief →
 *   designpro-text-layer-generate → designpro-persist-assets
 * Returns the TRUE separated layers (background_template + independent overlay
 * layers w/ normalized coordinates) + the deterministic print-ready panel specs
 * (2" bleed). Locked engine untouched; system-user auth; key-gated.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./_shared/cors.ts";

const VIEW_LABELS: Record<string, string> = {
  "driver-side": "driver_side", side: "driver_side", "passenger-side": "passenger_side",
  front: "front", hood: "hood", rear: "rear", roof: "roof",
};

// Deterministic WPW print-panel specs (inches). Per-vehicle exact sizing happens
// in the production-pack job; this is the standard print-ready array + 2" bleed.
const BLEED = 2;
const PRINT_PANELS = [
  { id: "driver-side", label: "Driver Side", widthInches: 172, heightInches: 59.5, mirrored: false },
  { id: "passenger-side", label: "Passenger Side", widthInches: 172, heightInches: 59.5, mirrored: true },
  { id: "hood", label: "Hood", widthInches: 60, heightInches: 60, mirrored: false },
  { id: "roof", label: "Roof", widthInches: 60, heightInches: 120, mirrored: false },
  { id: "rear", label: "Rear", widthInches: 60, heightInches: 48, mirrored: false },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const publicKey = Deno.env.get("PUBLIC_API_KEY");
  if (!publicKey) return json({ error: "API not configured (PUBLIC_API_KEY unset)" }, 503);
  if (req.headers.get("x-api-key") !== publicKey) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sysEmail = Deno.env.get("SYSTEM_USER_EMAIL");
  const sysPassword = Deno.env.get("SYSTEM_USER_PASSWORD");
  if (!sysEmail || !sysPassword) return json({ error: "API not configured (SYSTEM_USER_EMAIL/PASSWORD unset)" }, 503);

  let sysToken = "", sysUserId = "";
  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: signIn } = await authClient.auth.signInWithPassword({ email: sysEmail, password: sysPassword });
    sysToken = signIn?.session?.access_token || "";
    sysUserId = signIn?.user?.id || "";
  } catch { /* 502 below */ }
  if (!sysToken) return json({ error: "System auth failed — check the system user + SYSTEM_USER_* secrets" }, 502);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const vehicle = body?.vehicle || {};
  const brief = body?.design_brief || {};
  const assets = body?.brand_assets || {};
  if (!brief?.prompt) return json({ error: "design_brief.prompt is required" }, 400);

  const mode = assets?.logo_url ? "commercial" : "restyle";
  const hexColors = [brief.primary_color, brief.accent_color].filter((c: any) => /^#[0-9a-fA-F]{6}$/.test(c || ""));
  const prompt = hexColors.length ? `${brief.prompt} (colors: ${hexColors.join(", ")})` : brief.prompt;
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${sysToken}` };
  const call = async (fn: string, payload: any) => {
    const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, { method: "POST", headers: auth, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  };

  // 1) RENDER (locked engine)
  let render: any;
  try {
    const r = await call("design-panel-ai-generate", {
      mode, prompt, companyName: assets?.company_name,
      year: vehicle?.year ? String(vehicle.year) : undefined, make: vehicle?.make, model: vehicle?.model,
      visionBoardImages: assets?.logo_url ? [{ slotLabel: "Logo", storageUrl: assets.logo_url }] : undefined,
    });
    if (!r.ok) return json({ status: "error", error: r.data?.error || `Engine ${r.status}` }, 502);
    render = r.data;
  } catch (e: any) { return json({ status: "error", error: e?.message || "Engine call failed" }, 502); }

  const generationId = render?.generationId || render?.generation_id;
  const renderUrl = render?.renderUrl || render?.render_url;
  if (!generationId) return json({ status: "error", error: "No generation_id returned" }, 502);

  // 2) PARSE BRIEF → layer pieces  (existing fn)
  let pieces: any[] = [];
  try {
    const p = await call("designpro-parse-brief", { prompt: brief.prompt, companyName: assets?.company_name, industry: brief.industry });
    if (Array.isArray(p.data?.pieces)) pieces = p.data.pieces;
  } catch { /* non-fatal */ }

  // 3) TEXT/LOGO LAYER ISOLATION → transparent overlay PNGs  (existing fn)
  let overlays: any[] = [];
  if (pieces.length) {
    try {
      const t = await call("designpro-text-layer-generate", {
        companyName: assets?.company_name, industry: brief.industry,
        ...(hexColors.length ? { brandColors: hexColors } : {}), pieces,
      });
      if (Array.isArray(t.data?.objects)) overlays = t.data.objects;
    } catch { /* non-fatal */ }
  }

  // 4) PERSIST separated assets  (existing fn)
  if (renderUrl || overlays.length) {
    try {
      await call("designpro-persist-assets", {
        generation_id: generationId, user_id: sysUserId,
        background_url: renderUrl || undefined,
        overlay_pngs: overlays.map((o: any) => ({ id: o.id, kind: o.kind, role: o.role, text: o.text, url: o.imageUrl })),
        source: "v1-api",
      });
    } catch { /* non-fatal */ }
  }

  // 5) BUILD layered payload from the persisted assets
  const sb = createClient(supabaseUrl, serviceKey);
  const { data: asset } = await sb.from("design_generation_assets")
    .select("background_url, view_urls, overlay_pngs, layer_layout")
    .eq("generation_id", generationId).eq("is_current", true)
    .order("iteration_index", { ascending: false }).limit(1).maybeSingle();

  const viewUrls: Record<string, string> =
    (asset?.view_urls && typeof asset.view_urls === "object" ? asset.view_urls : null) ||
    (renderUrl ? { "driver-side": renderUrl } : {});
  const overlaySrc: any[] = (Array.isArray(asset?.overlay_pngs) && asset!.overlay_pngs.length)
    ? asset!.overlay_pngs
    : overlays.map((o: any) => ({ id: o.id, kind: o.kind, role: o.role, text: o.text, url: o.imageUrl }));
  const layout: Record<string, any> = (asset?.layer_layout as any) || {};

  const views: Record<string, any> = {};
  for (const [key, bg] of Object.entries(viewUrls)) {
    if (!bg) continue;
    const viewLayout = layout[key]?.overlays || overlaySrc;
    views[VIEW_LABELS[key] || key] = {
      background_template: asset?.background_url || bg,
      composed_render: bg,
      overlay_layers: (Array.isArray(viewLayout) ? viewLayout : []).map((o: any, i: number) => ({
        layer_id: o.id || `layer_${i}`,
        type: o.isLogo || o.kind === "logo" ? "vector_svg" : "vector_text",
        source_url: o.url || o.imageUrl,
        text: o.text, role: o.role,
        default_coordinates: { x: Math.round(o.x ?? 0), y: Math.round(o.y ?? 0), scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1, rotation: o.rotation ?? 0 },
      })),
    };
  }

  // Deterministic print-ready panel specs (2" bleed all sides)
  const print_panels = PRINT_PANELS.map((p) => ({
    id: p.id, label: p.label, mirrored: p.mirrored,
    finished: { width_in: p.widthInches, height_in: p.heightInches },
    print_with_bleed: { width_in: p.widthInches + BLEED * 2, height_in: p.heightInches + BLEED * 2, bleed_in: BLEED },
  }));

  return json({
    generation_id: generationId,
    status: "success",
    branded_pipeline: "LayerLiftIQ-Engine-V10",
    coordinate_system: "Normalized-Stage-Matrix",
    design_name: render?.designName || null,
    layers_separated: overlaySrc.length,
    views,
    print_panels,
    production_pack: { note: "Print-ready TIFF/ZIP is produced by the G.E.N.I.E. slicer (process-production-pack) as a job.", route: "/api/process-production-pack" },
  });
});
