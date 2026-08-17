import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tokenGate } from "../_shared/token-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per design-panel generation.
  const gate = await tokenGate(req, { reason: "design_panel_generate" });
  if (!gate.ok) return gate.response!;

  try {
    const body = await req.json();
    const { vehicle, panelUrl, panelName, finish, viewType = "front" } = body;

    // Validate required inputs
    if (!vehicle || !panelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required design inputs (vehicle, panelUrl)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the prompt
    const prompt = buildDesignPanelPrompt({ vehicle, panelName, panelUrl, finish, viewType });

    console.log("DesignPanelPro generation starting:", { vehicle, panelName, viewType });

    // Call AI gateway
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: panelUrl } }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "Image generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    
    // Extract image from response
    const message = result.choices?.[0]?.message;
    let imageUrl = null;

    // Check images array first (Google Gemini format)
    if (message?.images && Array.isArray(message.images)) {
      const imageContent = message.images.find((img: any) => img.type === "image_url");
      if (imageContent?.image_url?.url) {
        imageUrl = imageContent.image_url.url;
      }
    }

    // Fallback: check content array (OpenAI format)
    if (!imageUrl && Array.isArray(message?.content)) {
      const imageContent = message.content.find((c: any) => c.type === "image_url");
      if (imageContent?.image_url?.url) {
        imageUrl = imageContent.image_url.url;
      }
    }

    if (!imageUrl) {
      console.error("No image in AI response:", JSON.stringify(result).slice(0, 500));
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "No image returned from AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to storage
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const timestamp = Date.now();
    const fileName = `renders/DesignPanelPro/${timestamp}_${vehicle.replace(/\s+/g, '_')}_${viewType}.png`;

    // Convert base64 to blob if needed (using Deno-compatible decode)
    let imageData: Uint8Array;
    if (imageUrl.startsWith("data:")) {
      const base64Data = imageUrl.split(",")[1];
      // Deno-compatible base64 decode
      const binaryString = atob(base64Data);
      imageData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageData[i] = binaryString.charCodeAt(i);
      }
    } else {
      const imgResponse = await fetch(imageUrl);
      imageData = new Uint8Array(await imgResponse.arrayBuffer());
    }

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, imageData, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "Failed to save render" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    console.log("DesignPanelPro render saved:", publicUrl);

    return new Response(
      JSON.stringify({ renderUrl: publicUrl, success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("design-panel-generate error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildDesignPanelPrompt({
  vehicle,
  panelName,
  panelUrl,
  finish,
  viewType,
}: {
  vehicle: string;
  panelName?: string;
  panelUrl: string;
  finish?: string;
  viewType: string;
}): string {
  return `Generate a hyper-photorealistic image of a ${vehicle} with a full-body vinyl wrap using the provided 2D design panel.

DESIGN PANEL: ${panelName || "Custom Panel Design"}
FINISH: ${finish || "Gloss"} lamination
VIEW: ${viewType} angle

REQUIREMENTS:
- Apply the 2D panel design as a seamless full-body wrap covering the entire vehicle
- Ultra-high resolution 4K output with tack-sharp detail
- Professional automotive photography lighting - soft studio environment
- The wrap must look like a real installed vinyl wrap, not CGI
- Preserve the exact colors and patterns from the panel design
- No text overlays, watermarks, or branding on the vehicle
- Show realistic wrap conformity around body lines and curves
- Clean studio background (light gray gradient)

OUTPUT: One photorealistic vehicle render showing the design panel applied as a wrap.`;
}
