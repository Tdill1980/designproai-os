// ============================================================================
// restore-golden-renders — Rebuild missing color_visualizations
// ============================================================================
// Two-phase recovery:
//   Phase 1: Restore from designiq_generations (gold source, full metadata)
//   Phase 2: Restore from storage bucket scan (ColorPro/FadeWraps/WBTY renders)
//
// Usage:
//   POST /restore-golden-renders
//   Body: { "dryRun": true }          ← preview what will be restored
//   Body: { "dryRun": false }         ← actually restore
//   Body: { "phase": 1 }             ← only run phase 1 (designiq)
//   Body: { "phase": 2 }             ← only run phase 2 (storage)
//   Body: { "daysBack": 14 }         ← how far back to look (default 14)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default: true (safe)
    const phase = body.phase || "both"; // 1, 2, or "both"
    const daysBack = body.daysBack || 14;

    const results: {
      phase1: { found: number; restored: number; records: any[] };
      phase2: { found: number; restored: number; records: any[] };
      dryRun: boolean;
    } = {
      phase1: { found: 0, restored: 0, records: [] },
      phase2: { found: 0, restored: 0, records: [] },
      dryRun,
    };

    // ================================================================
    // PHASE 1: Restore from designiq_generations
    // ================================================================
    if (phase === 1 || phase === "both") {
      console.log(`🔍 Phase 1: Scanning designiq_generations (last ${daysBack} days)...`);

      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      // Fetch designiq_generations with render data
      const { data: generations, error: genError } = await supabase
        .from("designiq_generations")
        .select("*")
        .gte("created_at", cutoff)
        .not("hero_render_url", "is", null)
        .in("generation_status", ["render_complete", "all_views", "proof_generated"])
        .order("created_at", { ascending: false })
        .limit(500);

      if (genError) {
        console.error("Error fetching designiq_generations:", genError);
      }

      if (generations && generations.length > 0) {
        console.log(`Found ${generations.length} designiq_generations with renders`);

        // Fetch existing color_visualizations in the same period
        const { data: existingViz } = await supabase
          .from("color_visualizations")
          .select("customer_email, vehicle_make, vehicle_model, created_at")
          .gte("created_at", cutoff)
          .eq("generation_status", "completed");

        // Build a set of existing records for fast lookup
        const existingSet = new Set(
          (existingViz || []).map((v) => {
            const t = new Date(v.created_at).getTime();
            // Round to nearest 10 minutes for fuzzy matching
            const rounded = Math.round(t / 600000) * 600000;
            return `${v.customer_email}|${v.vehicle_make}|${v.vehicle_model}|${rounded}`;
          })
        );

        const orphans = [];
        for (const dg of generations) {
          const t = new Date(dg.created_at).getTime();
          const rounded = Math.round(t / 600000) * 600000;
          const key = `${dg.user_email}|${dg.vehicle_make}|${dg.vehicle_model}|${rounded}`;

          // Also check adjacent time slots (±10 min)
          const keyBefore = `${dg.user_email}|${dg.vehicle_make}|${dg.vehicle_model}|${rounded - 600000}`;
          const keyAfter = `${dg.user_email}|${dg.vehicle_make}|${dg.vehicle_model}|${rounded + 600000}`;

          if (!existingSet.has(key) && !existingSet.has(keyBefore) && !existingSet.has(keyAfter)) {
            orphans.push(dg);
          }
        }

        results.phase1.found = orphans.length;
        console.log(`Found ${orphans.length} orphaned designiq_generations (no matching color_visualizations)`);

        for (const dg of orphans) {
          // Build render_urls object from designiq_generations format
          let renderUrls: Record<string, string> = {};

          if (dg.render_urls && Array.isArray(dg.render_urls) && dg.render_urls.length > 0) {
            // designiq_generations stores as [{type, url}, ...]
            for (const entry of dg.render_urls) {
              if (entry?.type && entry?.url) {
                renderUrls[entry.type] = entry.url;
              }
            }
          }

          // Always ensure hero is set
          if (dg.hero_render_url && !renderUrls.hero) {
            renderUrls.hero = dg.hero_render_url;
          }

          const record = {
            customer_email: dg.user_email,
            vehicle_year: parseInt(dg.vehicle_year) || 2025,
            vehicle_make: dg.vehicle_make || "Unknown",
            vehicle_model: dg.vehicle_model || "Unknown",
            color_name: dg.style_preset || dg.company_name || "Restored Render",
            color_hex: "#000000",
            finish_type: dg.finish || "Gloss",
            mode_type: "designpanelpro",
            design_file_name: dg.style_preset || dg.company_name || null,
            custom_design_url: dg.panel_url || null,
            render_urls: renderUrls,
            generation_status: "completed",
            admin_notes: JSON.stringify({
              restored: true,
              restored_at: new Date().toISOString(),
              source: "designiq_generations",
              designiq_generation_id: dg.id,
              restore_reason: "golden_era_recovery",
            }),
            created_at: dg.created_at,
            updated_at: new Date().toISOString(),
          };

          results.phase1.records.push({
            designiq_id: dg.id,
            email: dg.user_email,
            vehicle: `${dg.vehicle_year} ${dg.vehicle_make} ${dg.vehicle_model}`,
            design: dg.style_preset || dg.company_name || null,
            hero_url: dg.hero_render_url,
            created_at: dg.created_at,
          });

          if (!dryRun) {
            const { error: insertError } = await supabase
              .from("color_visualizations")
              .insert(record);

            if (insertError) {
              console.error(`Error restoring ${dg.id}:`, insertError);
            } else {
              results.phase1.restored++;
              console.log(`✅ Restored: ${dg.style_preset || dg.company_name || 'render'} — ${dg.vehicle_make} ${dg.vehicle_model}`);
            }
          }
        }
      }
    }

    // ================================================================
    // PHASE 2: Restore from storage bucket scan
    // ================================================================
    if (phase === 2 || phase === "both") {
      console.log(`🔍 Phase 2: Scanning storage bucket 'renders' (last ${daysBack} days)...`);

      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      // List top-level folders in renders bucket (each is a user ID)
      const { data: userFolders, error: listError } = await supabase.storage
        .from("renders")
        .list("", { limit: 200 });

      if (listError) {
        console.error("Error listing renders bucket:", listError);
      }

      if (userFolders) {
        // Fetch ALL existing color_visualizations render URLs for dedup
        const { data: allViz } = await supabase
          .from("color_visualizations")
          .select("render_urls")
          .eq("generation_status", "completed")
          .gte("created_at", cutoff.toISOString());

        // Build set of known render URLs
        const knownUrls = new Set<string>();
        for (const viz of allViz || []) {
          if (viz.render_urls && typeof viz.render_urls === "object") {
            for (const url of Object.values(viz.render_urls as Record<string, string>)) {
              if (typeof url === "string") {
                // Extract just the path portion for matching
                const pathMatch = url.match(/renders\/[^?]+/);
                if (pathMatch) knownUrls.add(pathMatch[0]);
              }
            }
          }
        }

        console.log(`Known render URLs in DB: ${knownUrls.size}`);

        for (const folder of userFolders) {
          if (!folder.name || folder.name.startsWith(".")) continue;
          const userId = folder.name;

          // List mode folders for this user
          const { data: modeFolders } = await supabase.storage
            .from("renders")
            .list(userId, { limit: 20 });

          if (!modeFolders) continue;

          for (const modeFolder of modeFolders) {
            if (!modeFolder.name) continue;
            const modeType = modeFolder.name;

            // List render files
            const { data: files } = await supabase.storage
              .from("renders")
              .list(`${userId}/${modeType}`, { limit: 500, sortBy: { column: "created_at", order: "desc" } });

            if (!files) continue;

            // Group files by render session (files within 2 min of each other)
            const sessions: Map<string, typeof files> = new Map();
            for (const file of files) {
              if (!file.name || !file.created_at) continue;

              const fileTime = new Date(file.created_at);
              if (fileTime < cutoff) continue; // Skip files older than our window

              const storagePath = `renders/${userId}/${modeType}/${file.name}`;
              if (knownUrls.has(storagePath)) continue; // Already in DB

              // Parse vehicle info from filename: {timestamp}_{make}_{model}_{viewType}.png
              const parts = file.name.replace(/\.[^.]+$/, "").split("_");
              // Create a session key by rounding timestamp to 2-minute window
              const sessionKey = `${userId}|${modeType}|${Math.round(fileTime.getTime() / 120000)}`;

              if (!sessions.has(sessionKey)) {
                sessions.set(sessionKey, []);
              }
              sessions.get(sessionKey)!.push(file);
            }

            // Process each session
            for (const [sessionKey, sessionFiles] of sessions) {
              if (sessionFiles.length === 0) continue;

              // Get user email
              const { data: userData } = await supabase.auth.admin.getUserById(userId);
              const userEmail = userData?.user?.email;
              if (!userEmail) continue;

              // Parse vehicle info from first file
              const firstName = sessionFiles[0].name.replace(/\.[^.]+$/, "");
              const nameParts = firstName.split("_");

              // Skip if we can't parse meaningful data
              let vehicleMake = "Unknown";
              let vehicleModel = "Unknown";
              let viewType = "hero";

              if (nameParts.length >= 4) {
                vehicleMake = nameParts[1] || "Unknown";
                vehicleModel = nameParts[2] || "Unknown";
                viewType = nameParts[3] || "hero";
              }

              // Build render_urls from all files in session
              const renderUrls: Record<string, string> = {};
              const baseUrl = Deno.env.get("SUPABASE_URL")!;

              for (const file of sessionFiles) {
                const vt = file.name.replace(/\.[^.]+$/, "").split("_").pop() || "hero";
                const publicUrl = `${baseUrl}/storage/v1/object/public/renders/${userId}/${modeType}/${file.name}`;
                renderUrls[vt] = publicUrl;
              }

              results.phase2.found++;
              results.phase2.records.push({
                user: userEmail,
                vehicle: `${vehicleMake} ${vehicleModel}`,
                mode: modeType,
                files: sessionFiles.length,
                created_at: sessionFiles[0].created_at,
              });

              if (!dryRun) {
                const { error: insertError } = await supabase
                  .from("color_visualizations")
                  .insert({
                    customer_email: userEmail,
                    vehicle_year: 2025,
                    vehicle_make: vehicleMake.charAt(0).toUpperCase() + vehicleMake.slice(1),
                    vehicle_model: vehicleModel.charAt(0).toUpperCase() + vehicleModel.slice(1),
                    color_name: `Restored — ${vehicleMake} ${vehicleModel}`,
                    color_hex: "#000000",
                    finish_type: "Gloss",
                    mode_type: modeType === "colorpro" ? "colorpro" : modeType,
                    render_urls: renderUrls,
                    generation_status: "completed",
                    admin_notes: JSON.stringify({
                      restored: true,
                      restored_at: new Date().toISOString(),
                      source: "storage_bucket",
                      restore_reason: "golden_era_recovery",
                    }),
                    created_at: sessionFiles[0].created_at,
                    updated_at: new Date().toISOString(),
                  });

                if (insertError) {
                  console.error(`Error restoring storage session:`, insertError);
                } else {
                  results.phase2.restored++;
                }
              }
            }
          }
        }
      }
    }

    // Summary
    const summary = {
      dryRun,
      daysBack,
      phase1_designiq: {
        orphans_found: results.phase1.found,
        restored: dryRun ? 0 : results.phase1.restored,
        preview: results.phase1.records,
      },
      phase2_storage: {
        orphans_found: results.phase2.found,
        restored: dryRun ? 0 : results.phase2.restored,
        preview: results.phase2.records,
      },
      total_recoverable: results.phase1.found + results.phase2.found,
      message: dryRun
        ? `DRY RUN: Found ${results.phase1.found + results.phase2.found} recoverable renders. Run with dryRun=false to restore.`
        : `RESTORED: ${results.phase1.restored + results.phase2.restored} renders recovered.`,
    };

    console.log("📊 Summary:", JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
