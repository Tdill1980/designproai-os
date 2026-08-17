// ============================================================================
// invite-shop-member
// ============================================================================
// Creates a pending shop_invites row after verifying the caller is a shop
// owner/admin for the target shop. Returns a token + share URL that the
// client surfaces for copy-to-clipboard (and that a future follow-up can
// email via Resend). Enforces the effective seat limit so a shop owner
// can't over-invite beyond their tier allowance.
//
// Request body:
//   {
//     shop_id: uuid,
//     email: string,
//     role?: 'admin' | 'member'  // defaults to 'member'
//   }
//
// Response:
//   { success: true, invite_id, token, invite_url, expires_at }
//   or
//   { success: false, error: string }
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createExternalAnonClient,
  createExternalClient,
} from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteBody {
  shop_id?: string;
  email?: string;
  role?: "admin" | "member";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateToken(): string {
  // 24 random bytes -> url-safe base64 (~32 chars). Plenty of entropy for
  // a short-lived invite token that also lives inside a URL path.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    // -------------------------------------------------------------------
    // 1. Auth: resolve caller from the Authorization header
    // -------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(
        { success: false, error: "Missing Authorization header" },
        401,
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const authClient = createExternalAnonClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(
      token,
    );
    if (authError || !authData?.user) {
      console.error("[invite-shop-member] auth error:", authError);
      return jsonResponse(
        { success: false, error: "Not authenticated" },
        401,
      );
    }
    const caller = authData.user;

    // -------------------------------------------------------------------
    // 2. Parse + validate body
    // -------------------------------------------------------------------
    const body = (await req.json().catch(() => ({}))) as InviteBody;
    const shopId = body.shop_id?.trim();
    const rawEmail = body.email?.trim();
    const role: "admin" | "member" = body.role === "admin" ? "admin" : "member";

    if (!shopId) {
      return jsonResponse(
        { success: false, error: "shop_id is required" },
        400,
      );
    }
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return jsonResponse(
        { success: false, error: "Valid email is required" },
        400,
      );
    }
    const email = rawEmail.toLowerCase();

    // -------------------------------------------------------------------
    // 3. Service-role client for DB writes + RPC calls
    // -------------------------------------------------------------------
    const db = createExternalClient();

    // 3a. Verify caller is a shop admin (owner or admin) for the target shop.
    //     Uses the Phase 1 helper so the answer matches what RLS would
    //     allow anyway.
    const { data: isAdmin, error: adminError } = await db.rpc(
      "is_shop_admin",
      { _user_id: caller.id, _shop_id: shopId },
    );
    if (adminError) {
      console.error("[invite-shop-member] is_shop_admin rpc error:", adminError);
      return jsonResponse(
        { success: false, error: "Authorization check failed" },
        500,
      );
    }
    if (!isAdmin) {
      return jsonResponse(
        {
          success: false,
          error: "You must be a shop owner or admin to invite members",
        },
        403,
      );
    }

    // 3b. Fetch shop metadata for the email body + seat math.
    const { data: shop, error: shopError } = await db
      .from("shops")
      .select("id, name, owner_user_id")
      .eq("id", shopId)
      .maybeSingle();
    if (shopError || !shop) {
      console.error("[invite-shop-member] shop lookup error:", shopError);
      return jsonResponse(
        { success: false, error: "Shop not found" },
        404,
      );
    }

    // 3c. Refuse if the email already belongs to the owner — they're already
    //     a member.
    if (caller.email && caller.email.toLowerCase() === email) {
      return jsonResponse(
        {
          success: false,
          error: "You cannot invite yourself — you are already a member",
        },
        400,
      );
    }

    // -------------------------------------------------------------------
    // 4. Seat limit enforcement (members + pending invites <= effective)
    // -------------------------------------------------------------------
    const { data: effectiveLimit, error: limitError } = await db.rpc(
      "shop_effective_seat_limit",
      { _shop_id: shopId },
    );
    if (limitError) {
      console.error(
        "[invite-shop-member] shop_effective_seat_limit rpc error:",
        limitError,
      );
      return jsonResponse(
        { success: false, error: "Failed to resolve seat limit" },
        500,
      );
    }
    const effective = typeof effectiveLimit === "number" ? effectiveLimit : 1;

    const { count: memberCount, error: memberCountError } = await db
      .from("shop_members")
      .select("*", { count: "exact", head: true })
      .eq("shop_id", shopId);
    if (memberCountError) {
      console.error(
        "[invite-shop-member] member count error:",
        memberCountError,
      );
      return jsonResponse(
        { success: false, error: "Failed to count existing members" },
        500,
      );
    }

    const { count: pendingCount, error: pendingCountError } = await db
      .from("shop_invites")
      .select("*", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("status", "pending");
    if (pendingCountError) {
      console.error(
        "[invite-shop-member] pending count error:",
        pendingCountError,
      );
      return jsonResponse(
        { success: false, error: "Failed to count pending invites" },
        500,
      );
    }

    const used = (memberCount ?? 0) + (pendingCount ?? 0);
    if (used >= effective) {
      return jsonResponse(
        {
          success: false,
          error:
            `Seat limit reached: ${used}/${effective} seats used. Upgrade your plan or revoke a pending invite to add more teammates.`,
          seat_limit: effective,
          seats_used: used,
        },
        409,
      );
    }

    // -------------------------------------------------------------------
    // 5. Insert the invite (upserting on conflict would silently replace —
    //    we'd rather hand back a clear "already pending" error).
    // -------------------------------------------------------------------
    const inviteToken = generateToken();
    const { data: inserted, error: insertError } = await db
      .from("shop_invites")
      .insert({
        shop_id: shopId,
        invited_email: email,
        invited_by_user_id: caller.id,
        role,
        token: inviteToken,
      })
      .select("id, token, expires_at, role, invited_email, created_at")
      .single();

    if (insertError) {
      // Unique pending-per-email index -> 23505
      const code = (insertError as { code?: string }).code;
      if (code === "23505") {
        return jsonResponse(
          {
            success: false,
            error:
              "An invite is already pending for this email. Revoke it first if you want to resend.",
          },
          409,
        );
      }
      console.error("[invite-shop-member] insert error:", insertError);
      return jsonResponse(
        { success: false, error: "Failed to create invite" },
        500,
      );
    }

    // -------------------------------------------------------------------
    // 6. Build invite URL — origin comes from the caller's Origin header
    //    so the link lands on whichever host the owner is using (prod,
    //    preview, localhost).
    // -------------------------------------------------------------------
    const origin = req.headers.get("origin") || "https://restylepro.app";
    const inviteUrl = `${origin}/invite/${inserted.token}`;

    console.log(
      `[invite-shop-member] created invite ${inserted.id} for ${email} -> shop ${shop.name}`,
    );

    return jsonResponse({
      success: true,
      invite_id: inserted.id,
      token: inserted.token,
      invite_url: inviteUrl,
      expires_at: inserted.expires_at,
      shop_name: shop.name,
      role: inserted.role,
      invited_email: inserted.invited_email,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[invite-shop-member] unexpected error:", err);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
