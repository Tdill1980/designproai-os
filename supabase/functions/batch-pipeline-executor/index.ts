/**
 * batch-pipeline-executor
 *
 * Server-side batch render pipeline. Runs independently of the browser UI so you
 * can fire one batch from the admin panel AND one from this edge function at the
 * same time — doubling output.
 *
 * POST body:
 * {
 *   "presets": true,                          // Use built-in TEST_PRESETS (25 renders)
 *   --- OR ---
 *   "customPrompts": [                        // Custom prompt array (any size)
 *     {
 *       "tool": "designpro",
 *       "designName": "My Design",
 *       "prompt": "Full design prompt...",
 *       "vehicle": { "year": "2024", "make": "Ford", "model": "F-150" },
 *       "finish": "Gloss",
 *       "mode": "commercial"                  // "commercial" or "restyle"
 *     }
 *   ],
 *   --- OR ---
 *   "vehicles": [{ "year": "2024", "make": "Ford", "model": "F-150" }],
 *   "tools": ["colorpro", "fadewraps"],       // Which tools to run
 *   "quantityPerCombo": 1,                    // Renders per vehicle×tool (max 10)
 *   --- OPTIONAL ---
 *   "userEmail": "admin@example.com",         // Email for render auth + persistence
 *   "concurrency": 2,                         // Simultaneous renders (1-3, default 1)
 *   "generateViews": true,                    // Generate 7 camera views per render (default true)
 *   "delayMs": 3000                           // Delay between renders (default 3000)
 * }
 *
 * Returns streamed JSON progress, final summary:
 * { "batchId": "...", "completed": 20, "failed": 5, "totalViews": 140, "results": [...] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolType = "designpro" | "colorpro" | "fadewraps" | "wbty" | "approvemode";

interface Vehicle { year: string; make: string; model: string; }

interface JobResult {
  tool: ToolType;
  designName: string;
  vehicle: Vehicle;
  renderUrl: string | null;
  panelUrl: string | null;
  views: Record<string, string>;
  status: "done" | "failed";
  error: string | null;
  durationMs: number;
  visualizationId: string | null;
}

// ─── Built-in test presets (mirrors client-side TEST_PRESETS) ─────────────────

interface Preset {
  tool: ToolType;
  designName: string;
  prompt: string;
  vehicle: Vehicle;
  finish: string;
  edgePayload: Record<string, unknown>;
}

const TEST_PRESETS: Preset[] = [
  // ── DesignProAI (5) ──────────────────────────────────────────────────
  {
    tool: "designpro",
    designName: "Martinez Brothers Plumbing",
    prompt: "Design Type: Commercial. Company: Martinez Brothers Plumbing & Heating. Navy blue base color on the full truck. Company name 'MARTINEZ BROTHERS' large across both sides in bold white lettering. Below that 'Plumbing & Heating' in a clean condensed font. Phone number (602) 555-0173 on the tailgate and both rear quarter panels. Licensed bonded insured badge on the rear doors. Website martinezplumbing.com along the bottom rocker panels. Professional, clean, trustworthy.",
    vehicle: { year: "2024", make: "Ford", model: "F-150" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Ember & Oak BBQ",
    prompt: "Design Type: Commercial. Company: Ember & Oak BBQ Smokehouse. Deep charcoal black base. Warm smoke-stained wood grain texture on lower third. Company name 'EMBER & OAK' in large weathered copper lettering. 'Slow Smoked BBQ Since 2019' in rustic serif. Catering (512) 555-0847 on tailgate. Website emberandoak.com. Warm orange/amber tones.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Silverado" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Obsidian Fracture",
    prompt: "Design Type: ReStyle. Split-tone: obsidian black top half, polished gunmetal silver bottom. Sharp fractured split line — jagged volcanic glass from nose to tail along beltline. Thin veins of molten copper in the cracks. Real automotive paint, showroom quality two-tone.",
    vehicle: { year: "2024", make: "McLaren", model: "720S" },
    finish: "Gloss",
    edgePayload: { mode: "restyle" },
  },
  {
    tool: "designpro",
    designName: "Summit Electric Co.",
    prompt: "Design Type: Commercial. Company: Summit Electric Co. Bright safety yellow base. 'SUMMIT ELECTRIC' large bold black block letters. 'Residential | Commercial | Industrial' below. Phone (480) 555-0291 on both sides and rear. ROC# 298541. '24/7 Emergency Service' in red. summitelectricaz.com on hood. High visibility, high trust.",
    vehicle: { year: "2024", make: "Ram", model: "ProMaster 2500" },
    finish: "Gloss",
    edgePayload: { mode: "commercial" },
  },
  {
    tool: "designpro",
    designName: "Phantom Veil",
    prompt: "Design Type: ReStyle. Full satin midnight blue, almost black indoors, reveals deep blue under direct light. Two thin brushed titanium silver racing stripes from hood scoop over roof to rear decklid, 3 inches apart. Subtle, refined. Gentleman racer aesthetic.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Corvette C8" },
    finish: "Satin",
    edgePayload: { mode: "restyle" },
  },

  // ── ColorPro (5) ─────────────────────────────────────────────────────
  {
    tool: "colorpro",
    designName: "KPMF Tiffany Blue",
    prompt: "Full color change in KPMF Tiffany Blue gloss. Robin's egg blue with a hint of green — jewelry box blue. All painted panels edge to edge.",
    vehicle: { year: "2024", make: "Ferrari", model: "F8 Tributo" },
    finish: "Gloss",
    edgePayload: { colorData: { colorName: "Tiffany Blue", hex: "#81D8D0", finish: "Gloss", colorLibrary: "kpmf" } },
  },
  {
    tool: "colorpro",
    designName: "Avery Nardo Gray",
    prompt: "Full color change in Avery Dennison Nardo Gray satin. Flat battleship gray, no shine, no sparkle, confident understated.",
    vehicle: { year: "2024", make: "Lamborghini", model: "Huracán" },
    finish: "Satin",
    edgePayload: { colorData: { colorName: "Nardo Gray", hex: "#8C8C8C", finish: "Satin", colorLibrary: "avery-dennison" } },
  },
  {
    tool: "colorpro",
    designName: "3M Riviera Blue",
    prompt: "Full color change in 3M Gloss Riviera Blue. Intense electric blue with ocean depth — not baby blue, not navy.",
    vehicle: { year: "2024", make: "Porsche", model: "911 GT3" },
    finish: "Gloss",
    edgePayload: { colorData: { colorName: "Riviera Blue", hex: "#009FE3", finish: "Gloss", colorLibrary: "3m" } },
  },
  {
    tool: "colorpro",
    designName: "3M Acid Green Matte",
    prompt: "Full color change in 3M Matte Acid Green. Screaming neon yellow-green, completely flat finish, zero reflections.",
    vehicle: { year: "2024", make: "BMW", model: "M4" },
    finish: "Matte",
    edgePayload: { colorData: { colorName: "Acid Green", hex: "#B0BF1A", finish: "Matte", colorLibrary: "3m" } },
  },
  {
    tool: "colorpro",
    designName: "Avery Black Rose Metallic",
    prompt: "Full color change in Avery Dennison Black Rose Metallic gloss. Deep dark burgundy, reads black from distance, catches wine red and plum metallic up close.",
    vehicle: { year: "2024", make: "Mercedes-AMG", model: "GT" },
    finish: "Gloss",
    edgePayload: { colorData: { colorName: "Black Rose Metallic", hex: "#3B0A1E", finish: "Gloss", colorLibrary: "avery-dennison" } },
  },

  // ── FadeWraps (5) ────────────────────────────────────────────────────
  {
    tool: "fadewraps",
    designName: "Magma Flow",
    prompt: "Top-to-bottom fade. Burnt orange at roofline melting into pure black at rockers. 8 inches of smooth gradient at beltline.",
    vehicle: { year: "2024", make: "Lamborghini", model: "Urus" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Magma Flow", hex: "#FF6B00", finish: "Gloss", fadeSpec: { direction: "top-to-bottom", colorFrom: "#FF6B00", colorTo: "#0A0A0A", style: "smooth" } },
      customStylingPrompt: "Top-to-bottom fade from burnt orange at the roofline melting smoothly into pure black at the rocker panels. Transition zone at the beltline, about 8 inches of smooth gradient.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Deep Current",
    prompt: "Front-to-rear fade. Midnight navy blue at front bumper sweeping back through medium blue at doors into bright metallic silver at rear quarters.",
    vehicle: { year: "2024", make: "Cadillac", model: "Escalade" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Deep Current", hex: "#0A1628", finish: "Gloss", fadeSpec: { direction: "front-to-rear", colorFrom: "#0A1628", colorTo: "#C0C0C0", style: "smooth" } },
      customStylingPrompt: "Front-to-rear horizontal fade from midnight navy blue at the front bumper sweeping back through medium blue at the doors into bright metallic silver at the rear quarters.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Rosé Dusk",
    prompt: "Soft blush pink at roof fading into clean pearl white at bottom of doors. Gentle, smooth, feminine but refined.",
    vehicle: { year: "2024", make: "Nissan", model: "Z" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Rosé Dusk", hex: "#FFB7C5", finish: "Gloss", fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFB7C5", colorTo: "#F5F5F0", style: "smooth" } },
      customStylingPrompt: "Soft blush pink at the roof fading smoothly into clean pearl white at the bottom. Gentle and smooth gradient.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Ultraviolet Shift",
    prompt: "Satin diagonal fade. Deep electric purple at hood/front fenders, fading diagonally into true black at rear bumper. Stealth and moody.",
    vehicle: { year: "2024", make: "Ford", model: "Mustang GT" },
    finish: "Satin",
    edgePayload: {
      colorData: { colorName: "Ultraviolet Shift", hex: "#8B00FF", finish: "Satin", fadeSpec: { direction: "diagonal", colorFrom: "#8B00FF", colorTo: "#050510", style: "smooth" } },
      customStylingPrompt: "Deep electric purple at the front fading diagonally into true black at the rear. Vivid saturated purple on hood and front fenders gradually losing intensity. Satin finish, stealth and moody.",
    },
  },
  {
    tool: "fadewraps",
    designName: "Emerald Sovereign",
    prompt: "Front-to-rear fade from rich emerald green at nose into warm champagne gold at tail. British racing green melting through forest green into gold. Looks like money.",
    vehicle: { year: "2024", make: "Lexus", model: "LC 500" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Emerald Sovereign", hex: "#006B3C", finish: "Gloss", fadeSpec: { direction: "front-to-rear", colorFrom: "#006B3C", colorTo: "#D4AF37", style: "smooth" } },
      customStylingPrompt: "Rich emerald green at the front flowing rearward into warm champagne gold. British racing green at the nose through forest green at doors into champagne gold at rear quarters.",
    },
  },

  // ── PatternPro / WBTY (5) ───────────────────────────────────────────
  {
    tool: "wbty",
    designName: "Timber Ridge Camo",
    prompt: "Realistic woodland camouflage. Oak leaves, pine branches, bark textures. Autumn browns, olive greens, tan. Like real Mossy Oak printed film.",
    vehicle: { year: "2024", make: "Jeep", model: "Grand Cherokee Trackhawk" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Timber Ridge Camo", hex: "#4A5D23", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Realistic woodland camouflage — oak leaves, pine branches, bark textures in autumn browns, olive greens, and tan. Like real Mossy Oak printed film. Matte flat finish.",
    },
  },
  {
    tool: "wbty",
    designName: "Forged Carbon",
    prompt: "Forged carbon fiber pattern — chopped swirled random carbon fiber strands like Lamborghini factory carbon. Marbled swirl with random fiber orientation. High-gloss clearcoat.",
    vehicle: { year: "2024", make: "Porsche", model: "911 GT3" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Forged Carbon", hex: "#1A1A1A", finish: "Gloss", colorLibrary: "pattern" },
      customStylingPrompt: "Forged carbon fiber pattern — chopped swirled random carbon fiber strands. Marbled swirl with random fiber orientation. Black and dark gray fibers, high-gloss clearcoat.",
    },
  },
  {
    tool: "wbty",
    designName: "Heritage Stripe",
    prompt: "Pearl white base. Three thin parallel racing stripes — dark navy, red, light blue — from front lip over hood, across roof, down rear decklid. Clean Martini Racing style.",
    vehicle: { year: "1969", make: "Ford", model: "Mustang Boss 302" },
    finish: "Gloss",
    edgePayload: {
      colorData: { colorName: "Heritage Stripe", hex: "#F5F5F0", finish: "Gloss", colorLibrary: "pattern" },
      customStylingPrompt: "Pearl white full body with three thin parallel racing stripes — dark navy, red, light blue — running from front lip over hood, across roof, down rear decklid. Classic Martini Racing style.",
    },
  },
  {
    tool: "wbty",
    designName: "Operator Hex",
    prompt: "Digital hexagonal military camo in flat dark earth and olive drab. Hexagon tiles shifting between three shades of military green and brown. Tactical, flat finish.",
    vehicle: { year: "2024", make: "Chevrolet", model: "Silverado" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Operator Hex", hex: "#5C5B3A", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Digital hexagonal military camo in flat dark earth and olive drab green. Small hexagon tiles shifting between three shades of military green and brown. Completely matte flat finish.",
    },
  },
  {
    tool: "wbty",
    designName: "Black Widow",
    prompt: "Full body matte black with red pinstripe along lower rocker panels that widens to a diamond shape at center of each door. Murdered out with one red accent.",
    vehicle: { year: "1970", make: "Chevrolet", model: "Chevelle SS" },
    finish: "Matte",
    edgePayload: {
      colorData: { colorName: "Black Widow", hex: "#0A0A0A", finish: "Matte", colorLibrary: "pattern" },
      customStylingPrompt: "Full body matte black with a red pinstripe along the lower rocker panels that widens to a small diamond at center of each door. Murdered out black on black with one red accent.",
    },
  },
];

// Top 20 vehicles for auto-assignment when customPrompts don't specify vehicles
const TOP_VEHICLES: Vehicle[] = [
  { year: "2024", make: "Ford", model: "F-150" },
  { year: "2024", make: "Chevrolet", model: "Silverado" },
  { year: "2024", make: "Ram", model: "1500" },
  { year: "2024", make: "Toyota", model: "Tacoma" },
  { year: "2024", make: "Ford", model: "Transit" },
  { year: "2024", make: "Mercedes-Benz", model: "Sprinter" },
  { year: "2024", make: "Ram", model: "ProMaster 2500" },
  { year: "2024", make: "Chevrolet", model: "Express" },
  { year: "2024", make: "Ford", model: "E-Transit" },
  { year: "2024", make: "Toyota", model: "Tundra" },
  { year: "2024", make: "Nissan", model: "NV200" },
  { year: "2024", make: "GMC", model: "Sierra" },
  { year: "2024", make: "Ford", model: "Ranger" },
  { year: "2024", make: "Chevrolet", model: "Colorado" },
  { year: "2024", make: "Ford", model: "Mustang" },
  { year: "2024", make: "Chevrolet", model: "Corvette C8" },
  { year: "2024", make: "BMW", model: "M4" },
  { year: "2024", make: "Porsche", model: "911 GT3" },
  { year: "2024", make: "Tesla", model: "Model 3" },
  { year: "2024", make: "Lamborghini", model: "Huracán" },
];

const VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

const MODE_TYPE_MAP: Record<string, string> = {
  designpro: "designpanelpro",
  colorpro: "colorpro",
  fadewraps: "fadewraps",
  wbty: "wbty",
  approvemode: "approvemode",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Call another Supabase edge function via HTTP */
async function invokeEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  authToken: string,
): Promise<{ data: any; error: string | null }> {
  const supabaseUrl = getExternalSupabaseUrl();
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const serviceKey = getExternalServiceRoleKey();

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { data: null, error: `HTTP ${resp.status}: ${errText.substring(0, 300)}` };
    }

    const data = await resp.json();
    if (data.error) {
      return { data, error: data.error };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Render one job — calls the appropriate edge function with retries */
async function renderOneJob(
  preset: Preset,
  email: string,
  authToken: string,
): Promise<{ renderUrl: string | null; panelUrl: string | null; error: string | null; durationMs: number }> {
  const t0 = Date.now();
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (preset.tool === "designpro") {
        // Two-stage DesignPro pipeline:
        // 1) design-panel-ai-generate → creates the panel design from prompt
        // 2) generate-color-render → photorealistic render on vehicle using the panel
        const panelBody = {
          mode: (preset.edgePayload.mode as string) || "restyle",
          prompt: preset.prompt,
          finish: preset.finish,
          vehicleYear: preset.vehicle.year,
          vehicleMake: preset.vehicle.make,
          vehicleModel: preset.vehicle.model,
        };

        const { data: panelData, error: panelError } = await invokeEdgeFunction("design-panel-ai-generate", panelBody, authToken);
        if (panelError) throw new Error(panelError);

        const panelUrl = panelData?.panel?.media_url || panelData?.renderUrl || null;
        if (!panelUrl) throw new Error("No panel returned from design-panel-ai-generate");

        // Stage 2: Render photorealistically via generate-color-render
        const renderBody = {
          vehicleYear: preset.vehicle.year,
          vehicleMake: preset.vehicle.make,
          vehicleModel: preset.vehicle.model,
          modeType: "designpanelpro",
          viewType: "side",
          userEmail: email,
          skipCacheStorage: true,
          colorData: {
            panelUrl,
            panelName: preset.designName,
            finish: preset.finish,
          },
        };

        const { data: renderData, error: renderError } = await invokeEdgeFunction("generate-color-render", renderBody, authToken);
        if (renderError) throw new Error(renderError);
        if (!renderData?.renderUrl) throw new Error("No render returned from generate-color-render");

        return {
          renderUrl: renderData.renderUrl,
          panelUrl,
          error: null,
          durationMs: Date.now() - t0,
        };
      }

      // ColorPro, FadeWraps, WBTY → generate-color-render
      const colorData = (preset.edgePayload.colorData as Record<string, unknown>) || {};
      const customStylingPrompt = (preset.edgePayload.customStylingPrompt as string) || preset.prompt;

      const body = {
        vehicleYear: preset.vehicle.year,
        vehicleMake: preset.vehicle.make,
        vehicleModel: preset.vehicle.model,
        modeType: preset.tool,
        viewType: "side",
        userEmail: email,
        customStylingPrompt,
        skipCacheStorage: true, // Batch pipeline persists separately
        colorData: {
          ...colorData,
          finish: preset.finish,
        },
      };

      const { data, error } = await invokeEdgeFunction("generate-color-render", body, authToken);
      if (error) throw new Error(error);
      if (!data?.renderUrl) throw new Error("No image returned");

      return {
        renderUrl: data.renderUrl,
        panelUrl: null,
        error: null,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BatchExec] Render attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);

      if (attempt < MAX_RETRIES) {
        const backoff = 3000 * Math.pow(2, attempt - 1);
        await delay(backoff);
        continue;
      }

      return { renderUrl: null, panelUrl: null, error: msg, durationMs: Date.now() - t0 };
    }
  }

  return { renderUrl: null, panelUrl: null, error: "Max retries exceeded", durationMs: Date.now() - t0 };
}

// Camera angle descriptions — reference only (not used at runtime).
// Actual angles come from view-angles-os.ts via generate-color-render's getCameraAngle().
// Kept here for documentation. Must match VIEW_ORDER above.
const VIEW_ANGLE_PROMPTS: Record<string, string> = {
  "side": "Straight-on driver side profile, door handle height, perpendicular to vehicle body.",
  "passenger-side": "Straight-on passenger side (right side) profile, mirror of driver side.",
  "hood_detail": "Overhead looking down at hood surface, 45-60 degrees.",
  "front": "Straight-on front view, centered on grille. Symmetrical left-right.",
  "rear": "Straight-on rear view, centered on tailgate. Symmetrical left-right.",
  "close-up": "12 inches from body panel, angled to show body curves and vinyl texture.",
  "roof": "Bird's-eye overhead, straight down at roof surface.",
};

/** Generate 7 camera views for a successful render */
async function generateViews(
  preset: Preset,
  renderUrl: string,
  panelUrl: string | null,
  email: string,
  authToken: string,
): Promise<Record<string, string>> {
  const views: Record<string, string> = {};
  let completed = 0;

  for (const viewType of VIEW_ORDER) {
    let viewUrl: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // DesignProAI renders: use generate-color-render with panelUrl from initial render
        // This uses the same photorealism pipeline as the client-side DesignProAI tool.
        if (preset.tool === "designpro") {
          const body = {
            vehicleYear: preset.vehicle.year,
            vehicleMake: preset.vehicle.make,
            vehicleModel: preset.vehicle.model,
            modeType: "designpanelpro",
            viewType,
            userEmail: email,
            skipCacheStorage: true,
            colorData: {
              panelUrl: panelUrl || renderUrl,
              panelName: preset.designName,
              finish: preset.finish,
            },
            skipLookups: completed > 0,
          };

          const { data, error } = await invokeEdgeFunction("generate-color-render", body, authToken);

          if (!error && data?.renderUrl) {
            viewUrl = data.renderUrl;
            break;
          }
        } else {
          // ColorPro, FadeWraps, WBTY → use generate-color-render (correct for these tools)
          const colorData = (preset.edgePayload.colorData as Record<string, unknown>) || {};
          const customStylingPrompt = (preset.edgePayload.customStylingPrompt as string) || preset.prompt;

          const body: Record<string, unknown> = {
            vehicleYear: preset.vehicle.year,
            vehicleMake: preset.vehicle.make,
            vehicleModel: preset.vehicle.model,
            modeType: MODE_TYPE_MAP[preset.tool] || preset.tool,
            viewType,
            userEmail: email,
            customStylingPrompt,
            skipCacheStorage: true, // Batch pipeline persists separately
            colorData: {
              ...colorData,
              finish: preset.finish,
            },
            skipLookups: completed > 0,
          };

          const { data, error } = await invokeEdgeFunction("generate-color-render", body, authToken);

          if (!error && data?.renderUrl) {
            viewUrl = data.renderUrl;
            break;
          }
        }
      } catch {
        /* retry */
      }

      if (attempt < 2) {
        await delay(3000);
      }
    }

    if (viewUrl) {
      views[viewType] = viewUrl;
    }

    completed++;

    // Rate limiting between views — 5s stagger for Tier 1 (20 RPM)
    if (completed < VIEW_ORDER.length) {
      await delay(5000);
    }
  }

  return views;
}

/** Persist a completed render to color_visualizations */
async function persistRender(
  supabase: ReturnType<typeof createExternalClient>,
  preset: Preset,
  renderUrl: string,
  panelUrl: string | null,
  views: Record<string, string>,
  batchId: string,
  email: string,
  durationMs: number,
): Promise<string | null> {
  try {
    const renderUrls: Record<string, string> = {};
    if (renderUrl) renderUrls.side = renderUrl;
    for (const [key, url] of Object.entries(views)) {
      renderUrls[key] = url;
    }
    if (panelUrl) renderUrls.panel = panelUrl;

    const adminNotes = JSON.stringify({
      batch: true,
      batch_id: batchId,
      tool: preset.tool,
      original_prompt: preset.prompt,
      design_name: preset.designName,
      duration_ms: durationMs,
      panel_url: panelUrl,
      views_generated: Object.keys(views).length,
      source: "server-side-executor",
    });

    const { data } = await supabase.from("color_visualizations").insert({
      customer_email: email,
      vehicle_year: parseInt(preset.vehicle.year) || 2024,
      vehicle_make: preset.vehicle.make,
      vehicle_model: preset.vehicle.model,
      color_name: preset.designName,
      color_hex: ((preset.edgePayload?.colorData as Record<string, unknown>)?.hex as string) || "#000000",
      finish_type: preset.finish,
      mode_type: MODE_TYPE_MAP[preset.tool] || preset.tool,
      render_urls: renderUrls,
      admin_notes: adminNotes,
      design_file_name: `${preset.designName} — ${preset.vehicle.year} ${preset.vehicle.make} ${preset.vehicle.model} [Server Batch ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}]`,
      generation_status: "completed",
      subscription_tier: "admin",
    }).select("id").single();

    return data?.id || null;
  } catch (err) {
    console.error("[BatchExec] Persist failed:", err);
    return null;
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createExternalClient();
    const serviceKey = getExternalServiceRoleKey();

    // ── Determine user email ──
    // Try auth header first, then fall back to body.userEmail
    let email = body.userEmail || null;
    let authToken = serviceKey; // Default: use service role for internal calls

    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const supabaseUrl = getExternalSupabaseUrl();
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      if (user?.email) {
        email = user.email;
        // Always use serviceKey for internal calls — user JWTs expire during long batches
        authToken = serviceKey;
      }
    }

    if (!email) {
      return new Response(
        JSON.stringify({ error: "userEmail required in body or valid auth header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build job queue ──
    const usePresets = body.presets === true;
    const concurrency = Math.min(Math.max(body.concurrency || 1, 1), 3);
    const doViews = body.generateViews !== false;
    const delayMs = body.delayMs || 3000;

    let queue: Preset[];

    if (body.customPrompts?.length) {
      // Custom prompts array — any number of prompts with full control
      const FINISHES = ["Gloss", "Satin", "Matte"];
      queue = (body.customPrompts as Array<{
        tool?: string;
        designName?: string;
        prompt: string;
        vehicle?: Vehicle;
        finish?: string;
        mode?: string;
      }>).map((cp, i) => ({
        tool: (cp.tool || "designpro") as ToolType,
        designName: cp.designName || `Design #${i + 1}`,
        prompt: cp.prompt,
        vehicle: cp.vehicle || TOP_VEHICLES[i % TOP_VEHICLES.length],
        finish: cp.finish || FINISHES[i % FINISHES.length],
        edgePayload: { mode: cp.mode || "commercial" },
      }));
    } else if (usePresets) {
      // Filter to specific tools if provided
      const toolFilter: ToolType[] | null = body.tools?.length ? body.tools : null;
      queue = toolFilter
        ? TEST_PRESETS.filter(p => toolFilter.includes(p.tool))
        : [...TEST_PRESETS];
    } else if (body.vehicles?.length && body.tools?.length) {
      // Custom batch: vehicles × tools × quantity
      const qty = Math.min(body.quantityPerCombo || 1, 10);
      queue = [];

      for (const vehicle of body.vehicles as Vehicle[]) {
        for (const tool of body.tools as ToolType[]) {
          const template = TEST_PRESETS.find(p => p.tool === tool);
          for (let q = 0; q < qty; q++) {
            queue.push({
              tool,
              designName: template?.designName || `${tool} render #${q + 1}`,
              prompt: body.customPrompt || template?.prompt || `Generate a ${tool} render for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              vehicle,
              finish: template?.finish || "Gloss",
              edgePayload: template?.edgePayload || {},
            });
          }
        }
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Provide 'presets: true', 'customPrompts', or 'vehicles' + 'tools' arrays" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const batchId = `server_batch_${Date.now()}`;
    const totalJobs = queue.length;
    const totalExpectedViews = doViews ? totalJobs * VIEW_ORDER.length : 0;

    console.log(`[BatchExec] Starting batch ${batchId}: ${totalJobs} renders, concurrency=${concurrency}, views=${doViews}`);
    console.log(`[BatchExec] Estimated: ${totalJobs} renders + ${totalExpectedViews} views = ${totalJobs + totalExpectedViews} total Gemini calls`);

    // ── Phase 1: Generate initial renders ──
    const results: JobResult[] = [];
    const designProPanels: Record<number, string> = {};
    let dpIdx = 0;

    // Process in batches of `concurrency`
    for (let batchStart = 0; batchStart < queue.length; batchStart += concurrency) {
      const batchEnd = Math.min(batchStart + concurrency, queue.length);
      const batchPromises: Promise<void>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const preset = queue[i];
        const jobIdx = i;

        batchPromises.push((async () => {
          console.log(`[BatchExec] [${i + 1}/${totalJobs}] Rendering: ${preset.designName} (${preset.tool})`);

          const result = await renderOneJob(preset, email, authToken);

          // Save DesignPro panels for potential ApprovePro use
          if (preset.tool === "designpro" && result.renderUrl) {
            designProPanels[dpIdx++] = result.panelUrl || result.renderUrl;
          }

          if (result.renderUrl) {
            // Persist immediately (before views)
            const vizId = await persistRender(
              supabase, preset, result.renderUrl, result.panelUrl,
              {}, batchId, email, result.durationMs,
            );

            // Generate views if enabled
            let views: Record<string, string> = {};
            if (doViews) {
              console.log(`[BatchExec] [${i + 1}/${totalJobs}] Generating ${VIEW_ORDER.length} views...`);
              views = await generateViews(preset, result.renderUrl, result.panelUrl, email, authToken);

              // Update the persisted record with views
              if (vizId && Object.keys(views).length > 0) {
                const renderUrls: Record<string, string> = { side: result.renderUrl };
                for (const [key, url] of Object.entries(views)) {
                  renderUrls[key] = url;
                }
                if (result.panelUrl) renderUrls.panel = result.panelUrl;

                await supabase.from("color_visualizations")
                  .update({ render_urls: renderUrls })
                  .eq("id", vizId);
              }
            }

            results.push({
              tool: preset.tool,
              designName: preset.designName,
              vehicle: preset.vehicle,
              renderUrl: result.renderUrl,
              panelUrl: result.panelUrl,
              views,
              status: "done",
              error: null,
              durationMs: result.durationMs,
              visualizationId: vizId,
            });

            console.log(`[BatchExec] [${i + 1}/${totalJobs}] DONE: ${preset.designName} (${Object.keys(views).length} views, ${(result.durationMs / 1000).toFixed(1)}s)`);
          } else {
            results.push({
              tool: preset.tool,
              designName: preset.designName,
              vehicle: preset.vehicle,
              renderUrl: null,
              panelUrl: null,
              views: {},
              status: "failed",
              error: result.error,
              durationMs: result.durationMs,
              visualizationId: null,
            });

            console.log(`[BatchExec] [${i + 1}/${totalJobs}] FAILED: ${preset.designName} — ${result.error}`);
          }
        })());
      }

      await Promise.all(batchPromises);

      // Delay between concurrency batches
      if (batchEnd < queue.length) {
        await delay(delayMs);
      }
    }

    // ── Summary ──
    const completed = results.filter(r => r.status === "done").length;
    const failed = results.filter(r => r.status === "failed").length;
    const totalViews = results.reduce((sum, r) => sum + Object.keys(r.views).length, 0);

    console.log(`[BatchExec] BATCH COMPLETE: ${batchId}`);
    console.log(`[BatchExec]   Completed: ${completed}/${totalJobs}`);
    console.log(`[BatchExec]   Failed: ${failed}`);
    console.log(`[BatchExec]   Total views: ${totalViews}`);

    return new Response(
      JSON.stringify({
        success: true,
        batchId,
        completed,
        failed,
        total: totalJobs,
        totalViews,
        estimatedCost: `$${((completed * 0.08) + (totalViews * 0.08)).toFixed(2)}`,
        results: results.map(r => ({
          designName: r.designName,
          tool: r.tool,
          vehicle: `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
          status: r.status,
          renderUrl: r.renderUrl,
          viewCount: Object.keys(r.views).length,
          durationMs: r.durationMs,
          error: r.error,
          visualizationId: r.visualizationId,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BatchExec] Fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
