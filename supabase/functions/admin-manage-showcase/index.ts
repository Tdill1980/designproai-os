/**
 * admin-manage-showcase
 *
 * Handles admin CRUD operations on the homepage_showcase table.
 * Also handles file uploads to the carousel-images storage bucket.
 * Uses service_role to bypass RLS, with server-side admin/tester role verification.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("[admin-manage-showcase] Token length:", token.length, "starts with:", token.substring(0, 20));
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("[admin-manage-showcase] Auth failed:", authError?.message, "user:", user);
      return jsonResponse({ error: "Unauthorized", detail: authError?.message }, 401);
    }
    console.log("[admin-manage-showcase] Auth OK, user:", user.id, user.email);

    // Verify admin or tester role (using service role to bypass user_roles RLS)
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "tester"]);

    if (!roleData || roleData.length === 0) {
      return jsonResponse({ error: "Admin or tester role required" }, 403);
    }

    const body = await req.json();

    // ── upload_and_insert: upload file to storage + insert DB row ──
    if (body.action === "upload_and_insert") {
      const { file_base64, file_name, content_type, data } = body;

      if (!file_base64 || !file_name || !data?.name || !data?.title) {
        return jsonResponse({ error: "Missing required fields for upload_and_insert" }, 400);
      }

      // Decode base64 to binary
      let bytes: Uint8Array;
      try {
        const binaryString = atob(file_base64);
        bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        console.log(`[admin-manage-showcase] Decoded ${bytes.length} bytes for file: ${file_name}`);
      } catch (decodeErr) {
        console.error("[admin-manage-showcase] Base64 decode failed:", decodeErr);
        return jsonResponse({ error: "Failed to decode base64 image data" }, 400);
      }

      // Upload to storage using service role (bypasses storage RLS)
      const { error: uploadError } = await supabase.storage
        .from("carousel-images")
        .upload(file_name, bytes, {
          contentType: content_type || "image/png",
          upsert: true,
        });

      if (uploadError) {
        console.error("[admin-manage-showcase] Storage upload failed:", uploadError.message);
        return jsonResponse({ error: `Storage upload failed: ${uploadError.message}` }, 500);
      }

      // Build the public URL
      const { data: urlData } = supabase.storage
        .from("carousel-images")
        .getPublicUrl(file_name);

      const publicUrl = urlData.publicUrl;

      // Delete existing row with same name if provided
      if (data.name) {
        await supabase
          .from("homepage_showcase")
          .delete()
          .eq("name", data.name);
      }

      // Insert the DB row
      const { data: inserted, error: insertError } = await supabase
        .from("homepage_showcase")
        .insert({
          name: data.name,
          title: data.title,
          image_url: publicUrl,
          alt_text: data.alt_text || data.title,
          sort_order: data.sort_order ?? 0,
          is_active: data.is_active ?? true,
        })
        .select()
        .single();

      if (insertError) {
        console.error("[admin-manage-showcase] Insert failed:", insertError.message);
        return jsonResponse({ error: insertError.message }, 500);
      }

      return jsonResponse({ success: true, data: inserted, publicUrl });
    }

    // ── insert: insert DB row only ──
    if (body.action === "insert") {
      const { name, title, image_url, alt_text, sort_order, is_active } = body.data;

      if (!name || !title || !image_url || !alt_text) {
        return jsonResponse({ error: "Missing required fields: name, title, image_url, alt_text" }, 400);
      }

      const { data, error } = await supabase
        .from("homepage_showcase")
        .insert({
          name,
          title,
          image_url,
          alt_text,
          sort_order: sort_order ?? 0,
          is_active: is_active ?? true,
        })
        .select()
        .single();

      if (error) {
        console.error("[admin-manage-showcase] Insert failed:", error.message);
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({ success: true, data });
    }

    // ── delete: delete by id ──
    if (body.action === "delete") {
      if (!body.id) {
        return jsonResponse({ error: "Missing required field: id" }, 400);
      }

      const { error } = await supabase
        .from("homepage_showcase")
        .delete()
        .eq("id", body.id);

      if (error) {
        console.error("[admin-manage-showcase] Delete failed:", error.message);
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({ success: true });
    }

    // ── delete_by_name: delete by name ──
    if (body.action === "delete_by_name") {
      if (!body.name) {
        return jsonResponse({ error: "Missing required field: name" }, 400);
      }

      const { error } = await supabase
        .from("homepage_showcase")
        .delete()
        .eq("name", body.name);

      if (error) {
        console.error("[admin-manage-showcase] Delete by name failed:", error.message);
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid action. Use: upload_and_insert, insert, delete, or delete_by_name" }, 400);
  } catch (err) {
    console.error("[admin-manage-showcase] Unexpected error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
