/**
 * seo-wp-connect — Connect a shop to a WordPress site.
 *
 * Actions:
 *   POST /seo-wp-connect { action: "test", shop_id, site_url, username, app_password }
 *     → tests the credentials, returns detected SEO plugin + WooCommerce status
 *
 *   POST /seo-wp-connect { action: "save", shop_id, site_url, username, app_password }
 *     → tests then upserts a tenant_site_connections row
 *
 *   POST /seo-wp-connect { action: "categories", shop_id }
 *     → lists categories from the saved connection
 *
 *   POST /seo-wp-connect { action: "authors", shop_id }
 *     → lists authors from the saved connection
 *
 *   POST /seo-wp-connect { action: "disconnect", shop_id }
 *     → soft-disables the connection
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  authenticate,
  assertShopAdmin,
  assertShopMember,
} from "../_shared/seo/auth.ts";
import {
  testConnection,
  listCategories,
  listAuthors,
  WordPressCredentials,
} from "../_shared/seo/wordpress-adapter.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadCreds(
  ctx: Awaited<ReturnType<typeof authenticate>>,
  shopId: string,
): Promise<WordPressCredentials> {
  const { data, error } = await ctx.db
    .from("tenant_site_connections")
    .select("config, site_url")
    .eq("shop_id", shopId)
    .eq("platform", "wordpress")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    throw json({ error: "WordPress connection not found for this shop" }, 404);
  }
  const config = data.config as {
    username: string;
    app_password: string;
    seo_plugin?: WordPressCredentials["seo_plugin"];
  };
  return {
    site_url: data.site_url ?? "",
    username: config.username,
    app_password: config.app_password,
    seo_plugin: config.seo_plugin ?? "none",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const action = body?.action as string;
    const shop_id = body?.shop_id as string;
    if (!action || !shop_id) return json({ error: "action + shop_id required" }, 400);

    if (action === "test" || action === "save") {
      await assertShopAdmin(ctx, shop_id);
      const creds: WordPressCredentials = {
        site_url: String(body.site_url ?? "").trim(),
        username: String(body.username ?? "").trim(),
        app_password: String(body.app_password ?? "").replace(/\s+/g, ""), // WP shows the password with spaces
      };
      if (!creds.site_url || !creds.username || !creds.app_password) {
        return json({ error: "site_url, username, and app_password are required" }, 400);
      }
      const result = await testConnection(creds);
      creds.seo_plugin = result.seo_plugin;

      if (action === "save") {
        const { error: upsertErr } = await ctx.service
          .from("tenant_site_connections")
          .upsert(
            {
              shop_id,
              platform: "wordpress",
              display_name: result.site_name,
              site_url: result.site_url,
              config: {
                username: creds.username,
                app_password: creds.app_password,
                seo_plugin: result.seo_plugin,
              },
              metadata: {
                site_name: result.site_name,
                user: result.user,
                namespaces: result.namespaces,
                has_woocommerce: result.has_woocommerce,
                detected_at: new Date().toISOString(),
              },
              is_active: true,
              last_synced_at: new Date().toISOString(),
              last_error: null,
            },
            { onConflict: "shop_id,platform" },
          );
        if (upsertErr) {
          return json({ error: `Save failed: ${upsertErr.message}` }, 500);
        }
      }

      return json({ ok: true, ...result });
    }

    if (action === "categories") {
      await assertShopMember(ctx, shop_id);
      const creds = await loadCreds(ctx, shop_id);
      const cats = await listCategories(creds);
      return json({ ok: true, categories: cats });
    }

    if (action === "authors") {
      await assertShopMember(ctx, shop_id);
      const creds = await loadCreds(ctx, shop_id);
      const authors = await listAuthors(creds);
      return json({ ok: true, authors });
    }

    if (action === "disconnect") {
      await assertShopAdmin(ctx, shop_id);
      const { error } = await ctx.service
        .from("tenant_site_connections")
        .update({ is_active: false })
        .eq("shop_id", shop_id)
        .eq("platform", "wordpress");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-wp-connect] error", msg);
    return json({ error: msg }, 500);
  }
});
