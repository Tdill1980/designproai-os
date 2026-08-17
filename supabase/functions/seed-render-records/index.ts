/**
 * seed-render-records — Import orphaned storage renders into designiq_generations
 *
 * POST /seed-render-records
 * Body: { dryRun?: boolean }
 *
 * Scans wrap-files/renders/designpanelpro/ for render PNGs and ai-generated/ for
 * panel JPGs, groups them by vehicle session, deduplicates against existing records,
 * and inserts new designiq_generations rows.
 *
 * Use dryRun: true to preview what would be inserted without writing.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const BUCKET = "wrap-files";
const RENDER_PREFIX = "renders/designpanelpro/";
const PANEL_PREFIX = "renders/designpanelpro/ai-generated/";
const BASE_URL = `https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/${BUCKET}`;
const USER_ID = "61cc6c1c-554c-440c-8e07-a64469f1f4eb";

const KNOWN_VIEWS = [
  "passenger-side",
  "hood_detail",
  "close-up",
  "closeup",
  "front",
  "rear",
  "side",
  "top",
  "hero",
];

interface ParsedRender {
  ts: number;
  make: string;
  model: string;
  view: string;
  filename: string;
}

interface ParsedPanel {
  ts: number;
  category: string;
  filename: string;
}

interface VehicleGroup {
  make: string;
  model: string;
  makeKey: string;
  modelKey: string;
  firstTs: number;
  lastTs: number;
  renders: ParsedRender[];
  panel: ParsedPanel | null;
}

function parseRenderFilename(name: string): ParsedRender | null {
  if (!name.endsWith(".png")) return null;
  const noExt = name.replace(".png", "");
  const firstUnderscore = noExt.indexOf("_");
  if (firstUnderscore < 0) return null;

  const ts = parseInt(noExt.substring(0, firstUnderscore));
  if (isNaN(ts)) return null;

  const rest = noExt.substring(firstUnderscore + 1);

  let view = "";
  let makeModel = "";

  for (const v of KNOWN_VIEWS) {
    if (rest.endsWith("_" + v)) {
      view = v;
      makeModel = rest.substring(0, rest.length - v.length - 1);
      break;
    }
  }

  if (!view) {
    const lastUnderscore = rest.lastIndexOf("_");
    if (lastUnderscore < 0) return null;
    view = rest.substring(lastUnderscore + 1);
    makeModel = rest.substring(0, lastUnderscore);
  }

  const mmUnderscore = makeModel.indexOf("_");
  const make = mmUnderscore > 0 ? makeModel.substring(0, mmUnderscore).trim() : makeModel.trim();
  const model = mmUnderscore > 0 ? makeModel.substring(mmUnderscore + 1).trim() : "";

  return { ts, make, model, view, filename: name };
}

function parsePanelFilename(name: string): ParsedPanel | null {
  if (!name.endsWith(".jpg")) return null;
  const noExt = name.replace(".jpg", "");
  const parts = noExt.split("_");
  if (parts.length < 2) return null;
  const ts = parseInt(parts[0]);
  if (isNaN(ts)) return null;
  return { ts, category: parts[1] || "restyle", filename: name };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Map panel categories to valid mode values (check constraint: 'commercial' | 'restyle')
const COMMERCIAL_CATEGORIES = new Set([
  "commercial", "food-beverage", "landscaping", "construction",
  "real-estate", "healthcare", "other",
]);

function toValidMode(category: string | undefined): string {
  if (!category) return "restyle";
  return COMMERCIAL_CATEGORIES.has(category) ? "commercial" : "restyle";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. List render PNGs from storage
    const { data: renderFiles, error: renderErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(RENDER_PREFIX.replace(/\/$/, ""), { limit: 500 });

    if (renderErr) throw new Error(`Storage list renders: ${renderErr.message}`);

    // 2. List panel JPGs from ai-generated/
    const { data: panelFiles, error: panelErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(PANEL_PREFIX.replace(/\/$/, ""), { limit: 500 });

    if (panelErr) throw new Error(`Storage list panels: ${panelErr.message}`);

    // 3. Parse filenames
    const renders: ParsedRender[] = (renderFiles || [])
      .map((f) => parseRenderFilename(f.name))
      .filter((r): r is ParsedRender => r !== null);

    const panels: ParsedPanel[] = (panelFiles || [])
      .map((f) => parsePanelFilename(f.name))
      .filter((p): p is ParsedPanel => p !== null);

    renders.sort((a, b) => a.ts - b.ts);
    panels.sort((a, b) => a.ts - b.ts);

    // 4. Get existing hero_render_urls for dedup
    const { data: existingRecords } = await supabaseAdmin
      .from("designiq_generations")
      .select("hero_render_url")
      .eq("user_id", USER_ID)
      .not("hero_render_url", "is", null);

    const existingUrls = new Set(
      (existingRecords || []).map((r: any) => r.hero_render_url),
    );

    // 5. Filter out already-imported renders
    const newRenders = renders.filter((r) => {
      const url = `${BASE_URL}/${RENDER_PREFIX}${encodeURIComponent(r.filename)}`;
      return !existingUrls.has(url);
    });

    // 6. Group renders by vehicle session (same make+model within 120s)
    const groups: VehicleGroup[] = [];
    let current: VehicleGroup | null = null;

    newRenders.forEach((r) => {
      const makeKey = r.make.toLowerCase();
      const modelKey = r.model.toLowerCase();

      if (
        current &&
        current.makeKey === makeKey &&
        current.modelKey === modelKey &&
        r.ts - current.lastTs < 120000
      ) {
        current.renders.push(r);
        current.lastTs = r.ts;
      } else {
        current = {
          makeKey,
          modelKey,
          make: r.make,
          model: r.model,
          firstTs: r.ts,
          lastTs: r.ts,
          renders: [r],
          panel: null,
        };
        groups.push(current);
      }
    });

    // 7. Match each group to nearest panel
    groups.forEach((g) => {
      let best: ParsedPanel | null = null;
      let bestDist = Infinity;
      for (const p of panels) {
        const dist = Math.abs(p.ts - g.firstTs);
        if (dist < bestDist && dist < 120000) {
          bestDist = dist;
          best = p;
        }
      }
      g.panel = best;
    });

    // 8. Build insert rows
    const rows = groups.map((g) => {
      const heroRender =
        g.renders.find((r) => r.view === "hero") ||
        g.renders.find((r) => r.view === "front") ||
        g.renders[0];

      const renderUrlsObj: Record<string, string> = {};
      g.renders.forEach((r) => {
        renderUrlsObj[r.view] =
          `${BASE_URL}/${RENDER_PREFIX}${encodeURIComponent(r.filename)}`;
      });

      const heroUrl = `${BASE_URL}/${RENDER_PREFIX}${encodeURIComponent(heroRender.filename)}`;
      const panelUrl = g.panel
        ? `${BASE_URL}/${PANEL_PREFIX}${encodeURIComponent(g.panel.filename)}`
        : null;

      const createdAt = new Date(g.firstTs).toISOString();

      return {
        user_id: USER_ID,
        mode: toValidMode(g.panel?.category),
        raw_prompt: `${capitalize(g.make)} ${g.model} vehicle wrap design`,
        finish: "Gloss",
        vehicle_make: capitalize(g.make),
        vehicle_model: g.model,
        panel_url: panelUrl,
        hero_render_url: heroUrl,
        render_urls: renderUrlsObj,
        engine_version: "1.0.0-seed",
        generation_status: "render_complete",
        created_at: createdAt,
        render_completed_at: new Date(g.lastTs).toISOString(),
        updated_at: createdAt,
      };
    });

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          totalStorageRenders: renders.length,
          totalPanels: panels.length,
          alreadyImported: renders.length - newRenders.length,
          newGroups: groups.length,
          records: rows.map((r) => ({
            make: r.vehicle_make,
            model: r.vehicle_model,
            mode: r.mode,
            views: Object.keys(
              r.render_urls as Record<string, string>,
            ).length,
            created: r.created_at,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 9. Insert in batches of 10
    let inserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i += 10) {
      const batch = rows.slice(i, i + 10);
      const { error: insertErr } = await supabaseAdmin
        .from("designiq_generations")
        .insert(batch);

      if (insertErr) {
        errors.push(`Batch ${i / 10}: ${insertErr.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalStorageRenders: renders.length,
        totalPanels: panels.length,
        alreadyImported: renders.length - newRenders.length,
        newGroupsFound: groups.length,
        inserted,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
