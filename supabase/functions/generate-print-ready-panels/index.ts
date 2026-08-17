/**
 * generate-print-ready-panels — Orchestrator
 *
 * Coordinates Handler 1 (composite-graphic-to-panel) → Handler 2
 * (upscale-panel-to-print) for each panel in a job. Processes panels
 * ONE AT A TIME to stay within wall time and memory limits.
 *
 * Self-invokes with completedPanels progress when wall time approaches
 * the 60s edge function limit (fires at 40s).
 *
 * Input:  { jobId, userId, panels[], graphicPath, completedPanels? }
 * Output: { panels: { [panelKey]: { pngUrl, tiffUrl } }, status }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getFunctionsBaseUrl, getSignedUrl } from "../_shared/panelizer-os/storage.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      jobId, userId, panels, graphicPath,
      completedPanels: prevCompleted = {},
    } = await req.json();

    if (!jobId || !userId || !panels || !graphicPath) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: jobId, userId, panels, graphicPath" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = getFunctionsBaseUrl();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const invocationStart = Date.now();
    const completedPanels: Record<string, any> = { ...prevCompleted };

    console.log(`[PRINT-PANELS] Job ${jobId} — ${panels.length} panels, ${Object.keys(completedPanels).length} already done`);

    for (const panel of panels) {
      const { panelKey, widthInches, heightInches } = panel;

      // Skip already-completed panels
      if (completedPanels[panelKey]) {
        console.log(`[PRINT-PANELS] ${panelKey}: already complete — skipping`);
        continue;
      }

      // Wall time check — self-invoke if >40s elapsed
      const elapsed = Date.now() - invocationStart;
      if (elapsed > 40_000) {
        console.log(`[PRINT-PANELS] ${elapsed}ms elapsed — self-invoking for remaining panels`);
        await selfInvoke(baseUrl, serviceKey, {
          jobId, userId, panels, graphicPath, completedPanels,
        });
        return new Response(
          JSON.stringify({
            success: true,
            jobId,
            status: "continuing",
            completedSoFar: Object.keys(completedPanels).length,
            totalPanels: panels.length,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Handler 1: Composite ───────────────────────────────────
      console.log(`[PRINT-PANELS] ${panelKey}: starting composite…`);
      const compositeResult = await callFn(baseUrl, serviceKey, "composite-graphic-to-panel", {
        graphicPath, panelKey, widthInches, heightInches, userId, jobId,
      }, 8_000);

      if (!compositeResult.success) {
        console.error(`[PRINT-PANELS] ${panelKey}: composite failed — ${compositeResult.error}`);
        completedPanels[panelKey] = { error: compositeResult.error, step: "composite" };
        continue;
      }

      // ── Handler 2: Upscale + TIFF ──────────────────────────────
      console.log(`[PRINT-PANELS] ${panelKey}: starting upscale + TIFF…`);
      const upscaleResult = await callFn(baseUrl, serviceKey, "upscale-panel-to-print", {
        inputPath: compositeResult.storagePath,
        panelKey, widthInches, heightInches, userId, jobId, targetDpi: 150,
      }, 50_000);

      if (!upscaleResult.success) {
        console.error(`[PRINT-PANELS] ${panelKey}: upscale-print failed — ${upscaleResult.error}`);
        completedPanels[panelKey] = { error: upscaleResult.error, step: "upscale-print" };
        continue;
      }

      completedPanels[panelKey] = {
        pngUrl: upscaleResult.pngSignedUrl,
        tiffUrl: upscaleResult.tiffSignedUrl,
        pngPath: upscaleResult.pngPath,
        tiffPath: upscaleResult.tiffPath,
        upscaled: upscaleResult.upscaled,
        pngWidth: upscaleResult.pngWidth,
        pngHeight: upscaleResult.pngHeight,
        tiffWidth: upscaleResult.tiffWidth,
        tiffHeight: upscaleResult.tiffHeight,
        tiffDpi: upscaleResult.tiffDpi,
      };

      console.log(`[PRINT-PANELS] ${panelKey}: done ✓`);
    }

    // All panels processed
    const totalCompleted = Object.values(completedPanels).filter(
      (p: any) => !p.error
    ).length;
    const totalErrors = Object.values(completedPanels).filter(
      (p: any) => p.error
    ).length;

    console.log(`[PRINT-PANELS] Job ${jobId} — complete: ${totalCompleted} success, ${totalErrors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        panels: completedPanels,
        totalPanels: panels.length,
        totalCompleted,
        totalErrors,
        status: "complete",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[PRINT-PANELS] Error:", err);
    return new Response(
      JSON.stringify({ error: `Orchestrator failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Call an edge function with abort timeout ──────────────────────

async function callFn(
  baseUrl: string,
  key: string,
  fn: string,
  body: any,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const result = await resp.json();
    return result;
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    return {
      success: false,
      error: isTimeout ? `${fn} timed out after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Fire-and-forget self-invocation ──────────────────────────────
// Same pattern as run-production-flow: 8s abort lets TLS handshake +
// HTTP send complete, then aborts to prevent cascading waits.

async function selfInvoke(baseUrl: string, key: string, body: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    await fetch(`${baseUrl}/generate-print-ready-panels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    console.log(`[SELF-INVOKE] job=${body.jobId} → request accepted`);
  } catch {
    console.log(`[SELF-INVOKE] job=${body.jobId} → fire-and-forget (aborted after send)`);
  } finally {
    clearTimeout(timeout);
  }
}
