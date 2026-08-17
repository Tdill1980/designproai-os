// ============================================================================
// accept-shop-invite
// ============================================================================
// Redeems a pending shop_invites token for the authenticated caller:
//   1. Verifies the caller is authenticated.
//   2. Looks up the invite by token (service role — bypasses RLS so the
//      invitee doesn't need a pre-existing shop_members row).
//   3. Validates the invite is pending, not expired, and that the caller's
//      auth email matches invited_email (case-insensitive).
//   4. Re-checks the effective seat limit in case seats shrunk between
//      invite creation and acceptance.
//   5. Inserts shop_members (shop_id, user_id, role, invited_by, invited_at,
//      accepted_at). Uses upsert-on-conflict so re-running is idempotent.
//   6. Marks the invite accepted.
//
// Request body:
//   { token: string }
//
// Response:
//   {
//     success: true,
//     shop_id: uuid,
//     shop_name: string,
//     role: 'admin' | 'member'
//   }
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

interface AcceptBody {
  token?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    // 1. Auth
    // -------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(
        { success: false, error: "Missing Authorization header" },
        401,
      );
    }
    const jwt = authHeader.replace("Bearer ", "");

    const authClient = createExternalAnonClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(
      jwt,
    );
    if (authError || !authData?.user?.email) {
      console.error("[accept-shop-invite] auth error:", authError);
      return jsonResponse(
        { success: false, error: "Not authenticated" },
        401,
      );
    }
    const caller = authData.user;
    const callerEmail = caller.email!.toLowerCase();

    // -------------------------------------------------------------------
    // 2. Parse body
    // -------------------------------------------------------------------
    const body = (await req.json().catch(() => ({}))) as AcceptBody;
    const token = body.token?.trim();
    if (!token) {
      return jsonResponse(
        { success: false, error: "token is required" },
        400,
      );
    }

    const db = createExternalClient();

    // -------------------------------------------------------------------
    // 3. Look up the invite
    // -------------------------------------------------------------------
    const { data: invite, error: inviteError } = await db
      .from("shop_invites")
      .select(
        "id, shop_id, invited_email, invited_by_user_id, role, status, expires_at, created_at",
      )
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      console.error("[accept-shop-invite] invite lookup error:", inviteError);
      return jsonResponse(
        { success: false, error: "Failed to look up invite" },
        500,
      );
    }
    if (!invite) {
      return jsonResponse(
        { success: false, error: "Invite not found" },
        404,
      );
    }

    if (invite.status !== "pending") {
      return jsonResponse(
        {
          success: false,
          error: `Invite is ${invite.status}`,
        },
        409,
      );
    }

    const now = new Date();
    const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
    if (expiresAt && expiresAt.getTime() < now.getTime()) {
      // Best-effort cleanup — mark it expired so the owner sees stale
      // invites transition on their next refresh.
      await db
        .from("shop_invites")
        .update({ status: "expired" })
        .eq("id", invite.id);
      return jsonResponse(
        { success: false, error: "Invite has expired" },
        410,
      );
    }

    // 4. Email match (case-insensitive)
    if (invite.invited_email.toLowerCase() !== callerEmail) {
      console.warn(
        `[accept-shop-invite] email mismatch: invite=${invite.invited_email}, caller=${callerEmail}`,
      );
      return jsonResponse(
        {
          success: false,
          error:
            `This invite was sent to a different email (${invite.invited_email}). Please sign in with that account.`,
        },
        403,
      );
    }

    // -------------------------------------------------------------------
    // 5. Fetch shop details + re-check seat limit
    // -------------------------------------------------------------------
    const { data: shop, error: shopError } = await db
      .from("shops")
      .select("id, name")
      .eq("id", invite.shop_id)
      .maybeSingle();
    if (shopError || !shop) {
      console.error("[accept-shop-invite] shop lookup error:", shopError);
      return jsonResponse(
        { success: false, error: "Shop not found" },
        404,
      );
    }

    const { data: effectiveLimit, error: limitError } = await db.rpc(
      "shop_effective_seat_limit",
      { _shop_id: invite.shop_id },
    );
    if (limitError) {
      console.error("[accept-shop-invite] seat limit error:", limitError);
      return jsonResponse(
        { success: false, error: "Failed to resolve seat limit" },
        500,
      );
    }
    const effective = typeof effectiveLimit === "number" ? effectiveLimit : 1;

    const { count: memberCount, error: memberCountError } = await db
      .from("shop_members")
      .select("*", { count: "exact", head: true })
      .eq("shop_id", invite.shop_id);
    if (memberCountError) {
      console.error(
        "[accept-shop-invite] member count error:",
        memberCountError,
      );
      return jsonResponse(
        { success: false, error: "Failed to count existing members" },
        500,
      );
    }

    // If the caller is already a member (idempotent replay), skip seat
    // check and fall through to the accept-mark step.
    const { data: existingMember } = await db
      .from("shop_members")
      .select("id, role")
      .eq("shop_id", invite.shop_id)
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!existingMember && (memberCount ?? 0) >= effective) {
      return jsonResponse(
        {
          success: false,
          error:
            `This shop has reached its seat limit (${memberCount}/${effective}). Ask the owner to upgrade or free a seat.`,
        },
        409,
      );
    }

    // -------------------------------------------------------------------
    // 6. Insert (or skip) shop_members
    // -------------------------------------------------------------------
    if (!existingMember) {
      const { error: insertError } = await db
        .from("shop_members")
        .insert({
          shop_id: invite.shop_id,
          user_id: caller.id,
          role: invite.role,
          invited_by: invite.invited_by_user_id,
          invited_at: invite.created_at,
          accepted_at: now.toISOString(),
        });
      if (insertError) {
        // Concurrent accept -> unique (shop_id, user_id) already landed; treat
        // as success below.
        const code = (insertError as { code?: string }).code;
        if (code !== "23505") {
          console.error(
            "[accept-shop-invite] shop_members insert error:",
            insertError,
          );
          return jsonResponse(
            { success: false, error: "Failed to join shop" },
            500,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // 7. Mark invite accepted (ignore error — membership is the source of
    //    truth; accept status is cosmetic for the owner's invite list).
    // -------------------------------------------------------------------
    const { error: acceptMarkError } = await db
      .from("shop_invites")
      .update({
        status: "accepted",
        accepted_at: now.toISOString(),
        accepted_by_user_id: caller.id,
      })
      .eq("id", invite.id)
      .eq("status", "pending");
    if (acceptMarkError) {
      console.warn(
        "[accept-shop-invite] accept-mark warn (non-fatal):",
        acceptMarkError,
      );
    }

    console.log(
      `[accept-shop-invite] user ${caller.id} joined shop ${invite.shop_id} as ${invite.role}`,
    );

    return jsonResponse({
      success: true,
      shop_id: invite.shop_id,
      shop_name: shop.name,
      role: invite.role,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[accept-shop-invite] unexpected error:", err);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
