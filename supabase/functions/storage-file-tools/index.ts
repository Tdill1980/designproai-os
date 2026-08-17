/**
 * storage-file-tools — tiny storage utility for production workflows.
 *
 * action:"copy" — copy an object within a bucket to a new (properly named)
 * key, e.g. giving an upscaler output a print-ready filename like
 * `driver-side_234.5x59.6in.png`. Uses the service role internally.
 *
 * Body: { action:"copy", bucket:"wrap-files", from:"panels/upscaled/x.png",
 *         to:"panel-artboard/<job>/print/driver-side_234.5x59.6in.png" }
 * Returns: { success, publicUrl }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { action, bucket = "wrap-files", from, to, paths } = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // action:"delete" — remove objects for real. Direct SQL deletes on
    // storage.objects are blocked by a guard trigger; this is the sanctioned
    // Storage API path (used to kill discarded/bad generated files so their
    // public links stop resolving).
    if (action === "delete") {
      const list: string[] = Array.isArray(paths) ? paths : (from ? [from] : []);
      if (!list.length) return json({ success: false, error: "paths (or from) required" }, 400);
      const { data, error } = await db.storage.from(bucket).remove(list);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, removed: (data || []).map((o: any) => o.name) });
    }

    if (action !== "copy") return json({ success: false, error: "unsupported action" }, 400);
    if (!from || !to) return json({ success: false, error: "from and to are required" }, 400);

    const { error } = await db.storage.from(bucket).copy(from, to);
    if (error && !/already exists/i.test(error.message)) {
      return json({ success: false, error: error.message }, 500);
    }
    const { data: { publicUrl } } = db.storage.from(bucket).getPublicUrl(to);
    return json({ success: true, publicUrl });
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
