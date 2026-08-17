import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Push a render image to the @RestyleProAI Instagram Business account.
 *
 * Uses the Meta Graph API two-step publish flow:
 *   1. POST /{ig-user-id}/media  → creates a media container (image_url + caption)
 *   2. POST /{ig-user-id}/media_publish → publishes the container
 *
 * Required Supabase secrets:
 *   META_IG_ACCESS_TOKEN   — long-lived page/user token with instagram_basic,
 *                            instagram_content_publish, pages_read_engagement
 *   META_IG_USER_ID        — Instagram Business account ID (numeric)
 *   SUPABASE_URL           — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { render_id, image_url, caption } = await req.json();

    if (!render_id || !image_url || !caption) {
      throw new Error("render_id, image_url, and caption are required");
    }

    const accessToken = Deno.env.get("META_IG_ACCESS_TOKEN");
    const igUserId = Deno.env.get("META_IG_USER_ID");

    if (!accessToken || !igUserId) {
      throw new Error(
        "META_IG_ACCESS_TOKEN and META_IG_USER_ID must be set in Supabase secrets"
      );
    }

    // ── Log the push attempt ──
    const { data: logRow, error: logError } = await supabase
      .from("ig_push_log")
      .insert({
        render_id,
        image_url,
        caption,
        status: "pending",
      })
      .select()
      .single();

    if (logError) {
      console.warn("Failed to log IG push attempt:", logError.message);
    }

    const logId = logRow?.id;

    // ── Step 1: Create media container ──
    console.log("Creating IG media container for render:", render_id);

    const containerRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url,
          caption,
          access_token: accessToken,
        }),
      }
    );

    const containerData = await containerRes.json();

    if (!containerRes.ok || containerData.error) {
      const errMsg =
        containerData.error?.message || "Failed to create media container";
      console.error("Meta API container error:", containerData);

      if (logId) {
        await supabase
          .from("ig_push_log")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", logId);
      }

      throw new Error(errMsg);
    }

    const creationId = containerData.id;
    console.log("Media container created:", creationId);

    // ── Step 2: Wait for container to be ready, then publish ──
    // The container may need a few seconds to process the image
    let ready = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!ready && attempts < maxAttempts) {
      attempts++;
      const statusRes = await fetch(
        `https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${accessToken}`
      );
      const statusData = await statusRes.json();

      if (statusData.status_code === "FINISHED") {
        ready = true;
      } else if (statusData.status_code === "ERROR") {
        const errMsg = "Media container processing failed";
        if (logId) {
          await supabase
            .from("ig_push_log")
            .update({ status: "failed", error_message: errMsg })
            .eq("id", logId);
        }
        throw new Error(errMsg);
      } else {
        // Wait 2 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!ready) {
      const errMsg = "Media container timed out after 20 seconds";
      if (logId) {
        await supabase
          .from("ig_push_log")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", logId);
      }
      throw new Error(errMsg);
    }

    // ── Step 3: Publish ──
    console.log("Publishing media container:", creationId);

    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        }),
      }
    );

    const publishData = await publishRes.json();

    if (!publishRes.ok || publishData.error) {
      const errMsg =
        publishData.error?.message || "Failed to publish to Instagram";
      console.error("Meta API publish error:", publishData);

      if (logId) {
        await supabase
          .from("ig_push_log")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", logId);
      }

      throw new Error(errMsg);
    }

    const igMediaId = publishData.id;
    console.log("Published to Instagram! Media ID:", igMediaId);

    // ── Step 4: Get permalink ──
    let permalink = null;
    try {
      const permalinkRes = await fetch(
        `https://graph.facebook.com/v21.0/${igMediaId}?fields=permalink&access_token=${accessToken}`
      );
      const permalinkData = await permalinkRes.json();
      permalink = permalinkData.permalink || null;
    } catch {
      console.warn("Could not fetch permalink");
    }

    // ── Update log with success ──
    if (logId) {
      await supabase
        .from("ig_push_log")
        .update({
          status: "published",
          ig_media_id: igMediaId,
          ig_permalink: permalink,
        })
        .eq("id", logId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ig_media_id: igMediaId,
        permalink,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Instagram push error:", error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
