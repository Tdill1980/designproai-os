// supabase/functions/photoshop-api/index.ts
//
// Adobe Photoshop API integration — SMART OBJECT REPLACEMENT path (the
// deterministic, true-size production engine). Shifts the raster compute to
// Adobe's cloud so there's no local upscaling ceiling.
//
// Flow:
//   1. Sign a read URL for the per-vehicle TEMPLATE psd (true size, CMYK, named
//      smart objects) and for the panel ART.
//   2. Sign a write (PUT) URL for the output.
//   3. Get/refresh the Adobe bearer token.
//   4. POST a smartObject-replace job → poll the async status URL (BOUNDED) →
//      Adobe PUTs the finished true-size .psd straight to Supabase storage.
//
// Request body:
//   {
//     orderId, panelName,             // panelName MUST match the named smart object
//     templatePath, artPath,          // storage paths
//     templateBucket?, artBucket?, outputBucket?   // defaults below
//   }
//
// Requires secrets: ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET.
// Per JWT.md: verify_jwt = false in supabase/config.toml.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAdobeToken } from "./adobeAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bounded poll: 40 × 3s = up to 120s, comfortably inside the worker wall clock.
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const {
      orderId, panelName, templatePath, artPath,
      templateBucket = "wrap-templates",
      artBucket = "render-assets",
      outputBucket = "wrap-files",
    } = await req.json();

    if (!orderId || !panelName || !templatePath || !artPath) {
      return json({ error: "orderId, panelName, templatePath, artPath are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Presigned read hrefs for the Adobe engine.
    const { data: inputTemplate, error: tErr } = await supabase.storage
      .from(templateBucket).createSignedUrl(templatePath, 600);
    if (tErr || !inputTemplate?.signedUrl) {
      return json({ error: `Template not found (${templateBucket}/${templatePath}): ${tErr?.message || "no url"}` }, 404);
    }
    const { data: inputArt, error: aErr } = await supabase.storage
      .from(artBucket).createSignedUrl(artPath, 600);
    if (aErr || !inputArt?.signedUrl) {
      return json({ error: `Art not found (${artBucket}/${artPath}): ${aErr?.message || "no url"}` }, 404);
    }

    // 2. Presigned write (PUT) target.
    const outputPath = `wrapbox/${orderId}/${panelName}_production_ready.psd`;
    const { data: uploadTarget, error: uErr } = await supabase.storage
      .from(outputBucket).createSignedUploadUrl(outputPath);
    if (uErr || !uploadTarget?.signedUrl) {
      return json({ error: `Could not create output target: ${uErr?.message || "no url"}` }, 500);
    }

    // 3. Adobe token (cached).
    const accessToken = await getAdobeToken();
    const apiKey = Deno.env.get("ADOBE_CLIENT_ID")!;

    // 4. Smart Object replacement payload.
    const adobePayload = {
      inputs: [{ href: inputTemplate.signedUrl, storage: "external" }],
      options: {
        layers: [{
          name: panelName, // must match the named Smart Object in the master PSD
          input: { href: inputArt.signedUrl, storage: "external" },
        }],
      },
      outputs: [{
        href: uploadTarget.signedUrl,
        storage: "external",
        type: "image/vnd.adobe.photoshop",
      }],
    };

    const jobResponse = await fetch("https://image.adobe.io/pie/psdService/smartObject", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(adobePayload),
    });
    if (!jobResponse.ok) {
      return json({ error: `Adobe smartObject submit failed (${jobResponse.status}): ${(await jobResponse.text()).slice(0, 400)}` }, 502);
    }
    const jobData = await jobResponse.json();
    const statusUrl = jobData?._links?.self?.href;
    if (!statusUrl) return json({ error: "Adobe did not return a status URL", raw: jobData }, 502);

    // 5. Bounded poll until the output resolves.
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const statusCheck = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": apiKey },
      });
      const statusData = await statusCheck.json().catch(() => ({}));
      const out = statusData?.outputs?.[0];
      const st = out?.status || statusData?.status;
      if (st === "succeeded") {
        const { data: pub } = supabase.storage.from(outputBucket).getPublicUrl(outputPath);
        return json({ success: true, path: outputPath, url: pub?.publicUrl || null });
      }
      if (st === "failed") {
        return json({ error: "Adobe processing failed", details: out?.errors || statusData?.errors || statusData }, 502);
      }
      // else still "running"/"pending" — keep polling
    }

    return json({ error: "Adobe job did not finish within the poll window", status_url: statusUrl }, 504);
  } catch (error) {
    return json({ error: (error as Error)?.message || String(error) }, 400);
  }
});
