import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";

  if (!path) {
    return new Response("path param required", { status: 400 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await sb.storage.from("wrap-files").download(path);

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message || "Not found" }), { status: 404 });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      ...corsHeaders,
    },
  });
});
