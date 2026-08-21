/**
 * The ONE sanctioned photographer producer.
 *
 * DesignPanelPro takes a lean in-process path so its seven-view workflow does
 * not boot the large legacy multi-product module. Every other existing mode is
 * delegated to the preserved legacy handler under this same Edge function slug.
 * No second producer or function-to-function hop is created.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-designpro-owner-id, x-designpro-mode",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // The server-owned runtime marks only its DesignPanel photographer calls.
  // The lean handler still performs full internal authentication and validates
  // body.modeType, so this header is routing metadata, never authorization.
  if (req.headers.get("x-designpro-mode") === "designpanelpro") {
    const { handleDesignPanelRender } = await import("./designpanel-handler.ts");
    return handleDesignPanelRender(req);
  }

  const { handleLegacyGenerateColorRender } = await import("./legacy.ts");
  return handleLegacyGenerateColorRender(req);
});
